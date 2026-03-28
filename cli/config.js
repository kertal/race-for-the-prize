/**
 * CLI argument parsing, racer discovery, and settings override logic.
 * Extracted for testability.
 */

import fs from 'fs';
import path from 'path';

const KV_FLAG_NAMES = new Set(['runs', 'cpu', 'format', 'network', 'slowmo', 'height']);

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

  if (racerFiles.length > 5) {
    racerFiles = racerFiles.slice(0, 5);
  }

  const racerNames = racerFiles.map(f => f.replace(/\.spec\.js$/, '').replace(/\.js$/, ''));
  const dupes = racerNames.filter((n, i) => racerNames.indexOf(n) !== i);
  if (dupes.length > 0) {
    const unique = [...new Set(dupes)].join(', ');
    throw new Error(`Duplicate racer names detected: ${unique}. Rename files so each racer has a unique name.`);
  }
  return { racerFiles, racerNames };
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

/**
 * Apply default values for all settings properties.
 * Call after applyOverrides to ensure every key has a defined value.
 * Strips null/undefined values so they don't shadow defaults.
 */
export function applyDefaults(settings) {
  const cleaned = Object.fromEntries(
    Object.entries(settings).filter(([, v]) => v != null)
  );
  return {
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
}

const VALID_NETWORKS = ['none', 'slow-3g', 'fast-3g', '4g'];
const VALID_FORMATS = ['webm', 'mov', 'gif'];

export function applyOverrides(settings, boolFlags, kvFlags) {
  const s = { ...settings };
  if (boolFlags.has('parallel')) s.parallel = true;
  if (boolFlags.has('headless')) s.headless = true;
  if (boolFlags.has('no-overlay')) s.noOverlay = true;
  if (boolFlags.has('no-recording')) s.noRecording = true;
  if (boolFlags.has('ffmpeg')) s.ffmpeg = true;
  if (boolFlags.has('har')) s.har = true;
  if (boolFlags.has('no-wasm')) s.noWasm = true;
  if (boolFlags.has('no-serve')) s.noServe = true;
  // Backward compatibility: legacy --serve=false / --serve=true
  if (kvFlags.serve === 'false') s.noServe = true;
  else if (kvFlags.serve === 'true') s.noServe = false;
  if (boolFlags.has('pause')) s.pauseBetweenRuns = true;
  if (boolFlags.has('ignore-https-errors')) s.ignoreHTTPSErrors = true;
  if (kvFlags.network !== undefined) {
    if (!VALID_NETWORKS.includes(kvFlags.network)) {
      console.error(`Warning: Unknown network preset "${kvFlags.network}", valid values: ${VALID_NETWORKS.join(', ')}`);
    }
    s.network = kvFlags.network;
  }
  if (kvFlags.cpu !== undefined) {
    const cpu = Number(kvFlags.cpu);
    s.cpuThrottle = Number.isFinite(cpu) && cpu >= 1 ? cpu : 1;
  }
  if (kvFlags.format !== undefined) {
    if (!VALID_FORMATS.includes(kvFlags.format)) {
      console.error(`Warning: Unknown format "${kvFlags.format}", valid values: ${VALID_FORMATS.join(', ')}`);
    }
    s.format = kvFlags.format;
  }
  if (kvFlags.runs !== undefined) {
    const runs = Number(kvFlags.runs);
    s.runs = Number.isFinite(runs) && runs >= 1 ? Math.min(Math.round(runs), 100) : 1;
  }
  if (kvFlags.slowmo !== undefined) {
    const slowmo = Number(kvFlags.slowmo);
    s.slowmo = Number.isFinite(slowmo) && slowmo >= 0 ? Math.min(slowmo, 20) : 0;
  }
  if (kvFlags.height !== undefined) {
    const height = Number(kvFlags.height);
    s.viewportHeight = Number.isFinite(height) ? Math.min(Math.max(Math.round(height), 480), 4320) : 720;
  }
  return s;
}

/**
 * Check if a path is a regular file (not a directory).
 */
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
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
