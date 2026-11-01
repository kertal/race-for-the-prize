import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadRaceDir, applySettingsOrExit } from '../cli/race-loader.js';

let tmpDir;
let exitSpy;
let errorSpy;

/** Thrown by the process.exit stub so exiting code paths stop like the real thing. */
class ExitError extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-loader-test-'));
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ExitError(code);
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Call loadRaceDir with default flags and an identity context builder. */
function load(raceDir = tmpDir, overrides = {}) {
  return loadRaceDir(raceDir, {
    boolFlags: new Set(),
    kvFlags: {},
    rootDir: '/fake/root',
    buildContext: (opts) => opts,
    ...overrides,
  });
}

/** Assert fn exits with the given code and printed a message containing text. */
function expectExit(fn, code, text) {
  let thrown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ExitError);
  expect(thrown.code).toBe(code);
  const output = errorSpy.mock.calls.map(args => args.join(' ')).join('\n');
  expect(output).toContain(text);
}

function writeSettings(obj) {
  fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify(obj, null, 2));
}

describe('loadRaceDir happy paths', () => {
  it('loads a multi-spec race directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '// alpha script');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '// beta script');

    const { ctx, settings, racerNames } = load();
    expect(racerNames).toEqual(['alpha', 'beta']);
    expect(ctx.racerFiles).toEqual(['alpha.spec.js', 'beta.spec.js']);
    expect(ctx.scripts).toEqual(['// alpha script', '// beta script']);
    expect(ctx.raceDir).toBe(tmpDir);
    expect(ctx.rootDir).toBe('/fake/root');
    expect(settings).toBeTypeOf('object');
  });

  it('loads a shared-spec race directory (race.spec.js + settings.racers)', () => {
    fs.writeFileSync(path.join(tmpDir, 'race.spec.js'), '// shared script');
    writeSettings({ racers: { fast: {}, slow: {} } });

    const { ctx, racerNames } = load();
    expect(racerNames).toEqual(['fast', 'slow']);
    // Physical files deduplicated, but one script payload per racer
    expect(ctx.racerFiles).toEqual(['race.spec.js']);
    expect(ctx.scripts).toEqual(['// shared script', '// shared script']);
  });

  it('applies a valid per-racer script override (basename within raceDir)', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '// alpha default');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '// beta default');
    fs.writeFileSync(path.join(tmpDir, 'custom.js'), '// custom override');
    writeSettings({ racers: { alpha: { script: 'custom.js' } } });

    const { ctx } = load();
    expect(ctx.racerFiles).toEqual(['custom.js', 'beta.spec.js']);
    expect(ctx.scripts).toEqual(['// custom override', '// beta default']);
  });

  it('applies CLI flag overrides via boolFlags/kvFlags', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const { settings } = load(tmpDir, { boolFlags: new Set(['headless', 'parallel']) });
    expect(settings.headless).toBe(true);
    expect(settings.parallel).toBe(true);
  });
});

