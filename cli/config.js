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

const VALID_NETWORKS = ['none', 'slow-3g', 'fast-3g', '4g'];
const VALID_FORMATS = ['webm', 'mov', 'gif'];

export function applyOverrides(settings, boolFlags, kvFlags) {
  const s = { ...settings };
  if (boolFlags.has('parallel')) s.parallel = true;
  if (boolFlags.has('headless')) s.headless = true;
  if (boolFlags.has('profile')) s.profile = true;
  if (boolFlags.has('no-overlay')) s.noOverlay = true;
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

  // Convention-based discovery (shell scripts preferred over JS)
  const setupConvention = ['setup.sh', 'setup.js'].find(f => allFiles.includes(f));
  const teardownConvention = ['teardown.sh', 'teardown.js'].find(f => allFiles.includes(f));

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

  // Convention-based discovery (shell scripts preferred over JS)
  const setupConvention = [`${racerName}.setup.sh`, `${racerName}.setup.js`].find(f => allFiles.includes(f));
  const teardownConvention = [`${racerName}.teardown.sh`, `${racerName}.teardown.js`].find(f => allFiles.includes(f));

  // Settings override convention (settings.racers.{name}.setup/teardown)
  const racerSettings = settings.racers?.[racerName] || {};
  const setup = racerSettings.setup !== undefined ? racerSettings.setup : (setupConvention || null);
  const teardown = racerSettings.teardown !== undefined ? racerSettings.teardown : (teardownConvention || null);

  return { setup, teardown };
}
