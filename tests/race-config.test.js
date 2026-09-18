import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRaceConfig,
  formatCommand,
  formatSettingValue,
  resolveSettingSources,
  shellQuote,
  sortSettingKeys,
  sourceLabel,
  writeRaceConfig,
  RACE_CONFIG_FILE,
  SOURCE_CLI,
  SOURCE_DEFAULT,
  SOURCE_FILE,
} from '../cli/race-config.js';
import { FLAG_SETTING_KEYS, KNOWN_FLAGS, applyOverrides } from '../cli/config.js';
import { storeRaceAssets } from '../race.js';

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-config-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

describe('formatCommand', () => {
  it('normalises the interpreter and script paths', () => {
    const argv = ['/usr/local/bin/node', '/opt/rftp/race.js', './races/x', '--parallel'];
    expect(formatCommand(argv)).toBe('node race.js ./races/x --parallel');
  });

  it('quotes an argument the shell would split', () => {
    expect(formatCommand(['node', 'race.js', '--gemini-spec=race two apps'])).toBe(
      "node race.js '--gemini-spec=race two apps'"
    );
  });

  it('survives an empty argv', () => {
    expect(formatCommand()).toBe('node race.js');
  });
});

describe('shellQuote', () => {
  it('leaves paths, flags and URLs unquoted', () => {
    for (const arg of ['./races/x', '--runs=3', 'https://react.dev/a-b_c']) {
      expect(shellQuote(arg)).toBe(arg);
    }
  });

  it('escapes an embedded single quote so the line stays pasteable', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('quotes the empty string', () => {
    expect(shellQuote('')).toBe("''");
  });
});

describe('resolveSettingSources', () => {
  const settings = { runs: 3, headless: true, network: 'slow-3g', format: 'webm' };

  it('credits a CLI flag over settings.json and defaults', () => {
    const sources = resolveSettingSources(settings, {
      fileSettings: { headless: true, network: 'slow-3g' },
      kvFlags: { network: 'slow-3g' },
      boolFlags: new Set(['parallel']),
    });
    expect(sources).toEqual({
      runs: SOURCE_DEFAULT,
      headless: SOURCE_FILE,
      network: SOURCE_CLI,
      format: SOURCE_DEFAULT,
    });
  });

  it('credits the flag even when it set the value settings.json already had', () => {
    // The flag was still passed; the report should say the run was told to do this.
    const sources = resolveSettingSources({ headless: true }, {
      fileSettings: { headless: true },
      boolFlags: new Set(['headless']),
    });
    expect(sources.headless).toBe(SOURCE_CLI);
  });

  it('maps a negated flag onto the setting it writes', () => {
    const sources = resolveSettingSources({ noRecording: false, noWasm: false }, {
      kvFlags: { recording: '0' },
    });
    expect(sources.noRecording).toBe(SOURCE_CLI);
    expect(sources.noWasm).toBe(SOURCE_DEFAULT);
  });

  it('treats a null in settings.json as no value at all', () => {
    const sources = resolveSettingSources({ skin: undefined }, { fileSettings: { skin: null } });
    expect(sources.skin).toBe(SOURCE_DEFAULT);
  });

  it('credits settings.json for a viewport height written under its "height" alias', () => {
    // applyOverrides folds the file's `height` into viewportHeight and drops the
    // alias, so the effective settings no longer show where the value came from.
    const sources = resolveSettingSources({ viewportHeight: 900 }, { fileSettings: { height: 900 } });
    expect(sources.viewportHeight).toBe(SOURCE_FILE);
  });

  it('ignores flags that touch no setting', () => {
    const sources = resolveSettingSources({ runs: 1 }, { boolFlags: new Set(['verbose', 'results']) });
    expect(sources.runs).toBe(SOURCE_DEFAULT);
  });

  it('works with no flags and no file at all', () => {
    expect(resolveSettingSources({ runs: 1 })).toEqual({ runs: SOURCE_DEFAULT });
  });
});

describe('FLAG_SETTING_KEYS', () => {
  // The map exists so the record can attribute a setting without re-running the
  // overrides. If applyOverrides ever writes a different key, this catches it.
  const sampleValue = {
    network: 'slow-3g',
    cpu: '4',
    skin: 'light',
    format: 'mov',
    runs: '2',
    slowmo: '2',
    height: '900',
  };

  it.each(Object.entries(FLAG_SETTING_KEYS))('--%s writes settings.%s', (flag, key) => {
    const value = sampleValue[flag] ?? 'true';
    const touched = Object.keys(applyOverrides({}, new Set(), { [flag]: value }));
    expect(touched).toEqual([key]);
  });

  // Flags that steer the CLI itself rather than a race setting. Every other
  // known flag must be in the map, so adding one without mapping it fails here
  // rather than silently reporting its setting as a "default" in the record.
  const NON_SETTING_FLAGS = new Set(['results', 'init', 'verbose', 'help', 'version', 'gemini-spec']);

  it('maps every flag that is not purely a CLI switch', () => {
    const unmapped = [...KNOWN_FLAGS].filter(
      flag => !NON_SETTING_FLAGS.has(flag) && !(flag in FLAG_SETTING_KEYS)
    );
    expect(unmapped).toEqual([]);
  });

  it('claims no flag that writes nothing', () => {
    const claimed = [...NON_SETTING_FLAGS].filter(flag => flag in FLAG_SETTING_KEYS);
    expect(claimed).toEqual([]);
  });

  it('leaves no setting written by a boolean flag unattributed', () => {
    const boolFlags = new Set([...KNOWN_FLAGS].filter(flag => !NON_SETTING_FLAGS.has(flag)));
    const mapped = Object.values(FLAG_SETTING_KEYS);
    const unmapped = Object.keys(applyOverrides({}, boolFlags, {})).filter(key => !mapped.includes(key));
    expect(unmapped).toEqual([]);
  });
});

describe('sortSettingKeys', () => {
  it('leads with the settings a racer reads first', () => {
    expect(sortSettingKeys(['format', 'headless', 'runs'])).toEqual(['runs', 'headless', 'format']);
  });

  it('appends unknown keys alphabetically, so a new setting still shows up', () => {
    expect(sortSettingKeys(['zebra', 'runs', 'apple'])).toEqual(['runs', 'apple', 'zebra']);
  });
});

describe('formatSettingValue', () => {
  it.each([
    [true, 'true'],
    [false, 'false'],
    [3, '3'],
    ['webm', 'webm'],
    [null, 'none'],
    [undefined, 'none'],
    ['', '(empty)'],
    [['slow-3g', '4g'], 'slow-3g, 4g'],
    [{ a: { vars: { x: 1 } } }, '{"a":{"vars":{"x":1}}}'],
  ])('renders %o as %s', (value, expected) => {
    expect(formatSettingValue(value)).toBe(expected);
  });
});

describe('sourceLabel', () => {
  it('names each source', () => {
    expect(sourceLabel(SOURCE_CLI)).toBe('CLI flag');
    expect(sourceLabel(SOURCE_FILE)).toBe('settings.json');
    expect(sourceLabel(SOURCE_DEFAULT)).toBe('default');
  });

  it('passes an unknown source through rather than blanking it', () => {
    expect(sourceLabel('elsewhere')).toBe('elsewhere');
  });
});

describe('buildRaceConfig', () => {
  const base = {
    argv: ['node', '/opt/race.js', './races/duel', '--runs=2'],
    settings: { runs: 2, headless: true, format: 'webm' },
    fileSettings: { headless: true },
    kvFlags: { runs: '2' },
    raceDir: '/work/races/duel',
    racerNames: ['lauda', 'hunt'],
    racerFiles: ['lauda.spec.js', 'hunt.spec.js'],
    version: '1.2.3',
    cwd: '/work',
  };

  it('records the command, the merged settings and where each came from', () => {
    const config = buildRaceConfig(base);
    expect(config.command).toBe('node race.js ./races/duel --runs=2');
    expect(config.version).toBe('1.2.3');
    expect(config.mode).toBe('directory');
    expect(config.raceDir).toBe('races/duel');
    expect(config.settings).toEqual(base.settings);
    expect(config.sources).toEqual({ runs: SOURCE_CLI, headless: SOURCE_FILE, format: SOURCE_DEFAULT });
  });

  it('pairs every racer with its script', () => {
    expect(buildRaceConfig(base).racers).toEqual([
      { name: 'lauda', script: 'lauda.spec.js' },
      { name: 'hunt', script: 'hunt.spec.js' },
    ]);
  });

  it('gives every shared-spec racer the one script they all run', () => {
    const config = buildRaceConfig({ ...base, mode: 'shared-spec', racerFiles: ['race.spec.js'] });
    expect(config.racers).toEqual([
      { name: 'lauda', script: 'race.spec.js' },
      { name: 'hunt', script: 'race.spec.js' },
    ]);
  });

  it('leaves the script unset in URL mode, where there is no spec file', () => {
    const config = buildRaceConfig({ ...base, mode: 'url', racerFiles: null });
    expect(config.mode).toBe('url');
    expect(config.racers.every(r => r.script === null)).toBe(true);
  });

  it('keeps an absolute race directory that is outside the cwd', () => {
    expect(buildRaceConfig({ ...base, cwd: '/elsewhere' }).raceDir).toBe('/work/races/duel');
  });

  it('copies the settings rather than aliasing them', () => {
    const settings = { runs: 1 };
    const config = buildRaceConfig({ ...base, settings });
    settings.runs = 99;
    expect(config.settings.runs).toBe(1);
  });

  it('builds a usable record from nothing', () => {
    const config = buildRaceConfig();
    expect(config.command).toBe('node race.js');
    expect(config.racers).toEqual([]);
    expect(config.sources).toEqual({});
  });
});

describe('writeRaceConfig', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stores the record as config.json', () => {
    withTempDir(dir => {
      const config = buildRaceConfig({ argv: ['node', 'race.js', './races/x'], settings: { runs: 1 } });
      expect(writeRaceConfig(dir, config)).toBe(RACE_CONFIG_FILE);
      const written = JSON.parse(fs.readFileSync(path.join(dir, RACE_CONFIG_FILE), 'utf-8'));
      expect(written).toEqual(config);
    });
  });

  it('writes nothing when there is no record', () => {
    withTempDir(dir => {
      expect(writeRaceConfig(dir, null)).toBeNull();
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });

  it('warns but does not throw when the directory is unwritable', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(writeRaceConfig('/definitely/not/a/dir', { command: 'node race.js' })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('storeRaceAssets', () => {
  const setupRace = (dir) => {
    const raceDir = path.join(dir, 'race');
    const runDir = path.join(dir, 'results');
    fs.mkdirSync(raceDir);
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(raceDir, 'a.spec.js'), '// a\n');
    fs.writeFileSync(path.join(raceDir, 'b.spec.js'), '// b\n');
    fs.writeFileSync(path.join(raceDir, 'settings.json'), '{"runs":1}\n');
    return { raceDir, runDir };
  };

  it('keeps the scripts, the settings file and the race record with the results', () => {
    withTempDir(dir => {
      const { raceDir, runDir } = setupRace(dir);
      const raceConfig = buildRaceConfig({ argv: ['node', 'race.js', raceDir], settings: { runs: 1 } });
      const stored = storeRaceAssets({ raceDir, racerFiles: ['a.spec.js', 'b.spec.js'], raceConfig }, runDir);

      expect(stored).toEqual({
        raceScriptFiles: ['a.spec.js', 'b.spec.js'],
        settingsFileCopied: true,
        raceConfigFile: RACE_CONFIG_FILE,
      });
      expect(fs.readdirSync(runDir).sort()).toEqual(['a.spec.js', 'b.spec.js', 'config.json', 'settings.json']);
      expect(JSON.parse(fs.readFileSync(path.join(runDir, RACE_CONFIG_FILE), 'utf-8')).command)
        .toBe(`node race.js ${raceDir}`);
    });
  });

  it('still records the configuration when there are no race files to copy (URL mode)', () => {
    withTempDir(dir => {
      const runDir = path.join(dir, 'results');
      fs.mkdirSync(runDir);
      const raceConfig = buildRaceConfig({ mode: 'url', settings: { runs: 1 } });
      const stored = storeRaceAssets({ raceDir: null, racerFiles: null, raceConfig }, runDir);

      expect(stored.raceScriptFiles).toEqual([]);
      expect(stored.settingsFileCopied).toBe(false);
      expect(stored.raceConfigFile).toBe(RACE_CONFIG_FILE);
      expect(fs.existsSync(path.join(runDir, RACE_CONFIG_FILE))).toBe(true);
    });
  });

  it('reports no record when the race carries none', () => {
    withTempDir(dir => {
      const { raceDir, runDir } = setupRace(dir);
      const stored = storeRaceAssets({ raceDir, racerFiles: ['a.spec.js'] }, runDir);
      expect(stored.raceConfigFile).toBeNull();
      expect(fs.existsSync(path.join(runDir, RACE_CONFIG_FILE))).toBe(false);
    });
  });
});
