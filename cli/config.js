/**
 * CLI argument parsing, racer discovery, and settings override logic.
 * Extracted for testability.
 */

import fs from 'fs';
import path from 'path';

const KV_FLAG_NAMES = new Set(['runs', 'cpu', 'format', 'network', 'slowmo', 'height', 'gemini-spec']);

/** Boolean flags the CLI recognises. Unknown flags produce an error. */
export const KNOWN_BOOL_FLAGS = new Set([
  'parallel', 'headed', 'headless', 'no-overlay', 'no-recording',
  'ffmpeg', 'har', 'no-wasm', 'serve', 'no-serve', 'pause', 'ignore-https-errors',
  'gemini', 'results', 'init', 'verbose', 'help', 'version',
]);

/** Combined set of all valid flag names (bool + kv). `--serve` accepts both bool and legacy kv form. */
export const KNOWN_FLAGS = new Set([...KNOWN_BOOL_FLAGS, ...KV_FLAG_NAMES]);

export function parseArgs(argv) {
  const positional = [];
  const boolFlags = new Set();
  const kvFlags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        kvFlags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const name = arg.slice(2);
        if (KV_FLAG_NAMES.has(name) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
          kvFlags[name] = argv[i + 1];
          i++;
        } else {
          boolFlags.add(name);
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, boolFlags, kvFlags };
}

/**
 * Return list of unknown flag names (neither in KNOWN_BOOL_FLAGS nor KV_FLAG_NAMES).
 * Callers should reject the invocation if this returns non-empty.
 */
export function findUnknownFlags(boolFlags, kvFlags) {
  const unknown = [];
  for (const name of boolFlags) {
    if (!KNOWN_FLAGS.has(name)) unknown.push(name);
  }
  for (const name of Object.keys(kvFlags)) {
    if (!KNOWN_FLAGS.has(name)) unknown.push(name);
  }
  return unknown;
}

export function discoverRacers(raceDir) {
  const allFiles = fs.readdirSync(raceDir).filter(f => !f.startsWith('.'));
  let racerFiles = allFiles.filter(f => f.endsWith('.spec.js')).sort();

  if (racerFiles.length < 2) {
    // Exclude setup/teardown hook files from racer fallback
    const hookPattern = /\.(setup|teardown)\.js$/;
    const jsFiles = allFiles.filter(f => f.endsWith('.js') && !hookPattern.test(f) && f !== 'setup.js' && f !== 'teardown.js').sort();
    if (jsFiles.length >= 2) {
      console.error(`Warning: Found ${racerFiles.length} .spec.js files, using .js files instead`);
      racerFiles = jsFiles;
    }
  }

  const totalFound = racerFiles.length;
  const dropped = racerFiles.length > 5 ? racerFiles.slice(5) : [];
  if (racerFiles.length > 5) {
    racerFiles = racerFiles.slice(0, 5);
  }

  const racerNames = racerFiles.map(f => f.replace(/\.spec\.js$/, '').replace(/\.js$/, ''));
  const dupes = racerNames.filter((n, i) => racerNames.indexOf(n) !== i);
  if (dupes.length > 0) {
    const unique = [...new Set(dupes)].join(', ');
    throw new Error(`Duplicate racer names detected: ${unique}. Rename files so each racer has a unique name.`);
  }
  return { racerFiles, racerNames, totalFound, dropped };
}

/**
 * Resolve racer names for shared-spec mode from settings.json.
 * Shared-spec mode uses one race.spec.js script and settings-defined racers.
 *
 * Rules:
 * - settings.racers must be an object with 2..5 keys
 * - racer names must be non-empty strings
 * - racer order follows declaration order in settings.racers
 *
 * @param {object} settings
 * @returns {string[]} ordered racer names
 * @throws {InvalidSettingError}
 */
