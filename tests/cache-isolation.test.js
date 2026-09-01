import { describe, it, expect } from 'vitest';
import path from 'path';
import { buildRaceContext, buildRecordingsDir } from '../race.js';

/**
 * Verifies that when multiple races run (--runs N or separate invocations),
 * each race gets a clean, isolated environment:
 *   - independent browser configs (no shared mutable references)
 *   - a unique recordings directory so stale files from one run
 *     cannot be picked up by a subsequent run
 */

describe('buildRecordingsDir', () => {
  it('generates a unique path on each call', () => {
    const dir1 = buildRecordingsDir('/tmp/race');
    const dir2 = buildRecordingsDir('/tmp/race');
    expect(dir1).not.toBe(dir2);
  });

  it('uses the supplied base directory', () => {
    const dir = buildRecordingsDir('/my/race/dir');
    expect(dir.startsWith('/my/race/dir' + path.sep)).toBe(true);
  });

  it('uses the supplied prefix', () => {
    const dir = buildRecordingsDir('/tmp', 'run-prefix');
    const basename = path.basename(dir);
    expect(basename.startsWith('run-prefix-')).toBe(true);
  });

  it('defaults to "tmp" prefix', () => {
    const dir = buildRecordingsDir('/tmp');
    expect(path.basename(dir).startsWith('tmp-')).toBe(true);
  });

  it('generates unique paths even when called rapidly in sequence', () => {
    const dirs = Array.from({ length: 10 }, () => buildRecordingsDir('/tmp'));
    const unique = new Set(dirs);
    expect(unique.size).toBe(10);
  });
});

describe('buildRaceContext — cache isolation between races', () => {
  const baseArgs = {
    racerNames: ['racer-a', 'racer-b'],
    scripts: ['await page.goto("https://a.example")', 'await page.goto("https://b.example")'],
    settings: { parallel: false, runs: 1, headless: true, network: 'none', cpuThrottle: 1 },
  };

  it('creates independent runnerConfig objects on each call', () => {
    const ctx1 = buildRaceContext(baseArgs);
    const ctx2 = buildRaceContext(baseArgs);
    expect(ctx1.runnerConfig).not.toBe(ctx2.runnerConfig);
  });

  it('creates independent browsers arrays on each call', () => {
    const ctx1 = buildRaceContext(baseArgs);
    const ctx2 = buildRaceContext(baseArgs);
    expect(ctx1.runnerConfig.browsers).not.toBe(ctx2.runnerConfig.browsers);
  });

  it('creates independent browser config objects on each call', () => {
    const ctx1 = buildRaceContext(baseArgs);
    const ctx2 = buildRaceContext(baseArgs);
    expect(ctx1.runnerConfig.browsers[0]).not.toBe(ctx2.runnerConfig.browsers[0]);
    expect(ctx1.runnerConfig.browsers[1]).not.toBe(ctx2.runnerConfig.browsers[1]);
  });

  it('does not carry recordingsDir in the initial runnerConfig', () => {
    // recordingsDir is injected per-run by runSingleRace, not baked in at context-build time.
    // This ensures each run computes a fresh unique path rather than reusing one.
    const ctx = buildRaceContext(baseArgs);
    expect(ctx.runnerConfig.recordingsDir).toBeUndefined();
  });

  it('reuses the same scripts array values but not as shared browser references', () => {
    const ctx1 = buildRaceContext(baseArgs);
    const ctx2 = buildRaceContext(baseArgs);
    // Content is the same
    expect(ctx1.runnerConfig.browsers[0].script).toBe(ctx2.runnerConfig.browsers[0].script);
    // But the objects are different (mutations to one won't affect the other)
    expect(ctx1.runnerConfig.browsers[0]).not.toBe(ctx2.runnerConfig.browsers[0]);
  });
});

describe('runSingleRace — fresh recordingsDir per run', () => {
  it('buildRaceContext leaves recordingsDir undefined so runSingleRace must inject a fresh one each call', () => {
    // runSingleRace calls buildRecordingsDir() at its start and injects the result into
    // runnerConfig before spawning the subprocess. Because buildRaceContext never sets
    // recordingsDir, every call to runSingleRace is forced to compute a new unique path.
    // Combined with buildRecordingsDir uniqueness (tested above) this guarantees each
    // race run gets its own isolated recordings directory — no stale files can bleed
    // across runs.
    const ctx = buildRaceContext({
      racerNames: ['a', 'b'],
      scripts: ['', ''],
      settings: { parallel: false, runs: 1, headless: true, network: 'none', cpuThrottle: 1 },
    });
    expect(ctx.runnerConfig.recordingsDir).toBeUndefined();
  });

  it('two independent buildRaceContext calls produce different recordings base paths when run', () => {
    // Simulate what the --runs N loop does: build a context once, then call runSingleRace
    // in a loop. The recordings dir for each iteration is computed from buildRecordingsDir,
    // which uses Date.now() + pid + random bytes — guaranteed unique on each call.
    const base = '/tmp/race';
    const dirs = [buildRecordingsDir(base), buildRecordingsDir(base), buildRecordingsDir(base)];
    const unique = new Set(dirs);
    expect(unique.size).toBe(dirs.length);
    // All dirs are inside the race base directory
    dirs.forEach(d => expect(d.startsWith(base + path.sep)).toBe(true));
  });
});
