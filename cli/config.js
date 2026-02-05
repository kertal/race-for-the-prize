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
    racerFiles = allFiles.filter(f => f.endsWith('.js')).sort();
  }

  if (racerFiles.length > 2) {
    racerFiles = racerFiles.slice(0, 2);
  }

  const racerNames = racerFiles.map(f => f.replace(/\.spec\.js$/, '').replace(/\.js$/, ''));
  return { racerFiles, racerNames };
}

export function applyOverrides(settings, boolFlags, kvFlags) {
  const s = { ...settings };
  if (boolFlags.has('sequential')) s.parallel = false;
  if (boolFlags.has('headless')) s.headless = true;
  if (boolFlags.has('profile')) s.profile = true;
  if (boolFlags.has('no-overlay')) s.noOverlay = true;
  if (kvFlags.network !== undefined) s.network = kvFlags.network;
  if (kvFlags.cpu !== undefined) s.cpuThrottle = Number(kvFlags.cpu);
  if (kvFlags.format !== undefined) s.format = kvFlags.format;
  if (kvFlags.runs !== undefined) s.runs = Number(kvFlags.runs);
  if (kvFlags.slowmo !== undefined) s.slowmo = Number(kvFlags.slowmo);
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
