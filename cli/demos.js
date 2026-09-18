/**
 * Bundled demo races.
 *
 * `race-for-the-prize demo:lauda-vs-hunt` runs one of the races shipped with
 * the package. Installed globally or via npx there is no `races/` directory in
 * sight, so the demo is copied out of the package into `./races/<name>` first —
 * that keeps results next to the user's work instead of inside node_modules,
 * and leaves the copy around to hack on.
 */

import fs from 'fs';
import path from 'path';

/** Demo races shipped in `races/`, in the order the ReadMe introduces them. */
export const DEMO_RACES = [
  { name: 'lauda-vs-hunt', description: 'The classic rivalry: two Wikipedia pages, scrolled to the bottom' },
  { name: 'lebron-vs-curry', description: 'The GOAT debate: dribble three times, then race back to the top' },
  { name: 'react-vs-angular', description: 'Framework cage match: React, Angular, Svelte and htmx, four racers' },
  { name: 'caching-comparison', description: 'Encrypted cache vs plain cache vs no cache, both halves timed' },
];

/**
 * Parse a positional argument as a demo command.
 * Returns `null` when it isn't one, `{ name: null }` for a bare `demo`
 * (list the demos), or `{ name }` for `demo:<name>`.
 */
export function parseDemoArg(arg) {
  if (typeof arg !== 'string') return null;
  if (arg === 'demo' || arg === 'demo:') return { name: null };
  if (!arg.startsWith('demo:')) return null;
  return { name: arg.slice('demo:'.length) };
}

/** Look up a demo by name. Unknown names return null — the list is a whitelist. */
export function findDemo(name) {
  return DEMO_RACES.find(d => d.name === name) || null;
}

/** Where a demo race lives inside the package. */
export function demoSourceDir(name, rootDir) {
  return path.join(rootDir, 'races', name);
}

/** Thrown for `demo:nope` so the CLI can print the list of real demos. */
export class UnknownDemoError extends Error {
  constructor(name) {
    super(`Unknown demo race: ${name}`);
    this.name = 'UnknownDemoError';
    this.demoName = name;
  }
}

/**
 * Make a demo race runnable from `cwd`.
 *
 * Copies the bundled race into `<cwd>/races/<name>` (skipping files that are
 * already there, so local edits survive) and returns the directory to race.
 * Running from the repo itself resolves to the bundled directory, so nothing
 * is copied.
 */
export function prepareDemo(name, { rootDir, cwd = process.cwd() } = {}) {
  const demo = findDemo(name);
  if (!demo) throw new UnknownDemoError(name);

  const sourceDir = demoSourceDir(demo.name, rootDir);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Demo race is missing from this install: ${sourceDir}`);
  }

  const targetDir = path.join(cwd, 'races', demo.name);
  if (path.resolve(targetDir) === path.resolve(sourceDir)) {
    return { demo, dir: sourceDir, copied: [] };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const copied = [];
  for (const file of fs.readdirSync(sourceDir)) {
    if (file.startsWith('.')) continue;
    const src = path.join(sourceDir, file);
    if (!fs.statSync(src).isFile()) continue;
    const dest = path.join(targetDir, file);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(src, dest);
    copied.push(file);
  }
  return { demo, dir: targetDir, copied };
}

/** Human-readable list of the demo races, for `demo` and error messages. */
export function formatDemoList(colors = {}) {
  const { bold = '', cyan = '', dim = '', reset = '' } = colors;
  const width = Math.max(...DEMO_RACES.map(d => d.name.length));
  const lines = DEMO_RACES.map(
    d => `  ${cyan}demo:${d.name}${reset}${' '.repeat(width - d.name.length)}  ${dim}${d.description}${reset}`
  );
  return [
    `${bold}Demo races:${reset}`,
    ...lines,
    '',
    `${dim}  Run one with:  race-for-the-prize demo:${DEMO_RACES[0].name}${reset}`,
    `${dim}  The race is copied to ./races/<name>/ so you can edit it and race again.${reset}`,
  ].join('\n');
}
