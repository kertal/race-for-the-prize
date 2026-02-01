#!/usr/bin/env node

/**
 * race.js — CLI entry point for RaceForThePrize 🏆
 *
 * Orchestrates browser races: parses args, discovers racer scripts,
 * spawns the Playwright runner, collects results, and prints a report.
 *
 * Usage:
 *   node race.js ./races/my-race              Run a race
 *   node race.js ./races/my-race --results    View recent results
 *   node race.js ./races/my-race --sequential Run sequentially
 *   node race.js ./races/my-race --headless   Run headless
 *   node race.js ./races/my-race --network=fast-3g --cpu=4
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { RaceAnimation, startProgress } from './cli/animation.js';
import { c } from './cli/colors.js';
import { parseArgs, discoverRacers, applyOverrides } from './cli/config.js';
import { buildSummary, printSummary, buildMarkdownSummary, buildMedianSummary, buildMultiRunMarkdown, printRecentRaces } from './cli/summary.js';
import { createSideBySide } from './cli/sidebyside.js';
import { moveResults, convertVideos } from './cli/results.js';
import { buildPlayerHtml } from './cli/videoplayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Argument parsing ---

const { positional, boolFlags, kvFlags } = parseArgs(process.argv.slice(2));

if (positional.length === 0) {
  console.error(`
${c.yellow}    ____                   ____              _   _            ____       _          ${c.reset}
${c.yellow}   / __ \\____ _________   / __/___  _____   / |_/ /_  ___   / __ \\_____(_)_______   ${c.reset}
${c.yellow}  / /_/ / __ \`/ ___/ _ \\ / /_/ __ \\/ ___/  / __/ __ \\/ _ \\ / /_/ / ___/ / ___/ _ \\  ${c.reset}
${c.yellow} / _, _/ /_/ / /__/  __// __/ /_/ / /     / /_/ / / /  __// ____/ /  / / /__/  __/  ${c.reset}
${c.yellow}/_/ |_|\\__,_/\\___/\\___//_/  \\____/_/      \\__/_/ /_/\\___//_/   /_/  /_/\\___/\\___/   ${c.reset}

${c.dim}  Race two browsers. Measure everything. Crown a winner.  🏎️ 💨${c.reset}

${c.bold}  Quick Start:${c.reset}
${c.dim}  ─────────────────────────────────────────────────────────────${c.reset}
  ${c.bold}1.${c.reset} Create a race folder with two Playwright spec scripts:

     ${c.cyan}races/my-race/${c.reset}
       ${c.green}contender-a.spec.js${c.reset}  ${c.dim}# Racer 1 (name = filename without .spec.js)${c.reset}
       ${c.blue}contender-b.spec.js${c.reset}  ${c.dim}# Racer 2${c.reset}
       ${c.dim}settings.json${c.reset}        ${c.dim}# Optional: { parallel, network, cpuThrottle }${c.reset}

  ${c.bold}2.${c.reset} Each script gets a Playwright ${c.cyan}page${c.reset} with race helpers:

     ${c.dim}await${c.reset} page.goto(${c.green}'https://...'${c.reset});
     ${c.dim}await${c.reset} page.raceRecordingStart();       ${c.dim}// optional: start video segment${c.reset}
     ${c.dim}await${c.reset} page.raceStart(${c.green}'Load Time'${c.reset});     ${c.dim}// start measurement${c.reset}
     ${c.dim}await${c.reset} page.click(${c.green}'.button'${c.reset});
     ${c.dim}await${c.reset} page.waitForSelector(${c.green}'.result'${c.reset});
     page.raceEnd(${c.green}'Load Time'${c.reset});              ${c.dim}// end measurement (sync)${c.reset}
     ${c.dim}await${c.reset} page.raceRecordingEnd();          ${c.dim}// optional: end video segment${c.reset}

     ${c.dim}If raceRecordingStart/End are omitted, recording wraps raceStart to raceEnd.${c.reset}

  ${c.bold}3.${c.reset} Run it!

     ${c.bold}$${c.reset} ${c.cyan}node race.js ./races/lauda-vs-hunt${c.reset}

${c.bold}  Commands:${c.reset}
${c.dim}  ─────────────────────────────────────────────────────────────${c.reset}
  node race.js ${c.cyan}<dir>${c.reset}                       Run a race
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--results${c.reset}            View recent results
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--sequential${c.reset}         Run one after the other
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--headless${c.reset}           Hide browsers
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--network${c.reset}=${c.green}slow-3g${c.reset}   Network: none, slow-3g, fast-3g, 4g
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--cpu${c.reset}=${c.green}4${c.reset}              CPU throttle multiplier (1=none)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--format${c.reset}=${c.green}mov${c.reset}          Output format: webm (default), mov, gif
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--runs${c.reset}=${c.green}3${c.reset}            Run multiple times, report median
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--slowmo${c.reset}=${c.green}2${c.reset}           Slow-motion side-by-side replay (2x, 3x, etc.)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--profile${c.reset}            Capture Chrome performance traces

${c.dim}  CLI flags override settings.json values.${c.reset}
${c.dim}  Try the example:  node race.js ./races/lauda-vs-hunt${c.reset}
`);
  process.exit(1);
}

const raceDir = path.resolve(positional[0]);

if (!fs.existsSync(raceDir)) {
  console.error(`${c.red}Error: Race directory not found: ${raceDir}${c.reset}`);
  process.exit(1);
}

if (boolFlags.has('results')) {
  printRecentRaces(raceDir);
  process.exit(0);
}

// --- Discover racers ---

const { racerFiles, racerNames } = discoverRacers(raceDir);

if (racerFiles.length < 2) {
  console.error(`${c.red}Error: Need 2 .spec.js (or .js) script files in ${raceDir}, found ${racerFiles.length}${c.reset}`);
  process.exit(1);
}
if (racerFiles.length > 2) {
  console.error(`${c.yellow}Warning: Found ${racerFiles.length} script files, using first two: ${racerFiles[0]}, ${racerFiles[1]}${c.reset}`);
}
const scripts = racerFiles.map(f => fs.readFileSync(path.join(raceDir, f), 'utf-8'));

// --- Settings (settings.json, overridden by CLI flags) ---

let settings = {};
const settingsPath = path.join(raceDir, 'settings.json');
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

  } catch (e) {
    console.error(`${c.yellow}Warning: Could not parse settings.json: ${e.message}${c.reset}`);
  }
}

settings = applyOverrides(settings, boolFlags, kvFlags);

// --- Results directory ---

const now = new Date();
const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
const resultsDir = path.join(raceDir, `results-${timestamp}`);
const totalRuns = settings.runs || 1;

// --- Build runner config ---

const isParallel = settings.parallel ?? true;
const executionMode = isParallel ? 'parallel' : 'sequential';
const throttle = { network: settings.network || 'none', cpu: settings.cpuThrottle || 1 };

const runnerConfig = {
  browser1: { id: racerNames[0], script: scripts[0] },
  browser2: { id: racerNames[1], script: scripts[1] },
  executionMode,
  throttle,
  headless: settings.headless || false,
  profile: settings.profile || false,
  slowmo: settings.slowmo || 0,
};

// --- Race execution ---

/** Spawn the runner process, show animation, return parsed JSON result. */
function runRace() {
  const format = settings.format || 'webm';
  const flags = [executionMode];
  if (format !== 'webm') flags.push(format);
  if (totalRuns > 1) flags.push(`${totalRuns} runs`);
  if (throttle.network !== 'none') flags.push(`net:${throttle.network}`);
  if (throttle.cpu > 1) flags.push(`cpu:${throttle.cpu}x`);
  if (settings.slowmo) flags.push(`slowmo:${settings.slowmo}x`);
  if (settings.profile) flags.push('profile');
  if (settings.headless) flags.push('headless');

  const animation = new RaceAnimation(racerNames, flags.join(' · '));
  animation.start();

  const runnerPath = path.join(__dirname, 'runner.cjs');

  return new Promise((resolve, reject) => {
    const child = spawn('node', [runnerPath, JSON.stringify(runnerConfig)], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => {
      const text = d.toString();
      racerNames.forEach((name, i) => {
        if (text.includes(`[${name}] Context closed`)) animation.racerFinished(i);
      });
      if (animation.finished.every(Boolean) && animation.interval) animation.stop();
    });

    const sigHandler = () => child.kill('SIGTERM');
    process.on('SIGINT', sigHandler);

    child.on('close', () => {
      process.removeListener('SIGINT', sigHandler);
      if (animation.interval) animation.stop();

      // Parse the last valid JSON line from runner stdout
      const lines = stdout.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try { return resolve(JSON.parse(lines[i])); } catch {}
      }
      reject(new Error('Could not parse runner output'));
    });
  });
}

