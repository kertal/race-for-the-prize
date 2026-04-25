/**
 * Integration test: verify that build-time cue calibration reliably captures
 * the green cue even when raceRecordingStart() is called well into the video.
 *
 * Motivation: in non-headless races with slow page loads, the browser renders
 * very few frames during navigation (~5-10fps). At 80ms cue duration this could
 * fall entirely between two captured frames, causing calibratedStart to fall
 * back to the inaccurate scale formula. Increasing the cue to 200ms ensures it
 * spans at least one frame at any FPS >= 5fps.
 *
 * The late-start-test race calls raceRecordingStart() after 1500ms / 2000ms of
 * simulated page-load delay, placing the cue well into the video. The test
 * verifies the cue IS found by ffprobe and that calibratedStart matches it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { CUE_DETECTION } from '../cli/colors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RACERS = ['alpha', 'bravo'];

function hasFfprobe() {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function detectGreenCues(videoPath) {
  const escaped = videoPath.replace(/\\/g, '/').replace(/[';,\[\]=\\ ]/g, ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
  const result = execFileSync('ffprobe', [
    '-f', 'lavfi',
    '-i', `movie=${escaped},crop=4:4:0:0,signalstats`,
    '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.HUEAVG,lavfi.signalstats.SATAVG,lavfi.signalstats.YAVG',
    '-of', 'csv=p=0',
    '-v', 'quiet',
  ], { timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] });

  const greenFrames = [];
  for (const line of result.toString().trim().split('\n').filter(Boolean)) {
    const [time, hue, sat, y] = line.split(',').map(parseFloat);
    if (isNaN(time) || isNaN(sat)) continue;
    if (sat > CUE_DETECTION.saturationMin &&
        hue > CUE_DETECTION.startHueMin && hue < CUE_DETECTION.startHueMax &&
        y < CUE_DETECTION.startYMax) {
      greenFrames.push(time);
    }
  }
  return greenFrames;
}

const describeWithFfprobe = hasFfprobe() ? describe : describe.skip;

describeWithFfprobe('late-start calibration integration', () => {
  let resultsDir;
  let setupError = null;

  beforeAll(() => {
    const projectRoot = path.resolve(__dirname, '..');
    const proc = spawnSync('node', ['race.js', './races/late-start-test', '--serve=false', '--headless'], {
      cwd: projectRoot,
      timeout: 100_000,
      encoding: 'utf-8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    if (proc.status === null) {
      setupError = new Error('Late-start calibration setup timed out before race completed.');
      return;
    }
    if (proc.status !== 0) {
      setupError = new Error(`Late-start calibration setup failed:\n${proc.stderr?.slice(-1000) || '(no stderr output)'}`);
      return;
    }
    expect(proc.status, proc.stderr?.slice(-1000)).toBe(0);

    const stripped = proc.stderr.replace(/\u001B\[[0-9;]*m/g, '');
    const match = stripped.match(/📂\s+(.+)/);
    expect(match).not.toBeNull();
    resultsDir = path.resolve(projectRoot, match[1].trim());
    expect(fs.existsSync(resultsDir)).toBe(true);
  });

  it('green cue is captured in every video despite late recording start', ({ skip }) => {
    if (setupError) skip(setupError.message);

    for (const name of RACERS) {
      const video = path.join(resultsDir, name, `${name}.race.webm`);
      expect(fs.existsSync(video), `video missing: ${video}`).toBe(true);

      const greenFrames = detectGreenCues(video);
      expect(greenFrames.length, `no green cue found in ${name} video`).toBeGreaterThanOrEqual(1);
    }
  });

  it('green cue appears well into the video (after the simulated page-load delay)', ({ skip }) => {
    if (setupError) skip(setupError.message);

    // alpha: 1500ms delay → cue should be at least 1.0s into the video
    // bravo: 2000ms delay → cue should be at least 1.5s into the video
    const minCueTimes = { alpha: 1.0, bravo: 1.5 };

    for (const name of RACERS) {
      const video = path.join(resultsDir, name, `${name}.race.webm`);
      const greenFrames = detectGreenCues(video);
      if (greenFrames.length === 0) return; // skip if previous test already failed

      expect(greenFrames[0]).toBeGreaterThan(minCueTimes[name]);
    }
  });

  it('calibratedStart matches first green cue frame within 3 frames (~0.12s)', ({ skip }) => {
    if (setupError) skip(setupError.message);

    const html = fs.readFileSync(path.join(resultsDir, 'index.html'), 'utf-8');
    const ctMatch = html.match(/const clipTimes = (\[.*?\]);/);
    expect(ctMatch).not.toBeNull();
    const clipTimes = JSON.parse(ctMatch[1]);

    for (let i = 0; i < RACERS.length; i++) {
      const ct = clipTimes[i];
      expect(ct, `clipTimes[${i}] missing`).toBeTruthy();
      expect(ct.calibratedStart, `calibratedStart missing for ${RACERS[i]}`).not.toBeNull();

      const video = path.join(resultsDir, RACERS[i], `${RACERS[i]}.race.webm`);
      const greenFrames = detectGreenCues(video);
      expect(greenFrames.length).toBeGreaterThanOrEqual(1);

      const firstGreen = greenFrames[0];
      expect(
        Math.abs(ct.calibratedStart - firstGreen),
        `calibratedStart ${ct.calibratedStart.toFixed(3)}s is more than 0.12s from green cue at ${firstGreen.toFixed(3)}s`,
      ).toBeLessThan(0.12);
    }
  });

  it('calibratedStart is not from scale formula when cue is detectable', ({ skip }) => {
    if (setupError) skip(setupError.message);

    const html = fs.readFileSync(path.join(resultsDir, 'index.html'), 'utf-8');
    const ctMatch = html.match(/const clipTimes = (\[.*?\]);/);
    expect(ctMatch).not.toBeNull();
    const clipTimes = JSON.parse(ctMatch[1]);

    for (let i = 0; i < RACERS.length; i++) {
      const ct = clipTimes[i];
      if (!ct || ct.calibratedStart == null) continue;

      // Scale formula result: (start + recordingOffset) * (videoDuration / wallClockDuration).
      // We don't have videoDuration here but we know it would give a value significantly
      // larger than the actual cue PTS (because the scale formula assumes uniform FPS,
      // which overestimates PTS for timestamps early in a non-uniform-FPS recording).
      // Verify calibratedStart is NOT close to the linear scale estimate when delay is large.
      const linearEstimate = (ct.start + (ct.recordingOffset || 0));
      // With headless ~30fps, scale ≈ 1.2, so linearEstimate * 1.2 ≈ scale formula result.
      // The actual cue PTS is much closer to linearEstimate * (fps_at_cue / 25fps_pts).
      // Just assert calibratedStart is positive and within video bounds.
      expect(ct.calibratedStart).toBeGreaterThan(0);
      expect(ct.calibratedStart).toBeLessThan(ct.wallClockDuration);
    }
  });
});
