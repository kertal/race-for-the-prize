/**
 * race-config.js — the record of how a race was actually run.
 *
 * A race's numbers only mean something next to the configuration that produced
 * them, and that configuration is assembled from three places: the CLI flags,
 * the race directory's settings.json, and the built-in defaults. This module
 * captures the result of that merge — plus the command that started it — as a
 * plain object, so every results directory can keep a `config.json` beside its
 * `summary.json` and the HTML report can show what was raced and why.
 *
 * Everything here is pure (except `writeRaceConfig`, which is the one function
 * that touches disk), so the shape of the record is unit-testable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { FLAG_SETTING_KEYS } from './config.js';

/** Filename the race record is stored under, inside every results directory. */
export const RACE_CONFIG_FILE = 'config.json';

/** Where an effective setting's value came from. */
export const SOURCE_CLI = 'cli';
export const SOURCE_FILE = 'settings.json';
export const SOURCE_DEFAULT = 'default';

const SOURCE_LABELS = {
  [SOURCE_CLI]: 'CLI flag',
  [SOURCE_FILE]: 'settings.json',
  [SOURCE_DEFAULT]: 'default',
};

/** Human-readable name for a source, for the report. */
export function sourceLabel(source) {
  return SOURCE_LABELS[source] || String(source);
}

/**
 * The settings worth reading first, in the order a racer cares about them.
 * Anything not listed still shows up — sorted, after these — so a setting added
 * later is recorded without anyone having to remember this list.
 */
const KEY_ORDER = [
  'runs',
  'parallel',
  'headless',
  'network',
  'cpuThrottle',
  'slowmo',
  'viewportHeight',
  'format',
  'ffmpeg',
  'har',
  'noRecording',
  'noOverlay',
  'noWasm',
  'noServe',
  'pauseBetweenRuns',
  'ignoreHTTPSErrors',
  'cueMarkers',
  'wallClock',
  'skin',
  'gemini',
];

/**
 * settings.json keys that feed a differently-named setting. `height` is the
 * file's alias for `viewportHeight` (see `applyOverrides`), so a value written
 * under the alias still reads as having come from the file.
 */
const FILE_KEY_ALIASES = { viewportHeight: ['height'] };

/** Did settings.json supply this setting, under its own name or an alias? */
function fileSupplied(fileSettings, key) {
  if (fileSettings?.[key] != null) return true;
  return (FILE_KEY_ALIASES[key] || []).some(alias => fileSettings?.[alias] != null);
}

/** Order setting keys: the well-known ones first, then the rest alphabetically. */
export function sortSettingKeys(keys) {
  const known = KEY_ORDER.filter(key => keys.includes(key));
  const rest = keys.filter(key => !KEY_ORDER.includes(key)).sort();
  return [...known, ...rest];
}

/** Characters that survive a shell unquoted; anything else gets single-quoted. */
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

/** Quote one argument so the printed command can be pasted back into a shell. */
export function shellQuote(arg) {
  const str = String(arg);
  if (str === '') return "''";
  return SHELL_SAFE.test(str) ? str : `'${str.replaceAll("'", `'\\''`)}'`;
}

/**
 * Rebuild the command that started this race from `process.argv`.
 * The interpreter and script paths are normalised to `node race.js` — the
 * absolute paths of one machine's install are noise in a shared report.
 */
export function formatCommand(argv = []) {
  return ['node', 'race.js', ...argv.slice(2).map(shellQuote)].join(' ');
}

/**
 * Attribute every effective setting to where its value came from.
 *
 * CLI flags win over settings.json, which wins over the defaults — the same
 * precedence `applyOverrides` + `applyDefaults` implement. A flag is credited
 * even when it happens to set the value settings.json already had: it was still
 * passed, and the report should say so.
 *
 * @param {object} settings - effective settings (post defaults)
 * @param {object} options
 * @param {object} [options.fileSettings] - raw settings.json contents
 * @param {Set<string>} [options.boolFlags] - parsed CLI boolean flags
 * @param {object} [options.kvFlags] - parsed CLI key=value flags
 * @returns {Record<string, string>} setting key → SOURCE_*
 */
export function resolveSettingSources(settings = {}, { fileSettings = {}, boolFlags = new Set(), kvFlags = {} } = {}) {
  const cliKeys = new Set(
    [...boolFlags, ...Object.keys(kvFlags)]
      .map(flag => FLAG_SETTING_KEYS[flag])
      .filter(Boolean)
  );
  const sources = {};
  for (const key of Object.keys(settings)) {
    if (cliKeys.has(key)) sources[key] = SOURCE_CLI;
    else if (fileSupplied(fileSettings, key)) sources[key] = SOURCE_FILE;
    else sources[key] = SOURCE_DEFAULT;
  }
  return sources;
}

/** Render one setting value for display: JSON-ish, but readable. */
export function formatSettingValue(value) {
  if (value == null) return 'none';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (value === '') return '(empty)';
  return String(value);
}

/** Show the race directory relative to the cwd when that is shorter to read. */
function displayDir(raceDir, cwd) {
  if (!raceDir) return null;
  const rel = path.relative(cwd, raceDir);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : raceDir;
}

/**
 * Build the record of a race's actual configuration.
 *
 * @param {object} options
 * @param {string[]} [options.argv] - process.argv of the invocation
 * @param {object} [options.settings] - effective settings for this race
 * @param {object} [options.fileSettings] - raw settings.json contents
 * @param {Set<string>} [options.boolFlags] - parsed CLI boolean flags
 * @param {object} [options.kvFlags] - parsed CLI key=value flags
 * @param {string|null} [options.raceDir] - the race directory
 * @param {string[]} [options.racerNames]
 * @param {string[]|null} [options.racerFiles] - spec file per racer (shared-spec
 *   mode has one file for all racers)
 * @param {string} [options.mode] - 'directory' | 'shared-spec' | 'url'
 * @param {string|null} [options.version] - the tool's version
 * @param {string} [options.cwd]
 */
export function buildRaceConfig({
  argv = [],
  settings = {},
  fileSettings = {},
  boolFlags = new Set(),
  kvFlags = {},
  raceDir = null,
  racerNames = [],
  racerFiles = null,
  mode = 'directory',
  version = null,
  cwd = process.cwd(),
} = {}) {
  return {
    command: formatCommand(argv),
    version,
    mode,
    raceDir: displayDir(raceDir, cwd),
    racers: racerNames.map((name, i) => ({
      name,
      // Shared-spec mode races one script under many names.
      script: racerFiles ? (racerFiles[i] ?? racerFiles[0] ?? null) : null,
    })),
    settings: { ...settings },
    sources: resolveSettingSources(settings, { fileSettings, boolFlags, kvFlags }),
  };
}

/**
 * Store the record next to a race's results. Returns the filename written, or
 * null if there was nothing to write or the write failed — a missing record
 * must never take the results down with it.
 */
export function writeRaceConfig(dir, raceConfig) {
  if (!raceConfig) return null;
  try {
    fs.writeFileSync(path.join(dir, RACE_CONFIG_FILE), JSON.stringify(raceConfig, null, 2) + '\n');
    return RACE_CONFIG_FILE;
  } catch (e) {
    console.error(`Warning: Could not write ${RACE_CONFIG_FILE}: ${e.message}`);
    return null;
  }
}
