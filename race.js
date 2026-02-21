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
 *   node race.js ./races/my-race --parallel   Run both browsers simultaneously
 *   node race.js ./races/my-race --headless   Run headless
 *   node race.js ./races/my-race --network=fast-3g --cpu=4
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { RaceAnimation, startProgress } from './cli/animation.js';
import { c, FORMAT_EXTENSIONS } from './cli/colors.js';
import { parseArgs, discoverRacers, applyOverrides } from './cli/config.js';
import { buildSummary, printSummary, buildMarkdownSummary, buildMedianSummary, buildMultiRunMarkdown, printRecentRaces, getPlacementOrder, findMedianRunIndex } from './cli/summary.js';
import { createSideBySide } from './cli/sidebyside.js';
import { moveResults, convertVideos } from './cli/results.js';
import { buildPlayerHtml } from './cli/videoplayer.js';

/** Format a Date as YYYY-MM-DD_HH-MM-SS for directory naming. */
export function formatTimestamp(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Build the paths for results output display.
 * Returns { relResults, relHtml } relative to cwd.
 */
export function buildResultsPaths(resultsDir, cwd = process.cwd()) {
  const relResults = path.relative(cwd, resultsDir);
  const relHtml = path.relative(cwd, path.join(resultsDir, 'index.html'));
  return { relResults, relHtml };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Check if running as main module (not imported)
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {

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
     page.raceMessage(${c.green}'I win!'${c.reset});              ${c.dim}// send message to CLI${c.reset}
     ${c.dim}await${c.reset} page.raceRecordingEnd();          ${c.dim}// optional: end video segment${c.reset}

     ${c.dim}If raceRecordingStart/End are omitted, recording wraps raceStart to raceEnd.${c.reset}

  ${c.bold}3.${c.reset} Run it!

     ${c.bold}$${c.reset} ${c.cyan}node race.js ./races/lauda-vs-hunt${c.reset}

${c.bold}  Commands:${c.reset}
${c.dim}  ─────────────────────────────────────────────────────────────${c.reset}
  node race.js ${c.cyan}<dir>${c.reset}                       Run a race
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--results${c.reset}            View recent results
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--parallel${c.reset}           Run both browsers simultaneously
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--headless${c.reset}           Hide browsers
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--network${c.reset}=${c.green}slow-3g${c.reset}   Network: none, slow-3g, fast-3g, 4g
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--cpu${c.reset}=${c.green}4${c.reset}              CPU throttle multiplier (1=none)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--format${c.reset}=${c.green}mov${c.reset}          Output format: webm (default), mov, gif
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--runs${c.reset}=${c.green}3${c.reset}            Run multiple times, report median
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--slowmo${c.reset}=${c.green}2${c.reset}           Slow-motion side-by-side replay (2x, 3x, etc.)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--profile${c.reset}            Capture Chrome performance traces
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-overlay${c.reset}         Record videos without overlays
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-ffmpeg${c.reset}          Skip FFmpeg processing (no trim/merge/convert)

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
  console.error(`${c.red}Error: Need at least 2 .spec.js (or .js) script files in ${raceDir}, found ${racerFiles.length}${c.reset}`);
  process.exit(1);
}
if (racerFiles.length > 5) {
  console.error(`${c.yellow}Warning: Found ${racerFiles.length} script files, using first five: ${racerFiles.slice(0, 5).join(', ')}${c.reset}`);
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

const resultsDir = path.join(raceDir, `results-${formatTimestamp(new Date())}`);
const totalRuns = settings.runs || 1;

// --- Build runner config ---

// Parallel mode is more spectacular (side-by-side race), but sequential is more
// accurate since browsers don't compete for CPU/memory/network resources.
const isParallel = settings.parallel ?? false;
const executionMode = isParallel ? 'parallel' : 'sequential';
const throttle = { network: settings.network || 'none', cpu: settings.cpuThrottle || 1 };

const runnerConfig = {
  browsers: racerNames.map((name, i) => ({ id: name, script: scripts[i] })),
  executionMode,
  throttle,
  headless: settings.headless || false,
  profile: settings.profile || false,
  slowmo: settings.slowmo || 0,
  noOverlay: settings.noOverlay || false,
  noFfmpeg: settings.noFfmpeg || false,
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
  if (settings.noOverlay) flags.push('no-overlay');
  if (settings.noFfmpeg) flags.push('no-ffmpeg');

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
        const msgPrefix = `[${name}] __raceMessage__[`;
        const msgIdx = text.indexOf(msgPrefix);
        if (msgIdx !== -1) {
          const payload = text.slice(msgIdx + msgPrefix.length).split('\n')[0];
          const match = payload.match(/^([\d.]+)\]:(.*)$/);
          if (match) {
            animation.addMessage(i, name, match[2], match[1]);
          }
        }
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
        try {
          return resolve(JSON.parse(lines[i]));
        } catch (e) {
          if (i === 0) console.error(`Warning: Could not parse runner output`);
        }
      }
      reject(new Error('Could not parse runner output'));
    });
  });
}