export function resolveSharedRacerNames(settings) {
  const racers = settings?.racers;
  if (!racers || typeof racers !== 'object' || Array.isArray(racers)) {
    throw new InvalidSettingError('shared-spec mode requires settings.racers to be an object');
  }

  const names = Object.keys(racers);
  if (names.length < 2) {
    throw new InvalidSettingError(`shared-spec mode requires at least 2 racers in settings.racers, found ${names.length}`);
  }
  if (names.length > 5) {
    throw new InvalidSettingError(`shared-spec mode supports up to 5 racers, found ${names.length}`);
  }
  const emptyName = names.find(name => typeof name !== 'string' || name.trim() === '');
  if (emptyName !== undefined) {
    throw new InvalidSettingError('shared-spec mode racer names must be non-empty strings');
  }
  for (const name of names) {
    // Keep names filesystem-safe because they become output directory names.
    if (name === '.' || name === '..') {
      throw new InvalidSettingError(`shared-spec racer name "${name}" is not allowed`);
    }
    if (name.includes('/') || name.includes('\\')) {
      throw new InvalidSettingError(`shared-spec racer name "${name}" must not contain path separators`);
    }
  }

  return names;
}

/**
 * Check if a string is a valid http(s) URL with a hostname.
 */
export function isUrl(str) {
  try {
    const u = new URL(str);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname;
    if (!h || h === '.' || h === '..' || h.replace(/\./g, '') === '') return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive a short, filesystem-safe racer name from a URL.
 * Uses the hostname, stripping "www." prefix and sanitizing.
 */
export function deriveRacerName(url) {
  let name;
  try {
    name = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    name = url.replaceAll(/^https?:\/\//g, '').replaceAll(/[^a-zA-Z0-9.-]/g, '_');
  }
  // Sanitize: remove filesystem-unsafe chars (e.g. IPv6 colons),
  // collapse consecutive dots, strip leading/trailing dots, and truncate.
  // Uses split/filter/join instead of quantified dot regexes to avoid ReDoS.
  name = name.replaceAll(/[^a-zA-Z0-9.-]/g, '_').split('.').filter(Boolean).join('.').slice(0, 40);
  // Reject dangerous names that resolve to current/parent directory
  if (!name || name === '.' || name === '..') return 'url';
  return name;
}

/**
 * Build a default race script that measures page load time for a URL.
 * The script navigates to the URL and times the load event.
 *
 * SECURITY: The URL is embedded via JSON.stringify() which safely escapes
 * all special characters. The generated script runs in the same trust
 * context as user-provided .spec.js files (equivalent to `node <file>`).
 * Only run URLs you trust — this is the same security model as Playwright.
 */
export function buildDefaultRaceScript(url) {
  return `await page.raceStart('Page Load');
try {
  await page.goto(${JSON.stringify(url)}, { waitUntil: 'load' });
} finally {
  page.raceEnd('Page Load');
}
`;
}

/** Settings keys that must be real booleans (JSON often has strings — "false" is truthy in JS). */
const BOOLEAN_SETTING_KEYS = [
  'parallel',
  'headless',
  'noOverlay',
  'noRecording',
  'ffmpeg',
  'har',
  'noWasm',
  'noServe',
  'pauseBetweenRuns',
  'ignoreHTTPSErrors',
];

/**
 * Coerce a settings value to boolean. Strings like "false" / "0" / "no" → false.
 */
export function coerceBooleanSetting(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
  }
  return Boolean(value);
}

/**
 * Apply default values for all settings properties.
 * Call after applyOverrides to ensure every key has a defined value.
 * Strips null/undefined values so they don't shadow defaults, except for
 * setup/teardown keys where null explicitly disables convention-based discovery.
 */
export function applyDefaults(settings) {
  // Keys where null is meaningful (disables convention-based discovery)
  const preserveNullKeys = new Set(['setup', 'teardown']);
  const cleaned = Object.fromEntries(
    Object.entries(settings).filter(([k, v]) => v != null || preserveNullKeys.has(k))
  );
  const result = {
    parallel: false,
    headless: false,
    noOverlay: false,
    noRecording: false,
    ffmpeg: false,
    har: false,
    noWasm: false,
    noServe: false,
    pauseBetweenRuns: false,
    ignoreHTTPSErrors: false,
    viewportHeight: 720,
    format: 'webm',
    network: 'none',
    cpuThrottle: 1,
    slowmo: 0,
    runs: 1,
    ...cleaned,
  };
  for (const key of BOOLEAN_SETTING_KEYS) {
    if (key in result) result[key] = coerceBooleanSetting(result[key]);
  }
  return result;
}

export const VALID_NETWORKS = ['none', 'slow-3g', 'fast-3g', '4g'];
export const VALID_FORMATS = ['webm', 'mov', 'gif'];

/** Error thrown for invalid user-supplied settings. CLI catches and exits 2 (convention: misuse). */
export class InvalidSettingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidSettingError';
  }
}

