import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverRacers, parseArgs, applyOverrides } from '../cli/config.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('racer file discovery', () => {
  it('prefers .spec.js files over .js files', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'gamma.js'), '');

    const { racerFiles, racerNames } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual(['alpha.spec.js', 'beta.spec.js']);
    expect(racerNames).toEqual(['alpha', 'beta']);
  });

  it('falls back to .js when fewer than 2 .spec.js files', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.js'), '');

    const { racerFiles, racerNames } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual(['alpha.js', 'beta.js']);
    expect(racerNames).toEqual(['alpha', 'beta']);
  });

  it('falls back to .js when only 1 .spec.js exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'gamma.js'), '');

    const { racerFiles } = discoverRacers(tmpDir);
    // Falls back to all .js files including the .spec.js
    expect(racerFiles.length).toBe(3);
    expect(racerFiles).toEqual(['alpha.spec.js', 'beta.js', 'gamma.js']);
  });

  it('allows 3 racers when 3 spec files found', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'c.spec.js'), '');

    const { racerFiles, racerNames } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual(['a.spec.js', 'b.spec.js', 'c.spec.js']);
    expect(racerNames).toEqual(['a', 'b', 'c']);
  });

  it('allows 4 racers when 4 spec files found', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'c.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'd.spec.js'), '');

    const { racerFiles, racerNames } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual(['a.spec.js', 'b.spec.js', 'c.spec.js', 'd.spec.js']);
    expect(racerNames).toEqual(['a', 'b', 'c', 'd']);
  });

  it('allows 5 racers when 5 spec files found', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'c.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'd.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'e.spec.js'), '');

    const { racerFiles, racerNames } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual(['a.spec.js', 'b.spec.js', 'c.spec.js', 'd.spec.js', 'e.spec.js']);
    expect(racerNames).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('limits to first 5 files when more than 5 found', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'c.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'd.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'e.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'f.spec.js'), '');

    const { racerFiles, racerNames } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual(['a.spec.js', 'b.spec.js', 'c.spec.js', 'd.spec.js', 'e.spec.js']);
    expect(racerNames).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('sorts files alphabetically', () => {
    fs.writeFileSync(path.join(tmpDir, 'zulu.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');

    const { racerNames } = discoverRacers(tmpDir);
    expect(racerNames).toEqual(['alpha', 'zulu']);
  });

  it('ignores dotfiles', () => {
    fs.writeFileSync(path.join(tmpDir, '.hidden.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { racerFiles } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual(['a.spec.js', 'b.spec.js']);
  });

  it('strips .spec.js correctly from compound names', () => {
    fs.writeFileSync(path.join(tmpDir, 'my-app.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'other.thing.spec.js'), '');

    const { racerNames } = discoverRacers(tmpDir);
    expect(racerNames).toEqual(['my-app', 'other.thing']);
  });

  it('returns empty when no js files exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), '{}');

    const { racerFiles } = discoverRacers(tmpDir);
    expect(racerFiles).toEqual([]);
  });
});

describe('argument parsing', () => {
  it('separates positional args from flags', () => {
    const { positional, boolFlags, kvFlags } = parseArgs(['./races/test', '--parallel', '--network=slow-3g']);
    expect(positional).toEqual(['./races/test']);
    expect(boolFlags.has('parallel')).toBe(true);
    expect(kvFlags.network).toBe('slow-3g');
  });

  it('handles multiple boolean flags', () => {
    const { boolFlags } = parseArgs(['dir', '--parallel', '--headless', '--results']);
    expect(boolFlags.has('parallel')).toBe(true);
    expect(boolFlags.has('headless')).toBe(true);
    expect(boolFlags.has('results')).toBe(true);
  });

  it('parses --no-overlay flag', () => {
    const { boolFlags } = parseArgs(['dir', '--no-overlay']);
    expect(boolFlags.has('no-overlay')).toBe(true);
  });

  it('handles key=value flags', () => {
    const { kvFlags } = parseArgs(['dir', '--network=fast-3g', '--cpu=4']);
    expect(kvFlags.network).toBe('fast-3g');
    expect(kvFlags.cpu).toBe('4');
  });

  it('handles no arguments', () => {
    const { positional, boolFlags, kvFlags } = parseArgs([]);
    expect(positional).toEqual([]);
    expect(boolFlags.size).toBe(0);
    expect(Object.keys(kvFlags)).toHaveLength(0);
  });

  it('handles value with equals sign in it', () => {
    const { kvFlags } = parseArgs(['--key=a=b=c']);
    expect(kvFlags.key).toBe('a=b=c');
  });
});

describe('settings override', () => {
  it('CLI --parallel overrides sequential default', () => {
    const s = applyOverrides({}, new Set(['parallel']), {});
    expect(s.parallel).toBe(true);
  });

  it('CLI --headless sets headless', () => {
    const s = applyOverrides({}, new Set(['headless']), {});
    expect(s.headless).toBe(true);
  });

  it('CLI --network overrides settings.json network', () => {
    const s = applyOverrides({ network: 'none' }, new Set(), { network: 'slow-3g' });
    expect(s.network).toBe('slow-3g');
  });

  it('CLI --cpu overrides settings.json cpuThrottle', () => {
    const s = applyOverrides({ cpuThrottle: 1 }, new Set(), { cpu: '4' });
    expect(s.cpuThrottle).toBe(4);
  });

  it('CLI --profile sets profile', () => {
    const s = applyOverrides({}, new Set(['profile']), {});
    expect(s.profile).toBe(true);
  });

  it('CLI --no-overlay sets noOverlay', () => {
    const s = applyOverrides({}, new Set(['no-overlay']), {});
    expect(s.noOverlay).toBe(true);
  });

  it('CLI --slowmo sets slowmo factor', () => {
    const s = applyOverrides({}, new Set(), { slowmo: '3' });
    expect(s.slowmo).toBe(3);
  });

  it('preserves settings when no overrides', () => {
    const orig = { parallel: true, network: 'fast-3g', cpuThrottle: 2 };
    const s = applyOverrides(orig, new Set(), {});
    expect(s).toEqual(orig);
  });

  it('does not mutate original settings', () => {
    const orig = { parallel: false };
    applyOverrides(orig, new Set(['parallel']), {});
    expect(orig.parallel).toBe(false);
  });
});