describe('loadRaceDir script-override security validation', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '// alpha');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '// beta');
  });

  it('rejects an empty-string script override instead of silently ignoring it', () => {
    // A supplied but falsy value used to fall through to the discovered file,
    // bypassing validation entirely.
    writeSettings({ racers: { alpha: { script: '' } } });
    expectExit(() => load(), 1, 'must be a non-empty string');
  });

  it('rejects a non-string falsy script override', () => {
    writeSettings({ racers: { alpha: { script: false } } });
    expectExit(() => load(), 1, 'must be a non-empty string');
  });

  it('rejects script overrides containing path separators', () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'x.js'), '// nested');
    writeSettings({ racers: { alpha: { script: 'sub/x.js' } } });
    expectExit(() => load(), 1, 'must be a filename (no path separators): sub/x.js');
  });

  it('rejects script overrides with .. traversal', () => {
    writeSettings({ racers: { alpha: { script: '../outside.js' } } });
    expectExit(() => load(), 1, 'must be a filename (no path separators): ../outside.js');
  });

  it('rejects script overrides containing .. anywhere in the name', () => {
    writeSettings({ racers: { alpha: { script: 'a..b.js' } } });
    expectExit(() => load(), 1, 'must be a filename (no path separators): a..b.js');
  });

  it('rejects absolute path script overrides', () => {
    const outside = path.join(os.tmpdir(), 'race-loader-outside.js');
    fs.writeFileSync(outside, '// outside');
    try {
      writeSettings({ racers: { alpha: { script: outside } } });
      expectExit(() => load(), 1, 'must be a filename (no path separators)');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('rejects script overrides that do not exist', () => {
    writeSettings({ racers: { alpha: { script: 'nope.js' } } });
    expectExit(() => load(), 1, 'not found: nope.js');
  });

  it('rejects symlink script overrides', () => {
    fs.writeFileSync(path.join(tmpDir, 'target.js'), '// target');
    fs.symlinkSync(path.join(tmpDir, 'target.js'), path.join(tmpDir, 'link.js'));
    writeSettings({ racers: { alpha: { script: 'link.js' } } });
    expectExit(() => load(), 1, 'must be a regular file (symlinks and directories are not allowed): link.js');
  });

  it('rejects directory script overrides', () => {
    fs.mkdirSync(path.join(tmpDir, 'dir.js'));
    writeSettings({ racers: { alpha: { script: 'dir.js' } } });
    expectExit(() => load(), 1, 'must be a regular file (symlinks and directories are not allowed): dir.js');
  });

  it('rejects whitespace-only script overrides', () => {
    writeSettings({ racers: { alpha: { script: '   ' } } });
    expectExit(() => load(), 1, 'must be a non-empty string');
  });

  it('rejects non-string script overrides', () => {
    writeSettings({ racers: { alpha: { script: 42 } } });
    expectExit(() => load(), 1, 'must be a non-empty string');
  });

  it('rejects per-racer script overrides in shared-spec mode', () => {
    fs.rmSync(path.join(tmpDir, 'alpha.spec.js'));
    fs.rmSync(path.join(tmpDir, 'beta.spec.js'));
    fs.writeFileSync(path.join(tmpDir, 'race.spec.js'), '// shared');
    writeSettings({ racers: { fast: { script: 'evil.js' }, slow: {} } });
    expectExit(() => load(), 1, 'shared-spec mode does not support settings.racers.fast.script');
  });
});

describe('loadRaceDir discovered-script validation', () => {
  // Discovery and shared-spec mode pick files by name alone, so without an
  // explicit check readFileSync would follow a link straight out of raceDir.
  let outsideDir;
  let outside;

  beforeEach(() => {
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-loader-outside-'));
    outside = path.join(outsideDir, 'elsewhere.js');
    fs.writeFileSync(outside, '// outside the race dir');
  });

  afterEach(() => {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('rejects a discovered spec file that is a symlink', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '// alpha');
    fs.symlinkSync(outside, path.join(tmpDir, 'beta.spec.js'));
    expectExit(() => load(), 1, 'must be a regular file (symlinks and directories are not allowed): beta.spec.js');
  });

  it('rejects a shared race.spec.js that is a symlink', () => {
    // Only race.spec.js + settings.racers, so this really is shared-spec mode.
    fs.symlinkSync(outside, path.join(tmpDir, 'race.spec.js'));
    writeSettings({ racers: { fast: {}, slow: {} } });
    expectExit(() => load(), 1, 'must be a regular file (symlinks and directories are not allowed): race.spec.js');
  });

  it('still loads a directory of ordinary spec files', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '// alpha');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '// beta');
    const { ctx } = load();
    expect(ctx.scripts).toEqual(['// alpha', '// beta']);
  });
});

describe('loadRaceDir error handling', () => {
  it('exits when the race directory does not exist', () => {
    expectExit(() => load(path.join(tmpDir, 'missing')), 1, 'Race directory not found');
  });

  it('exits when settings.json is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), '{ not json');
    expectExit(() => load(), 1, 'Could not parse settings.json');
  });

  it('exits when fewer than 2 racer scripts are found', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    expectExit(() => load(), 1, 'Need at least 2 .spec.js (or .js) script files');
  });

  it('exits on ambiguous shared-spec directories (race.spec.js + matching racer .js)', () => {
    fs.writeFileSync(path.join(tmpDir, 'race.spec.js'), '// shared');
    fs.writeFileSync(path.join(tmpDir, 'fast.js'), '// fast');
    writeSettings({ racers: { fast: {}, slow: {} } });
    expectExit(() => load(), 1, 'Ambiguous race directory');
  });

  it('exits with code 2 on invalid shared-spec racers config', () => {
    fs.writeFileSync(path.join(tmpDir, 'race.spec.js'), '// shared');
    writeSettings({ racers: { onlyone: {} } });
    expectExit(() => load(), 2, 'shared-spec mode requires at least 2 racers');
  });
});

describe('applySettingsOrExit', () => {
  it('applies overrides and defaults', () => {
    const settings = applySettingsOrExit({}, new Set(['headless']), {});
    expect(settings.headless).toBe(true);
    expect(settings.runs).toBeGreaterThanOrEqual(1);
  });

  it('exits with code 2 on invalid setting values', () => {
    expectExit(() => applySettingsOrExit({}, new Set(), { network: 'warp-speed' }), 2, 'Unknown network preset');
  });
});
