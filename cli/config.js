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
