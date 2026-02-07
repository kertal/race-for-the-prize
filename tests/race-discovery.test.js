import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverRacers, parseArgs, applyOverrides, discoverSetupTeardown, discoverRacerSetupTeardown } from '../cli/config.js';

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

describe('setup/teardown discovery', () => {
  it('discovers setup.sh by convention', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash\necho "setup"');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup, teardown } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe('setup.sh');
    expect(teardown).toBe(null);
  });

  it('discovers teardown.sh by convention', () => {
    fs.writeFileSync(path.join(tmpDir, 'teardown.sh'), '#!/bin/bash\necho "teardown"');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup, teardown } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe(null);
    expect(teardown).toBe('teardown.sh');
  });

  it('discovers both setup.js and teardown.js', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.js'), 'console.log("setup")');
    fs.writeFileSync(path.join(tmpDir, 'teardown.js'), 'console.log("teardown")');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup, teardown } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe('setup.js');
    expect(teardown).toBe('teardown.js');
  });

  it('prefers .sh over .js for setup', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'setup.js'), 'console.log("setup")');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe('setup.sh');
  });

  it('prefers .sh over .js for teardown', () => {
    fs.writeFileSync(path.join(tmpDir, 'teardown.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'teardown.js'), 'console.log("teardown")');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { teardown } = discoverSetupTeardown(tmpDir);
    expect(teardown).toBe('teardown.sh');
  });

  it('settings.json setup overrides convention', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'custom-setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup } = discoverSetupTeardown(tmpDir, { setup: './custom-setup.sh' });
    expect(setup).toBe('./custom-setup.sh');
  });

  it('settings.json teardown overrides convention', () => {
    fs.writeFileSync(path.join(tmpDir, 'teardown.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { teardown } = discoverSetupTeardown(tmpDir, { teardown: { command: './cleanup.sh', timeout: 5000 } });
    expect(teardown).toEqual({ command: './cleanup.sh', timeout: 5000 });
  });

  it('settings.json can disable convention with null', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup } = discoverSetupTeardown(tmpDir, { setup: null });
    expect(setup).toBe(null);
  });

  it('returns null for both when no scripts exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup, teardown } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe(null);
    expect(teardown).toBe(null);
  });

  it('ignores dotfiles', () => {
    fs.writeFileSync(path.join(tmpDir, '.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe(null);
  });
});

describe('per-racer setup/teardown discovery', () => {
  it('discovers racer-specific setup.sh by convention', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.setup.sh'), '#!/bin/bash\necho "setup lauda"');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const { setup, teardown } = discoverRacerSetupTeardown(tmpDir, 'lauda');
    expect(setup).toBe('lauda.setup.sh');
    expect(teardown).toBe(null);
  });

  it('discovers racer-specific teardown.sh by convention', () => {
    fs.writeFileSync(path.join(tmpDir, 'hunt.teardown.sh'), '#!/bin/bash\necho "teardown hunt"');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const { setup, teardown } = discoverRacerSetupTeardown(tmpDir, 'hunt');
    expect(setup).toBe(null);
    expect(teardown).toBe('hunt.teardown.sh');
  });

  it('discovers both setup.js and teardown.js for a racer', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.setup.js'), 'console.log("setup")');
    fs.writeFileSync(path.join(tmpDir, 'lauda.teardown.js'), 'console.log("teardown")');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const { setup, teardown } = discoverRacerSetupTeardown(tmpDir, 'lauda');
    expect(setup).toBe('lauda.setup.js');
    expect(teardown).toBe('lauda.teardown.js');
  });

  it('prefers .sh over .js for racer scripts', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'lauda.setup.js'), 'console.log("setup")');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'lauda');
    expect(setup).toBe('lauda.setup.sh');
  });

  it('does not mix up scripts between racers', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'hunt.teardown.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const lauda = discoverRacerSetupTeardown(tmpDir, 'lauda');
    const hunt = discoverRacerSetupTeardown(tmpDir, 'hunt');

    expect(lauda.setup).toBe('lauda.setup.sh');
    expect(lauda.teardown).toBe(null);
    expect(hunt.setup).toBe(null);
    expect(hunt.teardown).toBe('hunt.teardown.sh');
  });

  it('settings.racers overrides convention', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'custom-lauda-setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const settings = {
      racers: {
        lauda: { setup: './custom-lauda-setup.sh' },
      },
    };

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'lauda', settings);
    expect(setup).toBe('./custom-lauda-setup.sh');
  });

  it('settings.racers can specify complex config', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const settings = {
      racers: {
        lauda: {
          setup: { command: './start-lauda.sh', timeout: 10000 },
          teardown: './stop-lauda.sh',
        },
      },
    };

    const { setup, teardown } = discoverRacerSetupTeardown(tmpDir, 'lauda', settings);
    expect(setup).toEqual({ command: './start-lauda.sh', timeout: 10000 });
    expect(teardown).toBe('./stop-lauda.sh');
  });

  it('settings.racers can disable convention with null', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const settings = {
      racers: {
        lauda: { setup: null },
      },
    };

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'lauda', settings);
    expect(setup).toBe(null);
  });

  it('returns null when no racer-specific scripts exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const { setup, teardown } = discoverRacerSetupTeardown(tmpDir, 'lauda');
    expect(setup).toBe(null);
    expect(teardown).toBe(null);
  });

  it('ignores global setup/teardown scripts', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'teardown.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'lauda.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'hunt.spec.js'), '');

    const { setup, teardown } = discoverRacerSetupTeardown(tmpDir, 'lauda');
    expect(setup).toBe(null);
    expect(teardown).toBe(null);
  });
});
