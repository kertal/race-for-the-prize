import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSingleRace, buildRaceContext } from '../race.js';

/**
 * runSingleRace with the runner replaced by a stub that drops files into the
 * temp recordings dir, the way runner.cjs does. What survives in the results
 * directory afterwards is the point of these tests.
 */

const racerNames = ['lauda', 'hunt'];

const baseSettings = {
  parallel: false, headless: true, runs: 1, network: 'none', cpuThrottle: 1,
  format: 'webm', ffmpeg: false, slowmo: 0, noOverlay: false, noRecording: false,
  har: false, noWasm: true, fps: false, wallClock: false, cueMarkers: false,
  ignoreHTTPSErrors: false, viewportHeight: 720,
};

const browserResult = (id) => ({
  id,
  tracePath: `${id}/${id}.trace.json`,
  measurements: [{ name: 'Load', startTime: 0, endTime: 1000, duration: 1000 }],
  profileMetrics: null,
  recordingSegments: [{ start: 0, end: 1.5 }],
  recordingOffset: 0,
  wallClockDuration: 2,
  calibratedStart: null,
  traceCalibration: null,
  error: null,
});

/** A runner stand-in: writes `files` for every racer, then reports normally. */
const stubRunner = (files) => vi.fn(async (raceCtx) => {
  for (const name of raceCtx.racerNames) {
    const dir = path.join(raceCtx.runnerConfig.recordingsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files(name)) fs.writeFileSync(path.join(dir, file), `${file}\n`);
  }
  return { protocolVersion: raceCtx.runnerConfig.protocolVersion, browsers: raceCtx.racerNames.map(browserResult) };
});

describe('runSingleRace', () => {
  let tmp, runDir;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-single-race-'));
    runDir = path.join(tmp, 'results');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps the HAR and the trace when recording is off', async () => {
    // --har --recording=false used to copy only the trace out of the temp
    // recordings dir, then delete the dir with the HAR still in it.
    const settings = { ...baseSettings, har: true, noRecording: true };
    const ctx = buildRaceContext({ racerNames, scripts: ['', ''], settings, raceDir: tmp });
    const spawn = stubRunner(name => [`${name}.har`, `${name}.trace.json`]);

    const { summary, clipTimes } = await runSingleRace(ctx, runDir, null, { spawn });

    for (const name of racerNames) {
      const dir = path.join(runDir, name);
      expect(fs.existsSync(path.join(dir, `${name}.har`))).toBe(true);
      expect(fs.existsSync(path.join(dir, `${name}.trace.json`))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'measurements.json'))).toBe(true);
    }
    // No recording: measurements and summary only, no player.
    expect(fs.existsSync(path.join(runDir, 'summary.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'index.html'))).toBe(false);
    expect(clipTimes).toBeNull();
    expect(summary.racers).toEqual(racerNames);
    // The temp recordings dir is gone either way.
    expect(fs.readdirSync(tmp).filter(f => f.startsWith('tmp-'))).toEqual([]);
  });

  it('builds the player with links to every file it kept', async () => {
    const settings = { ...baseSettings, har: true };
    const ctx = buildRaceContext({ racerNames, scripts: ['', ''], settings, raceDir: tmp });
    const spawn = stubRunner(name => [`${name}.webm`, `${name}.har`, `${name}.trace.json`]);

    const { clipTimes } = await runSingleRace(ctx, runDir, null, { spawn, skipCopyFFmpeg: true });

    const html = fs.readFileSync(path.join(runDir, 'index.html'), 'utf-8');
    for (const name of racerNames) {
      expect(fs.existsSync(path.join(runDir, name, `${name}.race.webm`))).toBe(true);
      expect(html).toContain(`${name}/${name}.har`);
      expect(html).toContain(`${name}/${name}.trace.json`);
    }
    expect(clipTimes).toHaveLength(2);
    expect(clipTimes[0]).toMatchObject({ start: 0, end: 1.5 });
  });
});
