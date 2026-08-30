/**
 * Integration test: verify that the trim-test race produces accurate timing
 * results and that green/red visual cues appear at the expected video PTS.
 *
 * Runs the trim-test race in default (non-ffmpeg) mode and uses ffprobe to
 * analyze the recorded video frames for cue detection accuracy.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { CUE_DETECTION } from '../cli/media-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RACERS = [
  { name: 'alpha',   targetMs: 600,  reloadTargetMs: 400,  recordingWindow: 1.8 },
  { name: 'bravo',   targetMs: 800,  reloadTargetMs: 500,  recordingWindow: 2.1 },
  { name: 'charlie', targetMs: 1000, reloadTargetMs: 600,  recordingWindow: 2.4 },
  { name: 'delta',   targetMs: 1200, reloadTargetMs: 700,  recordingWindow: 2.7 },
];

const DURATION_TOLERANCE_MS = 50;

function hasFfprobe() {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function getVideoDuration(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    videoPath,
  ], { timeout: 10_000 });
  const info = JSON.parse(out.toString());
  return parseFloat(info.format.duration);
}

/**
 * Detect green and red cue frame PTS timestamps by analyzing
 * the 4x4 top-left crop of the video via ffprobe + signalstats.
 */
function detectCues(videoPath) {
  const escaped = videoPath.replace(/\\/g, '/').replace(/[';,\[\]=\\ ]/g, ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
  const result = execFileSync('ffprobe', [
    '-f', 'lavfi',
    '-i', `movie=${escaped},crop=4:4:0:0,signalstats`,
    '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.HUEAVG,lavfi.signalstats.SATAVG,lavfi.signalstats.YAVG',
    '-of', 'csv=p=0',
    '-v', 'quiet',
  ], { timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] });

  const lines = result.toString().trim().split('\n').filter(Boolean);
  const greenFrames = [];
  const redFrames = [];

  for (const line of lines) {
    const parts = line.split(',');
    const time = parseFloat(parts[0]);
    const hue = parseFloat(parts[1]);
    const sat = parseFloat(parts[2]);
    const y = parseFloat(parts[3]);
    if (isNaN(time) || isNaN(sat)) continue;

    if (sat > CUE_DETECTION.saturationMin) {
      if (hue > CUE_DETECTION.startHueMin && hue < CUE_DETECTION.startHueMax && y < CUE_DETECTION.startYMax) {
        greenFrames.push(time);
      } else if (hue > CUE_DETECTION.endHueMin && hue < CUE_DETECTION.endHueMax && y > CUE_DETECTION.endYMin) {
        redFrames.push(time);
      }
    }
  }

  return { greenFrames, redFrames, totalFrames: lines.length };
}

describe('trim-accuracy integration', () => {
  let resultsDir;

  beforeAll(() => {
    if (!hasFfprobe()) {
      throw new Error('ffprobe is not installed or not on PATH — skipping trim-accuracy tests');
    }
  });

  it('runs trim-test race and produces accurate measurement durations', () => {
    const projectRoot = path.resolve(__dirname, '..');

    const proc = spawnSync('node', ['race.js', './races/trim-test', '--serve=false', '--cue-markers'], {
      cwd: projectRoot,
      timeout: 60_000,
      encoding: 'utf-8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    expect(proc.status).toBe(0);

    const ansiRe = new RegExp('\\u001B\\[[0-9;]*m', 'g');
    const stripped = proc.stderr.replace(ansiRe, '');
    const match = stripped.match(/📂\s+(.+)/);
    expect(match).not.toBeNull();
    resultsDir = path.resolve(projectRoot, match[1].trim());
    expect(fs.existsSync(resultsDir)).toBe(true);

    const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
    expect(summary.overallWinner).toBe('alpha');
    expect(summary.comparisons.length).toBe(3);
    expect(summary.comparisons[0].name).toBe('Render');
    expect(summary.comparisons[0].rankings).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    expect(summary.comparisons[1].name).toBe('Reload');
    expect(summary.comparisons[1].rankings).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    expect(summary.comparisons[2].name).toBe('Race');

    for (const racer of RACERS) {
      const racerDir = path.join(resultsDir, racer.name);
      const measurements = JSON.parse(
        fs.readFileSync(path.join(racerDir, 'measurements.json'), 'utf-8')
      );

      expect(measurements.length).toBe(2);

      const renderMs = measurements[0].duration * 1000;
      expect(renderMs).toBeGreaterThan(racer.targetMs - DURATION_TOLERANCE_MS);
      expect(renderMs).toBeLessThan(racer.targetMs + DURATION_TOLERANCE_MS);

      const reloadMs = measurements[1].duration * 1000;
      expect(reloadMs).toBeGreaterThan(racer.reloadTargetMs - DURATION_TOLERANCE_MS);
      expect(reloadMs).toBeLessThan(racer.reloadTargetMs + DURATION_TOLERANCE_MS);

      const raceVideo = path.join(racerDir, `${racer.name}.race.webm`);
      expect(fs.existsSync(raceVideo)).toBe(true);
    }
  });

  it('green cue appears within first 20% of each video', () => {
    if (!resultsDir) return;

    for (const racer of RACERS) {
      const raceVideo = path.join(resultsDir, racer.name, `${racer.name}.race.webm`);
      const duration = getVideoDuration(raceVideo);
      const { greenFrames } = detectCues(raceVideo);

      expect(greenFrames.length).toBeGreaterThanOrEqual(1);
      const firstGreen = greenFrames[0];
      expect(firstGreen).toBeLessThan(duration * 0.2);
    }
  });

  it('red cue appears after green cue with correct separation', () => {
    if (!resultsDir) return;

    for (const racer of RACERS) {
      const raceVideo = path.join(resultsDir, racer.name, `${racer.name}.race.webm`);
      const { greenFrames, redFrames } = detectCues(raceVideo);

      expect(greenFrames.length).toBeGreaterThanOrEqual(1);
      expect(redFrames.length).toBeGreaterThanOrEqual(1);

      const lastGreen = greenFrames[greenFrames.length - 1];
      const firstRed = redFrames[0];

      // Red cue must appear after green cue
      expect(firstRed).toBeGreaterThan(lastGreen);

      // Gap between cues should roughly match the recording window
      // (300ms padding + race + 300ms padding + medal overhead)
      const gapS = firstRed - lastGreen;
      const expectedGapMin = racer.recordingWindow * 0.5;
      expect(gapS).toBeGreaterThan(expectedGapMin);
    }
  });

  it('calibratedStart points to the first green cue frame', () => {
    if (!resultsDir) return;

    const html = fs.readFileSync(path.join(resultsDir, 'index.html'), 'utf-8');
    const ctMatch = html.match(/const clipTimes = (\[.*?\]);/);
    expect(ctMatch).not.toBeNull();
    const clipTimes = JSON.parse(ctMatch[1]);

    for (let i = 0; i < RACERS.length; i++) {
      const ct = clipTimes[i];
      if (!ct || ct.calibratedStart == null) continue;

      const raceVideo = path.join(resultsDir, RACERS[i].name, `${RACERS[i].name}.race.webm`);
      const { greenFrames } = detectCues(raceVideo);
      expect(greenFrames.length).toBeGreaterThanOrEqual(1);

      const firstGreen = greenFrames[0];

      // calibratedStart should be within ~3 frames of the first green cue (CDP and cue-based may diverge slightly)
      expect(Math.abs(ct.calibratedStart - firstGreen)).toBeLessThan(0.12);
    }
  });

  it('racers with longer races have later red cues (ordering preserved)', () => {
    if (!resultsDir) return;

    const firstRedTimes = [];
    for (const racer of RACERS) {
      const raceVideo = path.join(resultsDir, racer.name, `${racer.name}.race.webm`);
      const { redFrames } = detectCues(raceVideo);
      expect(redFrames.length).toBeGreaterThanOrEqual(1);
      firstRedTimes.push(redFrames[0]);
    }

    // Each subsequent racer has a longer race, so red cue should appear later
    for (let i = 1; i < firstRedTimes.length; i++) {
      expect(firstRedTimes[i]).toBeGreaterThan(firstRedTimes[i - 1]);
    }
  });

  afterAll(() => {
    if (resultsDir && fs.existsSync(resultsDir)) {
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });
});