/** Run one race, collect results into runDir, return summary. */
async function runSingleRace(runDir) {
  const format = settings.format || 'webm';
  const racerRunDirs = racerNames.map(name => path.join(runDir, name));
  racerRunDirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  const result = await runRace();

  const progress = startProgress('Processing recordings…');
  const recordingsBase = path.join(__dirname, 'recordings');
  const results = racerNames.map((name, i) =>
    moveResults(recordingsBase, name, racerRunDirs[i], result, ['browser1', 'browser2'][i])
  );

  const summary = buildSummary(racerNames, results, settings, runDir);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  progress.done('Recordings processed');

  // Create side-by-side from original .webm files before any format conversion
  const sideBySideExt = format === 'mov' ? '.mov' : format === 'gif' ? '.gif' : '.webm';
  const sideBySideName = `${racerNames[0]}-vs-${racerNames[1]}${sideBySideExt}`;
  const slowmo = settings.slowmo || 0;
  const sideBySidePath = createSideBySide(results[0].videoPath, results[1].videoPath, path.join(runDir, sideBySideName), format, slowmo);

  if (format !== 'webm') {
    const convertProgress = startProgress(`Converting videos to ${format}…`);
    convertVideos(results, format);
    convertProgress.done(`Videos converted to ${format}`);
  }

  const videoFiles = racerNames.map(name => `${name}/${name}.race.webm`);
  const altFmt = format !== 'webm' ? format : null;
  const altExt = altFmt === 'mov' ? '.mov' : altFmt === 'gif' ? '.gif' : null;
  const altFiles = altExt ? racerNames.map(name => `${name}/${name}.race${altExt}`) : null;
  const playerPath = path.join(runDir, 'index.html');
  fs.writeFileSync(playerPath, buildPlayerHtml(summary, videoFiles, altFmt, altFiles));

  return { summary, sideBySidePath, sideBySideName, playerPath };
}