/** Run one race, collect results into runDir, return summary. */
async function runSingleRace(runDir, runNavigation = null) {
  const format = settings.format || 'webm';
  const racerRunDirs = racerNames.map(name => path.join(runDir, name));
  racerRunDirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  const result = await runRace();

  const noFfmpeg = settings.noFfmpeg || false;

  const progress = startProgress('Processing recordings…');
  const recordingsBase = path.join(__dirname, 'recordings');
  const results = racerNames.map((name, i) =>
    moveResults(recordingsBase, name, racerRunDirs[i], result.browsers?.[i] || {})
  );

  const summary = buildSummary(racerNames, results, settings, runDir);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  progress.done('Recordings processed');

  const ext = FORMAT_EXTENSIONS[format] || FORMAT_EXTENSIONS.webm;
  let sideBySidePath = null;
  const sideBySideName = `${racerNames.join('-vs-')}${ext}`;

  if (!noFfmpeg) {
    // Order videos by placement (winner first) for side-by-side
    const placementOrder = getPlacementOrder(summary);
    const videoPaths = placementOrder.map(i => results[i].videoPath).filter(Boolean);
    sideBySidePath = createSideBySide(videoPaths, path.join(runDir, sideBySideName), format, settings.slowmo || 0);

    if (format !== 'webm') {
      const convertProgress = startProgress(`Converting videos to ${format}…`);
      convertVideos(results, format);
      convertProgress.done(`Videos converted to ${format}`);
    }
  }

  // In no-ffmpeg mode, there's no trimmed video — the single video IS the full recording.
  // The player handles virtual trimming via clip times from recordingSegments.
  let videoFiles, fullVideoFiles, altFiles;
  if (noFfmpeg) {
    // Only the full (untrimmed) video exists — use it for both race and full views
    videoFiles = racerNames.map(name => `${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
    fullVideoFiles = null; // same file, no separate full video
    altFiles = null;       // no format conversion without ffmpeg
  } else {
    videoFiles = racerNames.map(name => `${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
    fullVideoFiles = racerNames.map(name => `${name}/${name}.full${FORMAT_EXTENSIONS.webm}`);
    altFiles = format !== 'webm' ? racerNames.map(name => `${name}/${name}.race${ext}`) : null;
  }

  const traceFiles = settings.profile ? racerNames.map(name => `${name}/${name}.trace.json`) : null;

  // Collect clip times from recording segments for player-level trimming (no-ffmpeg mode).
  // Uses only the first segment per racer — multiple non-contiguous segments are not
  // supported in player-level trimming (FFmpeg mode concatenates them into one video).
  const clipTimes = noFfmpeg ? racerNames.map((_, i) => {
    const segs = result.browsers?.[i]?.recordingSegments;
    if (!segs || segs.length === 0) return null;
    return { start: segs[0].start, end: segs[0].end };
  }) : null;

  const playerOptions = {
    fullVideoFiles,
    mergedVideoFile: sideBySidePath ? sideBySideName : null,
    traceFiles,
    runNavigation,
    clipTimes,
  };
  fs.writeFileSync(path.join(runDir, 'index.html'), buildPlayerHtml(summary, videoFiles, !noFfmpeg && format !== 'webm' ? format : null, altFiles, playerOptions));

  return { summary, sideBySidePath, sideBySideName, clipTimes };
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
      const sideBySideNames = [];
      const allClipTimes = [];

      for (let i = 0; i < totalRuns; i++) {
        console.error(`\n  ${c.bold}${c.cyan}── Run ${i + 1} of ${totalRuns} ──${c.reset}`);
        const runNav = { currentRun: i + 1, totalRuns, pathPrefix: '../' };
        const { summary, sideBySidePath, sideBySideName, clipTimes: runClipTimes } = await runSingleRace(path.join(resultsDir, String(i + 1)), runNav);
        printSummary(summary);
        summaries.push(summary);
        sideBySideNames.push(sideBySidePath ? sideBySideName : null);
        allClipTimes.push(runClipTimes);
      }

      const medianSummary = buildMedianSummary(summaries, resultsDir);
      fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(medianSummary, null, 2));

      // Find the run closest to median to use its videos on the median page
      const medianRunIdx = findMedianRunIndex(summaries, medianSummary);
      const medianRunDir = String(medianRunIdx + 1);
      const noFfmpeg = settings.noFfmpeg || false;
      const format = settings.format || 'webm';
      const ext = FORMAT_EXTENSIONS[format] || FORMAT_EXTENSIONS.webm;
      const medianVideoFiles = racerNames.map(name => `${medianRunDir}/${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
      const medianFullVideoFiles = noFfmpeg ? null : racerNames.map(name => `${medianRunDir}/${name}/${name}.full${FORMAT_EXTENSIONS.webm}`);
      const medianAltFiles = !noFfmpeg && format !== 'webm' ? racerNames.map(name => `${medianRunDir}/${name}/${name}.race${ext}`) : null;
      const medianMergedFile = sideBySideNames[medianRunIdx] ? `${medianRunDir}/${sideBySideNames[medianRunIdx]}` : null;

      // Create top-level median index.html with navigation and videos from median run
      const medianNav = { currentRun: 'median', totalRuns, pathPrefix: '' };
      const medianPlayerOptions = {
        fullVideoFiles: medianFullVideoFiles,
        mergedVideoFile: medianMergedFile,
        runNavigation: medianNav,
        medianRunLabel: `Run ${medianRunIdx + 1}`,
        clipTimes: allClipTimes[medianRunIdx] || null,
      };
      fs.writeFileSync(
        path.join(resultsDir, 'index.html'),
        buildPlayerHtml(medianSummary, medianVideoFiles, !noFfmpeg && format !== 'webm' ? format : null, medianAltFiles, medianPlayerOptions)
      );

      console.error(`\n  ${c.bold}${c.cyan}── Median Results (${totalRuns} runs) ──${c.reset}`);
      printSummary(medianSummary);

      const md = buildMultiRunMarkdown(medianSummary, summaries);
      fs.writeFileSync(path.join(resultsDir, 'README.md'), md);
    }

    const { relResults, relHtml } = buildResultsPaths(resultsDir);
    console.error(`  ${c.dim}📂 ${relResults}${c.reset}`);
    console.error(`  ${c.cyan}${c.bold}open ${relHtml}${c.reset}`);
  } catch (e) {
    console.error(`\n${c.red}${c.bold}Race failed:${c.reset} ${e.message}\n`);
    process.exit(1);
  }
}

main().then(() => process.exit(0));

} // end isMainModule
