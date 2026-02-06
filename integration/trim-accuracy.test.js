import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RACERS = [
  { name: 'alpha',   targetMs: 600,  recordingWindow: 1.2 },
  { name: 'bravo',   targetMs: 800,  recordingWindow: 1.4 },
  { name: 'charlie', targetMs: 1000, recordingWindow: 1.6 },
  { name: 'delta',   targetMs: 1200, recordingWindow: 1.8 },
];

const DURATION_TOLERANCE_MS = 50;
const VIDEO_TOLERANCE_S = 1.0;

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

describe('trim-accuracy integration', () => {
  let resultsDir;

  beforeAll(() => {
    if (!hasFfprobe()) {
      throw new Error('ffprobe is not installed or not on PATH — skipping trim-accuracy tests');
    }
  });

  it('runs trim-test race and produces accurate results', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const raceDir = path.join(projectRoot, 'races', 'trim-test');

    // Run the race, capturing stderr to parse the results directory path
    const proc = spawnSync('node', ['race.js', './races/trim-test'], {
      cwd: projectRoot,
      timeout: 45_000,
      encoding: 'utf-8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    expect(proc.status).toBe(0);

    // Parse the results directory from the 📂 line in stderr (strip ANSI codes)
    const stripped = proc.stderr.replace(/\x1b\[[0-9;]*m/g, '');
    const match = stripped.match(/📂\s+(.+)/);
    expect(match).not.toBeNull();
    resultsDir = path.resolve(projectRoot, match[1].trim());
    expect(fs.existsSync(resultsDir)).toBe(true);

    // --- Verify summary.json ---
    const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));

    expect(summary.overallWinner).toBe('alpha');
    expect(summary.comparisons[0].rankings).toEqual(['alpha', 'bravo', 'charlie', 'delta']);

    // --- Verify each racer ---
    for (const racer of RACERS) {
      const racerDir = path.join(resultsDir, racer.name);
      const measurements = JSON.parse(
        fs.readFileSync(path.join(racerDir, 'measurements.json'), 'utf-8')
      );

      // Measurement duration should be close to target
      const durationMs = measurements[0].duration * 1000;
      expect(durationMs).toBeGreaterThan(racer.targetMs - DURATION_TOLERANCE_MS);
      expect(durationMs).toBeLessThan(racer.targetMs + DURATION_TOLERANCE_MS);

      // Video files should exist
      const raceVideo = path.join(racerDir, `${racer.name}.race.webm`);
      const fullVideo = path.join(racerDir, `${racer.name}.full.webm`);
      expect(fs.existsSync(raceVideo)).toBe(true);
      expect(fs.existsSync(fullVideo)).toBe(true);

      // Get video durations
      const raceDuration = getVideoDuration(raceVideo);
      const fullDuration = getVideoDuration(fullVideo);

      // Trimmed video should be shorter than full video
      expect(raceDuration).toBeLessThan(fullDuration);

      // Trimmed video duration should be close to expected recording window
      // (padding 300ms + race + padding 300ms + ~850ms medal/cue overhead)
      expect(raceDuration).toBeGreaterThan(racer.recordingWindow - VIDEO_TOLERANCE_S);
      expect(raceDuration).toBeLessThan(racer.recordingWindow + VIDEO_TOLERANCE_S);
    }
  });

  afterAll(() => {
    // Clean up results directory created by this test run
    if (resultsDir && fs.existsSync(resultsDir)) {
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });
});