// --- Main ---

async function main() {
  try {
    if (totalRuns === 1) {
      const { summary, sideBySidePath, sideBySideName } = await runSingleRace(resultsDir);
      printSummary(summary);
      const md = buildMarkdownSummary(summary, sideBySidePath ? sideBySideName : null);
      fs.writeFileSync(path.join(resultsDir, 'README.md'), md);
    } else {
      fs.mkdirSync(resultsDir, { recursive: true });
      const summaries = [];

      for (let i = 0; i < totalRuns; i++) {
        console.error(`\n  ${c.bold}${c.cyan}── Run ${i + 1} of ${totalRuns} ──${c.reset}`);
        const { summary } = await runSingleRace(path.join(resultsDir, String(i + 1)));
        printSummary(summary);
        summaries.push(summary);
      }

      const medianSummary = buildMedianSummary(summaries, resultsDir);
      fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(medianSummary, null, 2));

      console.error(`\n  ${c.bold}${c.cyan}── Median Results (${totalRuns} runs) ──${c.reset}`);
      printSummary(medianSummary);

      const md = buildMultiRunMarkdown(medianSummary, summaries);
      fs.writeFileSync(path.join(resultsDir, 'README.md'), md);
    }

    console.error(`  ${c.dim}📂 ${resultsDir}${c.reset}`);
    console.error(`  ${c.dim}🎬 open ${path.join(resultsDir, totalRuns === 1 ? '' : '1', 'index.html')}${c.reset}`);
    console.error(`  ${c.dim}   node race.js ${positional[0]} --results${c.reset}\n`);
  } catch (e) {
    console.error(`\n${c.red}${c.bold}Race failed:${c.reset} ${e.message}\n`);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
