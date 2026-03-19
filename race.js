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
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { RaceAnimation, startProgress } from './cli/animation.js';
import { c, FORMAT_EXTENSIONS } from './cli/colors.js';
import { parseArgs, discoverRacers, applyOverrides, discoverSetupTeardown, discoverRacerSetupTeardown } from './cli/config.js';
import { buildSummary, printSummary, buildMarkdownSummary, buildMedianSummary, buildMultiRunMarkdown, printRecentRaces, getPlacementOrder, findMedianRunIndex, findMedianRunIndexPerRacer } from './cli/summary.js';
import { createSideBySide } from './cli/sidebyside.js';
import { moveResults, convertVideos, copyFFmpegFiles } from './cli/results.js';
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

// --- Race execution (module-scope functions with explicit context) ---

/** Spawn the runner process, show animation, return parsed JSON result. */
export function spawnRunner(ctx) {
  const { racerNames, settings, executionMode, throttle, runnerConfig, rootDir } = ctx;
  const flags = [executionMode];
  if (settings.format !== 'webm') flags.push(settings.format);
  if (settings.runs > 1) flags.push(`${settings.runs} runs`);
  if (throttle.network !== 'none') flags.push(`net:${throttle.network}`);
  if (throttle.cpu > 1) flags.push(`cpu:${throttle.cpu}x`);
  if (settings.slowmo) flags.push(`slowmo:${settings.slowmo}x`);
  if (settings.headless) flags.push('headless');
  if (settings.noOverlay) flags.push('no-overlay');
  if (settings.noRecording) flags.push('no-recording');
  if (settings.ffmpeg) flags.push('ffmpeg');

  const animation = new RaceAnimation(racerNames, flags.join(' · '));
  animation.start();

  const runnerPath = path.join(rootDir, 'runner.cjs');

  return new Promise((resolve, reject) => {
    const child = spawn('node', [runnerPath, JSON.stringify(runnerConfig)], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => {
      const text = d.toString();
      racerNames.forEach((name, i) => {
        if (text.includes(`[${name}] Context closed`)) animation.racerFinished(i);
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\[${escaped}\\] __raceMessage__\\[([\\d.]+)\\]:(.*)`, 'g');
        let m;
        while ((m = re.exec(text)) !== null) {
          animation.addMessage(i, name, m[2], m[1]);
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
export async function runSingleRace(ctx, runDir, runNavigation = null, raceOptions = {}) {
  const { racerNames, settings } = ctx;
  const { format, ffmpeg, noRecording } = settings;
  const racerRunDirs = racerNames.map(name => path.join(runDir, name));
  racerRunDirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  const recordingsDir = path.join(ctx.raceDir || path.dirname(runDir), 'tmp');
  fs.mkdirSync(recordingsDir, { recursive: true });
  const raceCtx = { ...ctx, runnerConfig: { ...ctx.runnerConfig, recordingsDir } };

  const result = await spawnRunner(raceCtx);

  let results, summary, sideBySidePath = null, sideBySideName = null, clipTimes = null;
  // Copy race scripts and settings.json to results directory for export
  const raceScriptFiles = [];
  let settingsFileCopied = false;
  if (ctx.raceDir && ctx.racerFiles) {
    for (const f of ctx.racerFiles) {
      try {
        fs.copyFileSync(path.join(ctx.raceDir, f), path.join(runDir, f));
        raceScriptFiles.push(f);
      } catch (e) {
        console.error(`${c.dim}Warning: Could not copy race script ${f}: ${e.message}${c.reset}`);
      }
    }
    const srcSettings = path.join(ctx.raceDir, 'settings.json');
    if (fs.existsSync(srcSettings)) {
      try {
        fs.copyFileSync(srcSettings, path.join(runDir, 'settings.json'));
        settingsFileCopied = true;
      } catch (e) {
        console.error(`${c.dim}Warning: Could not copy settings.json: ${e.message}${c.reset}`);
      }
    }
  }
  const ext = FORMAT_EXTENSIONS[format] || FORMAT_EXTENSIONS.webm;

  if (noRecording) {
    // No-recording mode: just save measurements, skip all video processing
    results = racerNames.map((name, i) => {
      const b = result.browsers?.[i] || {};
      let tracePath = null;
      if (b.tracePath) {
        const sourceTrace = path.join(recordingsDir, b.tracePath);
        const targetTraceName = `${name}.trace.json`;
        const targetTrace = path.join(racerRunDirs[i], targetTraceName);
        try {
          if (fs.existsSync(sourceTrace)) {
            fs.copyFileSync(sourceTrace, targetTrace);
            tracePath = path.join(name, targetTraceName);
          } else {
            console.error(`${c.dim}Warning: Trace file missing for ${name}: ${sourceTrace}${c.reset}`);
          }
        } catch (e) {
          console.error(`${c.dim}Warning: Could not copy trace for ${name}: ${e.message}${c.reset}`);
        }
      }
      const data = {
        videoPath: null, fullVideoPath: null, tracePath,
        clickEvents: b.clickEvents || [], measurements: b.measurements || [],
        profileMetrics: b.profileMetrics || null, error: b.error || null,
      };
      fs.writeFileSync(path.join(racerRunDirs[i], 'measurements.json'), JSON.stringify(data.measurements, null, 2));
      fs.writeFileSync(path.join(racerRunDirs[i], 'clicks.json'), JSON.stringify(data.clickEvents, null, 2));
      if (data.profileMetrics) fs.writeFileSync(path.join(racerRunDirs[i], 'profile-metrics.json'), JSON.stringify(data.profileMetrics, null, 2));
      return data;
    });
    fs.rmSync(recordingsDir, { recursive: true, force: true });
    summary = buildSummary(racerNames, results, settings, runDir);
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  } else {
    const progress = startProgress('Processing recordings…');
    results = racerNames.map((name, i) =>
      moveResults(recordingsDir, name, racerRunDirs[i], result.browsers?.[i] || {})
    );

    fs.rmSync(recordingsDir, { recursive: true, force: true });

    summary = buildSummary(racerNames, results, settings, runDir);
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    progress.done('Recordings processed');

    sideBySideName = `${racerNames.join('-vs-')}${ext}`;

    if (ffmpeg) {
      // Order videos by placement (winner first) for side-by-side
      const placementOrder = getPlacementOrder(summary);
      const videoPaths = placementOrder.map(i => results[i].videoPath).filter(Boolean);
      sideBySidePath = createSideBySide(videoPaths, path.join(runDir, sideBySideName), format, settings.slowmo);

      if (format !== 'webm') {
        const convertProgress = startProgress(`Converting videos to ${format}…`);
        convertVideos(results, format);
        convertProgress.done(`Videos converted to ${format}`);
      }
    }

    // With --ffmpeg, videos are trimmed and separate full recordings exist.
    // Without --ffmpeg, the single video IS the full recording — the player handles
    // virtual trimming via clip times from recordingSegments.
    let videoFiles, fullVideoFiles, altFiles;
    if (ffmpeg) {
      videoFiles = racerNames.map(name => `${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
      fullVideoFiles = racerNames.map(name => `${name}/${name}.full${FORMAT_EXTENSIONS.webm}`);
      altFiles = format !== 'webm' ? racerNames.map(name => `${name}/${name}.race${ext}`) : null;
    } else {
      // Only the full (untrimmed) video exists — use it for both race and full views
      videoFiles = racerNames.map(name => `${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
      fullVideoFiles = null; // same file, no separate full video
      altFiles = null;       // no format conversion without ffmpeg
    }

    const traceFiles = racerNames.map(name => `${name}/${name}.trace.json`);

    // Collect clip times from recording segments for player-level trimming (default mode).
    // Uses only the first segment per racer — multiple non-contiguous segments are not
    // supported in player-level trimming (--ffmpeg mode concatenates them into one video).
    clipTimes = ffmpeg ? null : racerNames.map((_, i) => {
      const b = result.browsers?.[i];
      const segs = b?.recordingSegments;
      if (!segs || segs.length === 0) return null;
      return {
        start: segs[0].start,
        end: segs[0].end,
        recordingOffset: b?.recordingOffset || 0,
        wallClockDuration: b?.wallClockDuration || 0,
        measurements: b?.measurements || [],
        calibratedStart: b?.calibratedStart ?? null,
        traceCalibration: b?.traceCalibration || null,
      };
    });

    const playerOptions = {
      fullVideoFiles,
      mergedVideoFile: sideBySidePath ? sideBySideName : null,
      traceFiles,
      raceScriptFiles,
      settingsFileCopied,
      runNavigation,
      clipTimes,
      ffmpegPathPrefix: raceOptions.ffmpegPathPrefix || './',
    };
    fs.writeFileSync(path.join(runDir, 'index.html'), buildPlayerHtml(summary, videoFiles, ffmpeg && format !== 'webm' ? format : null, altFiles, playerOptions));
    if (!raceOptions.skipCopyFFmpeg && !settings.noWasm) copyFFmpegFiles(runDir);
  }

  return { summary, sideBySidePath, sideBySideName, clipTimes };
}

/**
 * Build a race context from resolved settings and racer info.
 * This is the config object passed to spawnRunner/runSingleRace.
 */
export function buildRaceContext({ racerNames, scripts, settings, rootDir = __dirname, raceDir = null, racerFiles = null }) {
  const executionMode = settings.parallel ? 'parallel' : 'sequential';
  const throttle = { network: settings.network, cpu: settings.cpuThrottle };

  const runnerConfig = {
    browsers: racerNames.map((name, i) => ({ id: name, script: scripts[i] })),
    executionMode,
    throttle,
    headless: settings.headless,
    slowmo: settings.slowmo,
    noOverlay: settings.noOverlay,
    noRecording: settings.noRecording,
    ffmpeg: settings.ffmpeg,
  };

  return { racerNames, settings, executionMode, throttle, runnerConfig, rootDir, raceDir, racerFiles };
}

// --- Local server ---

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.mov': 'video/quicktime',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

/**
 * Serve `dir` over HTTP on a random free port, open `index.html` in the
 * browser, and keep running until the process is killed.
 */
export function serveResults(dir) {
  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = path.join(dir, urlPath);
    if (!filePath.startsWith(dir + path.sep) && filePath !== dir) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      });
      res.end(data);
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const url = `http://localhost:${port}/`;
    console.error(`  ${c.dim}🌐 Serving at ${c.reset}${c.cyan}${c.bold}${url}${c.reset}`);
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', url]]
      : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
    const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // ignore ENOENT on headless/CI environments
    child.unref();
  });
}

// --- CLI entry point ---

// Check if running as main module (not imported)
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {

// --- Argument parsing ---

const { positional, boolFlags, kvFlags } = parseArgs(process.argv.slice(2));

// --- --init: scaffold a starter race directory ---

if (boolFlags.has('init')) {
  const dirName = positional[0] || 'my-race';
  const targetDir = path.resolve(dirName);

  if (fs.existsSync(targetDir)) {
    console.error(`${c.red}Error: Directory already exists: ${targetDir}${c.reset}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const racerA = `// Racer A — edit this script to test your first URL
// Available race helpers injected into page:
//   await page.raceRecordingStart()   — start video segment (optional)
//   await page.raceStart('name')      — start a measurement
//   page.raceEnd('name')              — end a measurement (sync)
//   page.raceMessage('text')          — send a message to the CLI
//   await page.raceRecordingEnd()     — end video segment (optional)

await page.goto('https://example.com');
await page.raceRecordingStart();
await page.raceStart('Load');
await page.waitForLoadState('networkidle');
page.raceEnd('Load');
await page.raceRecordingEnd();
`;

  const racerB = `// Racer B — edit this script to test your second URL
// Available race helpers injected into page:
//   await page.raceRecordingStart()   — start video segment (optional)
//   await page.raceStart('name')      — start a measurement
//   page.raceEnd('name')              — end a measurement (sync)
//   page.raceMessage('text')          — send a message to the CLI
//   await page.raceRecordingEnd()     — end video segment (optional)

await page.goto('https://example.org');
await page.raceRecordingStart();
await page.raceStart('Load');
await page.waitForLoadState('networkidle');
page.raceEnd('Load');
await page.raceRecordingEnd();
`;

  const settings = JSON.stringify({ parallel: false, headless: false, runs: 3 }, null, 2) + '\n';

  fs.writeFileSync(path.join(targetDir, 'racer-a.spec.js'), racerA);
  fs.writeFileSync(path.join(targetDir, 'racer-b.spec.js'), racerB);
  fs.writeFileSync(path.join(targetDir, 'settings.json'), settings);

  console.error(`
${c.green}${c.bold}✓ Race scaffolded:${c.reset} ${c.cyan}${path.relative(process.cwd(), targetDir)}/${c.reset}

  ${c.dim}racer-a.spec.js${c.reset}  — edit to set your first URL / steps
  ${c.dim}racer-b.spec.js${c.reset}  — edit to set your second URL / steps
  ${c.dim}settings.json${c.reset}    — tune parallel, headless, runs, network, cpu

${c.bold}Run it:${c.reset}
  ${c.cyan}npx race-for-the-prize ${path.relative(process.cwd(), targetDir)}${c.reset}
`);
  process.exit(0);
}

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
       ${c.dim}settings.json${c.reset}        ${c.dim}# Optional: { parallel, network, cpuThrottle, setup, teardown }${c.reset}
       ${c.dim}setup.sh${c.reset}             ${c.dim}# Optional: global setup before race${c.reset}
       ${c.dim}teardown.sh${c.reset}          ${c.dim}# Optional: global teardown after race${c.reset}
       ${c.dim}contender-a.setup.sh${c.reset} ${c.dim}# Optional: per-racer setup${c.reset}
       ${c.dim}contender-a.teardown.sh${c.reset} ${c.dim}# Optional: per-racer teardown${c.reset}

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
  node race.js ${c.yellow}--init${c.reset} ${c.cyan}[dir]${c.reset}               Scaffold a starter race (default: my-race/)
  node race.js ${c.cyan}<dir>${c.reset}                       Run a race
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--results${c.reset}            View recent results
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--parallel${c.reset}           Run both browsers simultaneously
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--headless${c.reset}           Hide browsers
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--network${c.reset}=${c.green}slow-3g${c.reset}   Network: none, slow-3g, fast-3g, 4g
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--cpu${c.reset}=${c.green}4${c.reset}              CPU throttle multiplier (1=none)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--format${c.reset}=${c.green}mov${c.reset}          Output format: webm (default), mov, gif
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--runs${c.reset}=${c.green}3${c.reset}            Run multiple times, report median
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--slowmo${c.reset}=${c.green}2${c.reset}           Slow-motion side-by-side replay (2x, 3x, etc.)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-overlay${c.reset}         Record videos without overlays
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-recording${c.reset}      Skip video recording, just measure
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--ffmpeg${c.reset}             Enable FFmpeg processing (trim, merge, convert)

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

// --- Setup/Teardown discovery ---

const { setup: setupScript, teardown: teardownScript } = discoverSetupTeardown(raceDir, settings);

// Per-racer setup/teardown (e.g., lauda.setup.sh, hunt.teardown.js)
const racerScripts = racerNames.map(name => ({
  name,
  ...discoverRacerSetupTeardown(raceDir, name, settings),
}));

/**
 * Run a setup or teardown script.
 * Supports both shell scripts (.sh) and Node.js scripts (.js).
 * Can be a string (script path) or object { command, timeout, waitFor }.
 *
 * @param {string|object} script - Script path or config object
 * @param {string} label - Label for logging ('Setup' or 'Teardown')
 * @returns {Promise<void>}
 */
async function runScript(script, label) {
  if (!script) return;

  const config = typeof script === 'string' ? { command: script } : script;
  const { command, timeout = 60000, waitFor } = config;
  const scriptPath = path.resolve(raceDir, command);

  if (!fs.existsSync(scriptPath)) {
    console.error(`${c.yellow}Warning: ${label} script not found: ${scriptPath}${c.reset}`);
    return;
  }

  const progress = startProgress(`Running ${label.toLowerCase()}…`);

  return new Promise((resolve, reject) => {
    const ext = path.extname(scriptPath);
    const isShell = ext === '.sh';
    const args = isShell ? [scriptPath] : [scriptPath];
    const cmd = isShell ? 'bash' : 'node';

    const child = spawn(cmd, args, {
      cwd: raceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RACE_DIR: raceDir },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      progress.done(`${label} timed out after ${timeout}ms`);
      reject(new Error(`${label} script timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', code => {
      clearTimeout(timeoutId);
      if (code === 0) {
        progress.done(`${label} completed`);

        // If waitFor is specified, poll for the condition
        if (waitFor) {
          const { url, timeout: waitTimeout = 30000, interval = 1000 } = waitFor;
          if (url) {
            const waitProgress = startProgress(`Waiting for ${url}…`);
            const startTime = Date.now();

            const poll = async () => {
              try {
                const res = await fetch(url);
                if (res.ok) {
                  waitProgress.done(`Service ready at ${url}`);
                  resolve();
                  return;
                }
              } catch {}

              if (Date.now() - startTime > waitTimeout) {
                waitProgress.done(`Timeout waiting for ${url}`);
                reject(new Error(`Timeout waiting for ${url} after ${waitTimeout}ms`));
                return;
              }
              setTimeout(poll, interval);
            };
            poll();
            return;
          }
        }

        resolve();
      } else {
        progress.done(`${label} failed (exit code ${code})`);
        if (stderr) console.error(`${c.dim}${stderr}${c.reset}`);
        reject(new Error(`${label} script exited with code ${code}`));
      }
    });

    child.on('error', err => {
      clearTimeout(timeoutId);
      progress.done(`${label} error: ${err.message}`);
      reject(err);
    });
  });
}

// --- Resolve settings defaults once (avoid repeated `|| false` everywhere) ---

settings.parallel = settings.parallel ?? false;
settings.headless = settings.headless ?? false;
settings.noOverlay = settings.noOverlay ?? false;
settings.noRecording = settings.noRecording ?? false;
settings.ffmpeg = settings.ffmpeg ?? false;
settings.noWasm = settings.noWasm ?? false;
settings.format = settings.format ?? 'webm';
settings.network = settings.network ?? 'none';
settings.cpuThrottle = settings.cpuThrottle ?? 1;
settings.slowmo = settings.slowmo ?? 0;
settings.runs = settings.runs ?? 1;

// --- Build race context ---

const ctx = buildRaceContext({ racerNames, scripts, settings, rootDir: __dirname, raceDir, racerFiles });
const resultsDir = path.join(raceDir, `results-${formatTimestamp(new Date())}`);
const totalRuns = settings.runs;

// --- Main ---

async function main() {
  // Run global setup script before races
  try {
    await runScript(setupScript, 'Setup');
  } catch (e) {
    console.error(`\n${c.red}${c.bold}Setup failed:${c.reset} ${e.message}\n`);
    process.exit(1);
  }

  // Run per-racer setup scripts
  for (const racer of racerScripts) {
    if (racer.setup) {
      try {
        await runScript(racer.setup, `Setup [${racer.name}]`);
      } catch (e) {
        console.error(`\n${c.red}${c.bold}Setup for ${racer.name} failed:${c.reset} ${e.message}\n`);
        process.exit(1);
      }
    }
  }

  try {
    if (totalRuns === 1) {
      const { summary, sideBySidePath, sideBySideName } = await runSingleRace(ctx, resultsDir);
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
        const { summary, sideBySidePath, sideBySideName, clipTimes: runClipTimes } = await runSingleRace(ctx, path.join(resultsDir, String(i + 1)), runNav, { skipCopyFFmpeg: true, ffmpegPathPrefix: '../' });
        printSummary(summary);
        summaries.push(summary);
        sideBySideNames.push(sideBySidePath ? sideBySideName : null);
        allClipTimes.push(runClipTimes);
      }

      const medianSummary = buildMedianSummary(summaries, resultsDir);
      fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(medianSummary, null, 2));

      if (!settings.noRecording) {
        // For each racer independently, pick the run closest to their median
        const perRacerRunIdx = findMedianRunIndexPerRacer(summaries, medianSummary);
        // For merged video and shared assets, use the overall best-fit run
        const overallMedianRunIdx = findMedianRunIndex(summaries, medianSummary);
        const overallMedianRunDir = String(overallMedianRunIdx + 1);
        const { ffmpeg, format } = settings;
        const ext = FORMAT_EXTENSIONS[format] || FORMAT_EXTENSIONS.webm;
        const medianVideoFiles = racerNames.map((name, i) => `${perRacerRunIdx[i] + 1}/${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
        const medianFullVideoFiles = ffmpeg ? racerNames.map((name, i) => `${perRacerRunIdx[i] + 1}/${name}/${name}.full${FORMAT_EXTENSIONS.webm}`) : null;
        const medianAltFiles = ffmpeg && format !== 'webm' ? racerNames.map((name, i) => `${perRacerRunIdx[i] + 1}/${name}/${name}.race${ext}`) : null;
        const medianMergedFile = sideBySideNames[overallMedianRunIdx] ? `${overallMedianRunDir}/${sideBySideNames[overallMedianRunIdx]}` : null;
        // Clip times: each racer takes their own best run's clip entry
        const medianClipTimes = allClipTimes.some(ct => ct != null)
          ? racerNames.map((_, i) => allClipTimes[perRacerRunIdx[i]]?.[i] ?? null)
          : null;
        // Label showing which runs were selected (e.g. "Run 2" or "Runs 1, 2, 3")
        const uniqueRunNums = [...new Set(perRacerRunIdx.map(idx => idx + 1))].sort((a, b) => a - b);
        const medianRunLabel = uniqueRunNums.length === 1
          ? `Run ${uniqueRunNums[0]}`
          : `Runs ${uniqueRunNums.join(', ')}`;

        // Create top-level median index.html with navigation and per-racer best videos
        const medianNav = { currentRun: 'median', totalRuns, pathPrefix: '' };
        const medianPlayerOptions = {
          fullVideoFiles: medianFullVideoFiles,
          mergedVideoFile: medianMergedFile,
          raceScriptFiles: ctx.racerFiles ? ctx.racerFiles.map(f => `${overallMedianRunDir}/${f}`) : null,
          settingsFileCopied: fs.existsSync(path.join(resultsDir, overallMedianRunDir, 'settings.json')),
          runNavigation: medianNav,
          medianRunLabel,
          clipTimes: medianClipTimes,
        };
        fs.writeFileSync(
          path.join(resultsDir, 'index.html'),
          buildPlayerHtml(medianSummary, medianVideoFiles, ffmpeg && format !== 'webm' ? format : null, medianAltFiles, medianPlayerOptions)
        );
        if (!settings.noWasm) copyFFmpegFiles(resultsDir);
      }

      console.error(`\n  ${c.bold}${c.cyan}── Median Results (${totalRuns} runs) ──${c.reset}`);
      printSummary(medianSummary);

      const md = buildMultiRunMarkdown(medianSummary, summaries);
      fs.writeFileSync(path.join(resultsDir, 'README.md'), md);
    }

    const { relResults, relHtml } = buildResultsPaths(resultsDir);
    console.error(`  ${c.dim}📂 ${relResults}${c.reset}`);

    if (!settings.noRecording) {
      const shouldServe = kvFlags.serve !== 'false';
      if (shouldServe) {
        serveResults(resultsDir);
      } else {
        console.error(`  ${c.cyan}${c.bold}open ${relHtml}${c.reset}`);
      }
    }
  } catch (e) {
    console.error(`\n${c.red}${c.bold}Race failed:${c.reset} ${e.message}\n`);
    throw e; // Re-throw to trigger teardown via finally
  } finally {
    // Run per-racer teardown scripts (even on failure)
    for (const racer of racerScripts) {
      if (racer.teardown) {
        try {
          await runScript(racer.teardown, `Teardown [${racer.name}]`);
        } catch (e) {
          console.error(`\n${c.yellow}Teardown for ${racer.name} failed:${c.reset} ${e.message}`);
        }
      }
    }

    // Run global teardown script after races (even on failure)
    try {
      await runScript(teardownScript, 'Teardown');
    } catch (e) {
      console.error(`\n${c.yellow}Teardown failed:${c.reset} ${e.message}`);
    }
  }
}

main().then(() => { if (kvFlags.serve === 'false' || settings.noRecording) process.exit(0); }).catch(() => process.exit(1));

} // end isMainModule
