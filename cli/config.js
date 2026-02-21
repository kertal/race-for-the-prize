/**
 * CLI argument parsing, racer discovery, and settings override logic.
 * Extracted for testability.
 */

import fs from 'fs';

export function parseArgs(argv) {
  const positional = [];
  const boolFlags = new Set();
  const kvFlags = {};

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        kvFlags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        boolFlags.add(arg.slice(2));
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
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Replace dots with hyphens for filesystem safety, but keep it readable
    return hostname;
  } catch {
    // Fallback: use a sanitized version of the URL
    return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 40);
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

const VALID_NETWORKS = ['none', 'slow-3g', 'fast-3g', '4g'];
const VALID_FORMATS = ['webm', 'mov', 'gif'];

export function applyOverrides(settings, boolFlags, kvFlags) {
  const s = { ...settings };
  if (boolFlags.has('parallel')) s.parallel = true;
  if (boolFlags.has('headless')) s.headless = true;
  if (boolFlags.has('profile')) s.profile = true;
  if (boolFlags.has('no-overlay')) s.noOverlay = true;
  if (boolFlags.has('ffmpeg')) s.ffmpeg = true;
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