/**
 * Apply CLI overrides to settings. Mutates neither input.
 * Throws InvalidSettingError for unrecoverable errors (for example, bad enum values
 * and invalid numeric flag values such as cpu/runs/slowmo).
 * Warns to stderr for clamped numeric values, but does not throw.
 */
export function applyOverrides(settings, boolFlags, kvFlags) {
  const s = { ...settings };
  if (boolFlags.has('parallel')) s.parallel = true;
  if (boolFlags.has('headed')) s.headless = false;
  if (boolFlags.has('headless')) s.headless = true;
  if (boolFlags.has('no-overlay')) s.noOverlay = true;
  if (boolFlags.has('no-recording')) s.noRecording = true;
  if (boolFlags.has('ffmpeg')) s.ffmpeg = true;
  if (boolFlags.has('har')) s.har = true;
  if (boolFlags.has('no-wasm')) s.noWasm = true;
  if (boolFlags.has('no-serve')) s.noServe = true;
  if (boolFlags.has('serve')) s.noServe = false;
  // Backward compatibility: legacy --serve=false / --serve=true
  if (kvFlags.serve === 'false') s.noServe = true;
  else if (kvFlags.serve === 'true') s.noServe = false;
  if (boolFlags.has('pause')) s.pauseBetweenRuns = true;
  if (boolFlags.has('ignore-https-errors')) s.ignoreHTTPSErrors = true;
  if (kvFlags.network !== undefined) {
    if (!VALID_NETWORKS.includes(kvFlags.network)) {
      throw new InvalidSettingError(`Unknown network preset "${kvFlags.network}". Valid values: ${VALID_NETWORKS.join(', ')}`);
    }
    s.network = kvFlags.network;
  }
  if (kvFlags.cpu !== undefined) {
    const cpu = Number(kvFlags.cpu);
    if (!Number.isFinite(cpu) || cpu < 1) {
      throw new InvalidSettingError(`--cpu must be a number >= 1, got "${kvFlags.cpu}"`);
    }
    s.cpuThrottle = cpu;
  }
  if (kvFlags.format !== undefined) {
    if (!VALID_FORMATS.includes(kvFlags.format)) {
      throw new InvalidSettingError(`Unknown format "${kvFlags.format}". Valid values: ${VALID_FORMATS.join(', ')}`);
    }
    s.format = kvFlags.format;
  }
  if (kvFlags.runs !== undefined) {
    const runs = Number(kvFlags.runs);
    if (!Number.isFinite(runs) || runs < 1) {
      throw new InvalidSettingError(`--runs must be a positive integer, got "${kvFlags.runs}"`);
    }
    const rounded = Math.round(runs);
    if (rounded > 100) {
      console.error(`Warning: --runs clamped from ${rounded} to 100 (maximum)`);
      s.runs = 100;
    } else {
      s.runs = rounded;
    }
  }
  if (kvFlags.slowmo !== undefined) {
    const slowmo = Number(kvFlags.slowmo);
    if (!Number.isFinite(slowmo) || slowmo < 0) {
      throw new InvalidSettingError(`--slowmo must be a non-negative number, got "${kvFlags.slowmo}"`);
    }
    if (slowmo > 20) {
      console.error(`Warning: --slowmo clamped from ${slowmo} to 20 (maximum)`);
      s.slowmo = 20;
    } else {
      s.slowmo = slowmo;
    }
  }
  if (kvFlags.height !== undefined) {
    const height = Number(kvFlags.height);
    if (!Number.isFinite(height)) {
      console.error(`Warning: --height "${kvFlags.height}" is not numeric, using default 720`);
      s.viewportHeight = 720;
    } else {
      const rounded = Math.round(height);
      if (rounded < 480) {
        console.error(`Warning: --height clamped from ${rounded} to 480 (minimum)`);
        s.viewportHeight = 480;
      } else if (rounded > 4320) {
        console.error(`Warning: --height clamped from ${rounded} to 4320 (maximum)`);
        s.viewportHeight = 4320;
      } else {
        s.viewportHeight = rounded;
      }
    }
  }
  if (boolFlags.has('gemini')) s.gemini = true;
  return s;
}

