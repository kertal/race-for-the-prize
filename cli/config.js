/**
 * CLI argument parsing, racer discovery, and settings override logic.
 * Extracted for testability.
 */

import fs from 'fs';

const KV_FLAG_NAMES = new Set(['runs', 'cpu', 'format', 'network', 'slowmo']);

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
    const jsFiles = allFiles.filter(f => f.endsWith('.js')).sort();
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
 * Check if a string looks like a URL (http:// or https://).
 */
export function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

/**
 * Derive a short racer name from a URL.
 * Uses the hostname, stripping "www." prefix.
 */
export function deriveRacerName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // Fallback: sanitize for filesystem safety (no path traversal)
    return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.{2,}/g, '.').slice(0, 40) || 'url';
  }
}

/**
 * Build a default race script that measures page load time for a URL.
 * The script navigates to the URL and times the load event.
 */
export function buildDefaultRaceScript(url) {
  return `await page.raceStart('Page Load');
await page.goto(${JSON.stringify(url)}, { waitUntil: 'load' });
page.raceEnd('Page Load');
`;
}

/**
 * Apply default values for all settings properties.
 * Call after applyOverrides to ensure every key has a defined value.
 */
export function applyDefaults(settings) {
  return {
    parallel: false,
    headless: false,
    noOverlay: false,
    noRecording: false,
    ffmpeg: false,
    noWasm: false,
    format: 'webm',
    network: 'none',
    cpuThrottle: 1,
    slowmo: 0,
    runs: 1,
    ...settings,
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
  if (boolFlags.has('no-wasm')) s.noWasm = true;
  if (boolFlags.has('pause')) s.pauseBetweenRuns = true;
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
  return s;
}
