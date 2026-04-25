/**
 * CLI argument parsing, racer discovery, and settings override logic.
 * Extracted for testability.
 */

import fs from 'fs';
import path from 'path';

const KV_FLAG_NAMES = new Set(['runs', 'cpu', 'format', 'network', 'slowmo', 'height', 'gemini-spec']);
const BOOLEAN_VALUE_FLAGS = new Set([
  'parallel', 'headless', 'overlay', 'recording',
  'ffmpeg', 'har', 'wasm', 'serve', 'pause', 'ignore-https-errors', 'gemini',
]);

/** Boolean flags the CLI recognises. Unknown flags produce an error. */
export const KNOWN_BOOL_FLAGS = new Set([
  'parallel', 'headless', 'overlay', 'recording',
  'ffmpeg', 'har', 'wasm', 'serve', 'pause', 'ignore-https-errors',
  'gemini', 'results', 'init', 'verbose', 'help', 'version',
]);

/** Combined set of all valid flag names (bool + kv). */
export const KNOWN_FLAGS = new Set([...KNOWN_BOOL_FLAGS, ...KV_FLAG_NAMES]);

function isBooleanLikeValue(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim().toLowerCase();
  return s === 'true' || s === 'false' || s === '1' || s === '0' || s === 'yes' || s === 'no';
}

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
        } else if (
          BOOLEAN_VALUE_FLAGS.has(name) &&
          argv[i + 1] !== undefined &&
          !argv[i + 1].startsWith('--') &&
          isBooleanLikeValue(argv[i + 1])
        ) {
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

function parseCliBoolean(value, flagName) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  throw new InvalidSettingError(`${flagName} must be a boolean (true/false, 1/0, yes/no), got "${value}"`);
}

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
  if (boolFlags.has('headless')) s.headless = true;
  if (boolFlags.has('overlay')) s.noOverlay = false;
  if (boolFlags.has('recording')) s.noRecording = false;
  if (boolFlags.has('ffmpeg')) s.ffmpeg = true;
  if (boolFlags.has('har')) s.har = true;
  if (boolFlags.has('wasm')) s.noWasm = false;
  if (boolFlags.has('serve')) s.noServe = false;
  if (boolFlags.has('pause')) s.pauseBetweenRuns = true;
  if (boolFlags.has('ignore-https-errors')) s.ignoreHTTPSErrors = true;
  if (boolFlags.has('gemini')) s.gemini = true;
  // Explicit boolean values (for example --parallel=false) override presence flags.
  if (kvFlags.parallel !== undefined) s.parallel = parseCliBoolean(kvFlags.parallel, '--parallel');
  if (kvFlags.headless !== undefined) s.headless = parseCliBoolean(kvFlags.headless, '--headless');
  if (kvFlags.overlay !== undefined) s.noOverlay = !parseCliBoolean(kvFlags.overlay, '--overlay');
  if (kvFlags.recording !== undefined) s.noRecording = !parseCliBoolean(kvFlags.recording, '--recording');
  if (kvFlags.ffmpeg !== undefined) s.ffmpeg = parseCliBoolean(kvFlags.ffmpeg, '--ffmpeg');
  if (kvFlags.har !== undefined) s.har = parseCliBoolean(kvFlags.har, '--har');
  if (kvFlags.wasm !== undefined) s.noWasm = !parseCliBoolean(kvFlags.wasm, '--wasm');
  if (kvFlags.serve !== undefined) s.noServe = !parseCliBoolean(kvFlags.serve, '--serve');
  if (kvFlags.pause !== undefined) s.pauseBetweenRuns = parseCliBoolean(kvFlags.pause, '--pause');
  if (kvFlags['ignore-https-errors'] !== undefined) {
    s.ignoreHTTPSErrors = parseCliBoolean(kvFlags['ignore-https-errors'], '--ignore-https-errors');
  }
  if (kvFlags.gemini !== undefined) s.gemini = parseCliBoolean(kvFlags.gemini, '--gemini');
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