/**
 * Check if a path is a regular file (not a directory or symlink).
 * Uses lstatSync so symlinks are rejected consistently with execution.
 */
function isFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Get script order for discovery. Always prefers .sh over .js.
 */
function getScriptOrder(base) {
  return [`${base}.sh`, `${base}.js`];
}

/**
 * Discover setup and teardown scripts in a race directory.
 * Looks for convention-based files: setup.sh, setup.js, teardown.sh, teardown.js
 * These can be overridden by settings.json setup/teardown fields.
 *
 * @param {string} raceDir - Path to the race directory
 * @param {object} settings - Settings object (may contain setup/teardown overrides)
 * @returns {{ setup: string|object|null, teardown: string|object|null }}
 */
export function discoverSetupTeardown(raceDir, settings = {}) {
  const allFiles = fs.readdirSync(raceDir).filter(f => !f.startsWith('.'));

  // Convention-based discovery (.sh preferred over .js)
  const setupOrder = getScriptOrder('setup');
  const teardownOrder = getScriptOrder('teardown');

  const setupConvention = setupOrder.find(f =>
    allFiles.includes(f) && isFile(path.join(raceDir, f))
  );
  const teardownConvention = teardownOrder.find(f =>
    allFiles.includes(f) && isFile(path.join(raceDir, f))
  );

  // Settings override convention
  const setup = settings.setup !== undefined ? settings.setup : (setupConvention || null);
  const teardown = settings.teardown !== undefined ? settings.teardown : (teardownConvention || null);

  return { setup, teardown };
}

/**
 * Discover per-racer setup and teardown scripts.
 * Convention: {racer-name}.setup.sh, {racer-name}.setup.js,
 *             {racer-name}.teardown.sh, {racer-name}.teardown.js
 * Can be overridden via settings.json racers.{name}.setup/teardown fields.
 *
 * @param {string} raceDir - Path to the race directory
 * @param {string} racerName - Name of the racer (without .spec.js)
 * @param {object} settings - Settings object (may contain racers overrides)
 * @returns {{ setup: string|object|null, teardown: string|object|null }}
 */
export function discoverRacerSetupTeardown(raceDir, racerName, settings = {}) {
  const allFiles = fs.readdirSync(raceDir).filter(f => !f.startsWith('.'));

  // Convention-based discovery (.sh preferred over .js)
  const setupOrder = getScriptOrder(`${racerName}.setup`);
  const teardownOrder = getScriptOrder(`${racerName}.teardown`);

  const setupConvention = setupOrder.find(f =>
    allFiles.includes(f) && isFile(path.join(raceDir, f))
  );
  const teardownConvention = teardownOrder.find(f =>
    allFiles.includes(f) && isFile(path.join(raceDir, f))
  );

  // Settings override convention (settings.racers.{name}.setup/teardown)
  const racerSettings = settings.racers?.[racerName] || {};
  const setup = racerSettings.setup !== undefined ? racerSettings.setup : (setupConvention || null);
  const teardown = racerSettings.teardown !== undefined ? racerSettings.teardown : (teardownConvention || null);

  return { setup, teardown };
}

/**
 * Convert per-racer `vars` (from settings.json) into `RACE_VAR_*` env vars
 * for per-racer setup/teardown scripts.
 *
 * Keys are uppercased and non-alphanumeric chars replaced with `_`.
 * String/number/boolean values are stringified; objects/arrays are JSON-encoded.
 * `null`/`undefined` values are skipped. Non-object `vars` returns `{}`.
 */
export function varsToEnv(vars) {
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return {};
  const env = {};
  const seenSources = new Map();
  for (const [key, value] of Object.entries(vars)) {
    if (value === null || value === undefined) continue;
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const envKey = 'RACE_VAR_' + String(key).toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const prev = seenSources.get(envKey);
    if (prev && prev.key !== key) {
      console.warn(
        `Warning: vars keys "${prev.key}" (${prev.value}) and "${key}" (${valueStr}) both map to ${envKey}; later value wins`
      );
    }
    seenSources.set(envKey, { key, value: valueStr });
    env[envKey] = valueStr;
  }
  return env;
}
