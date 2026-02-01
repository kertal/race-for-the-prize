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
  if (kvFlags.network !== undefined) s.network = kvFlags.network;
  if (kvFlags.cpu !== undefined) s.cpuThrottle = Number(kvFlags.cpu);
  if (kvFlags.format !== undefined) s.format = kvFlags.format;
  if (kvFlags.runs !== undefined) s.runs = Number(kvFlags.runs);
  if (kvFlags.slowmo !== undefined) s.slowmo = Number(kvFlags.slowmo);
  if (kvFlags.name1 !== undefined) s.name1 = kvFlags.name1;
  if (kvFlags.name2 !== undefined) s.name2 = kvFlags.name2;
  return s;
}
