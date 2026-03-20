#!/usr/bin/env node

/**
 * race.js — CLI entry point for RaceForThePrize 🏆
 *
 * Orchestrates browser races: parses args, discovers racer scripts,
 * spawns the Playwright runner, collects results, and prints a report.
 *
 * Usage:
 *   node race.js https://a.com https://b.com  Race page load times (URL mode)
 *   node race.js ./races/my-race              Run a scripted race
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
import { parseArgs, discoverRacers, applyOverrides, applyDefaults, isUrl, deriveRacerName, buildDefaultRaceScript } from './cli/config.js';
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

/** Wait for the user to press Enter, displaying a prompt message. Resolves immediately in non-TTY environments. */
export async function waitForEnter(message) {
  if (!process.stdin.isTTY) {
    process.stderr.write(message + ' (skipped — non-interactive)\n');
    return;
  }

  process.stderr.write(message);

  // Drain any type-ahead input that accumulated during the previous run:
  // resume() starts flowing, a tick with no listeners discards buffered data.
  process.stdin.resume();
  await new Promise(r => setTimeout(r, 50));

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onDone);
      process.stdin.removeListener('error', onDone);
      process.stdin.pause();
    };

    const onData = () => { cleanup(); resolve(); };
    const onDone = () => { cleanup(); resolve(); };

    process.stdin.once('data', onData);
    process.stdin.once('end', onDone);
    process.stdin.once('error', onDone);
  });
}

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

  // Pre-compile message regexes to avoid recreating them on every stderr event
  const messageRegexes = racerNames.map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\[${escaped}\\] __raceMessage__\\[([\\d.]+)\\]:(.*)`, 'g');
  });

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
        const re = messageRegexes[i];
        re.lastIndex = 0;
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
 * Create an HTTP request handler that serves static files from `dir`.
 * Exported for testing.
 */
export function createStaticHandler(dir) {
  return (req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url === '/' ? '/index.html' : req.url.split('?')[0]);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const filePath = path.resolve(path.join(dir, urlPath));
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
  };
}

/**
 * Serve `dir` over HTTP on a random free port, open `index.html` in the
 * browser, and keep running until the process is killed.
 */
export function serveResults(dir) {
  const server = http.createServer(createStaticHandler(dir));

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
const isMainModule = process.argv[1] && (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
})();

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

// Helper: load race config for a given directory (discovers racers, loads settings, builds ctx)
function loadRaceDir(raceDir) {
  if (!fs.existsSync(raceDir)) {
    console.error(`${c.red}Error: Race directory not found: ${raceDir}${c.reset}`);
    process.exit(1);
  }

  const { racerFiles, racerNames } = discoverRacers(raceDir);
  if (racerFiles.length < 2) {
    console.error(`${c.red}Error: Need at least 2 .spec.js (or .js) script files in ${raceDir}, found ${racerFiles.length}${c.reset}`);
    process.exit(1);
  }
  if (racerFiles.length > 5) {
    console.error(`${c.yellow}Warning: Found ${racerFiles.length} script files, using first five: ${racerFiles.slice(0, 5).join(', ')}${c.reset}`);
  }
  const scripts = racerFiles.map(f => fs.readFileSync(path.join(raceDir, f), 'utf-8'));

  let settings = {};
  const settingsPath = path.join(raceDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (e) {
      console.error(`${c.yellow}Warning: Could not parse settings.json: ${e.message}${c.reset}`);
    }
  }
  settings = applyDefaults(applyOverrides(settings, boolFlags, kvFlags));

  const ctx = buildRaceContext({ racerNames, scripts, settings, rootDir: __dirname, raceDir, racerFiles });
  return { ctx, settings, racerNames };
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

${c.bold}  Quick Race (URL mode):${c.reset}
${c.dim}  ─────────────────────────────────────────────────────────────${c.reset}
  Pass 2+ URLs directly to measure page load times head-to-head:

     ${c.bold}$${c.reset} ${c.cyan}node race.js https://react.dev https://angular.dev${c.reset}

${c.bold}  Commands:${c.reset}
${c.dim}  ─────────────────────────────────────────────────────────────${c.reset}
  node race.js ${c.cyan}<url> <url> [url...]${c.reset}      Race page load times (2-5 URLs)
  node race.js ${c.yellow}--init${c.reset} ${c.cyan}[dir]${c.reset}               Scaffold a starter race (default: my-race/)
  node race.js ${c.cyan}<dir>${c.reset}                       Run a scripted race
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--results${c.reset}            View recent results
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--parallel${c.reset}           Run both browsers simultaneously
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--headless${c.reset}           Hide browsers
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--network${c.reset}=${c.green}slow-3g${c.reset}   Network: none, slow-3g, fast-3g, 4g
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--cpu${c.reset}=${c.green}4${c.reset}              CPU throttle multiplier (1=none)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--format${c.reset}=${c.green}mov${c.reset}          Output format: webm (default), mov, gif
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--runs${c.reset}=${c.green}3${c.reset}            Run multiple times, report median
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--pause${c.reset}              Pause between runs (press Enter to continue)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--slowmo${c.reset}=${c.green}2${c.reset}           Slow-motion side-by-side replay (2x, 3x, etc.)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-overlay${c.reset}         Record videos without overlays
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-recording${c.reset}      Skip video recording, just measure
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--ffmpeg${c.reset}             Enable FFmpeg processing (trim, merge, convert)

${c.dim}  All flags work with both URL mode and directory mode.${c.reset}
${c.dim}  Try the example:  node race.js ./races/lauda-vs-hunt${c.reset}
`);
  process.exit(1);
}

// --- Detect URL mode vs directory mode ---

if (positional.length === 1 && isUrl(positional[0])) {
  console.error(`${c.red}Error: URL mode requires at least 2 URLs to race against each other${c.reset}`);
  console.error(`${c.dim}  Example: node race.js https://react.dev https://angular.dev${c.reset}`);
  process.exit(1);
}

const urlMode = positional.length >= 2 && positional.every(p => isUrl(p));
let raceDir;
let ctx, settings, racerNames;

if (urlMode) {
  // URL mode: generate race scripts from URLs
  const urls = positional.slice(0, 5);
  if (urls.length > 5) {
    console.error(`${c.yellow}Warning: Using first 5 URLs of ${positional.length} provided${c.reset}`);
  }

  // Derive names and deduplicate by appending suffix where needed
  const rawNames = urls.map(u => deriveRacerName(u));
  const counts = {};
  for (const n of rawNames) counts[n] = (counts[n] || 0) + 1;
  const used = {};
  const names = rawNames.map(n => {
    if (counts[n] === 1) return n;
    used[n] = (used[n] || 0);
    return `${n}-${used[n]++}`;
  });

  const scripts = urls.map(u => buildDefaultRaceScript(u));
  raceDir = path.resolve(names.join('-vs-'));
  fs.mkdirSync(raceDir, { recursive: true });

  settings = applyDefaults(applyOverrides({}, boolFlags, kvFlags));
  racerNames = names;
  ctx = buildRaceContext({ racerNames, scripts, settings, rootDir: __dirname, raceDir });
} else {
  raceDir = path.resolve(positional[0]);

  if (!fs.existsSync(raceDir)) {
    console.error(`${c.red}Error: Race directory not found: ${raceDir}${c.reset}`);
    process.exit(1);
  }

  if (boolFlags.has('results')) {
    printRecentRaces(raceDir);
    process.exit(0);
  }

  ({ ctx, settings, racerNames } = loadRaceDir(raceDir));
}

const totalRuns = settings.runs;
const resultsDir = path.join(raceDir, `results-${formatTimestamp(new Date())}`);

// --- Main ---

/**
 * Run a single racer (by index) alone for one iteration.
 * Returns { rawResult, movedResult } with recordings moved into racerRunDir.
 */
async function runRacerAlone(browserIdx, racerRunDir) {
  const recordingsDir = path.join(ctx.raceDir || resultsDir, `tmp-r${browserIdx}`);
  fs.mkdirSync(recordingsDir, { recursive: true });
  fs.mkdirSync(racerRunDir, { recursive: true });

  const singleCtx = {
    ...ctx,
    racerNames: [racerNames[browserIdx]],
    runnerConfig: { ...ctx.runnerConfig, browsers: [ctx.runnerConfig.browsers[browserIdx]], recordingsDir },
  };

  const rawResult = await spawnRunner(singleCtx);
  const movedResult = moveResults(recordingsDir, racerNames[browserIdx], racerRunDir, rawResult.browsers?.[0] || {});
  fs.rmSync(recordingsDir, { recursive: true, force: true });
  return { rawResult, movedResult };
}

/**
 * Build the per-run output (summary.json + index.html) after all racers' recordings
 * for run `i` are already moved into their run directories.
 */
function buildRunOutput(runDir, runRawResults, runMovedResults, runNav, raceOpts = {}) {
  const { format, ffmpeg, noWasm } = settings;

  const progress = startProgress('Processing recordings…');
  const summary = buildSummary(racerNames, runMovedResults, settings, runDir);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  const raceScriptFiles = [];
  let settingsFileCopied = false;
  if (ctx.raceDir && ctx.racerFiles) {
    for (const f of ctx.racerFiles) {
      try { fs.copyFileSync(path.join(ctx.raceDir, f), path.join(runDir, f)); raceScriptFiles.push(f); } catch (e) {}
    }
    const srcSettings = path.join(ctx.raceDir, 'settings.json');
    if (fs.existsSync(srcSettings)) {
      try { fs.copyFileSync(srcSettings, path.join(runDir, 'settings.json')); settingsFileCopied = true; } catch (e) {}
    }
  }

  progress.done('Recordings processed');

  const clipTimes = ffmpeg ? null : racerNames.map((_, ri) => {
    const b = runRawResults[ri].browsers?.[0];
    const segs = b?.recordingSegments;
    if (!segs || segs.length === 0) return null;
    return {
      start: segs[0].start, end: segs[0].end,
      recordingOffset: b?.recordingOffset || 0,
      wallClockDuration: b?.wallClockDuration || 0,
      measurements: b?.measurements || [],
      calibratedStart: b?.calibratedStart ?? null,
      traceCalibration: b?.traceCalibration || null,
    };
  });

  const videoFiles = racerNames.map(name => `${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
  const traceFiles = racerNames.map(name => `${name}/${name}.trace.json`);
  const playerOptions = {
    traceFiles, raceScriptFiles, settingsFileCopied,
    runNavigation: runNav, clipTimes,
    ffmpegPathPrefix: raceOpts.ffmpegPathPrefix || './',
  };
  fs.writeFileSync(path.join(runDir, 'index.html'), buildPlayerHtml(summary, videoFiles, null, null, playerOptions));
  if (!raceOpts.skipCopyFFmpeg && !noWasm) copyFFmpegFiles(runDir);

  return { summary, clipTimes };
}

async function main() {
  try {
    if (!settings.pauseBetweenRuns) {
      // --- Normal mode: both racers run together per run ---
      if (totalRuns === 1) {
        const { summary, sideBySidePath, sideBySideName } = await runSingleRace(ctx, resultsDir);
        printSummary(summary);
        fs.writeFileSync(path.join(resultsDir, 'README.md'), buildMarkdownSummary(summary, sideBySidePath ? sideBySideName : null));
      } else {
        fs.mkdirSync(resultsDir, { recursive: true });
        const summaries = [], sideBySideNames = [], allClipTimes = [];

        for (let i = 0; i < totalRuns; i++) {
          console.error(`\n  ${c.bold}${c.cyan}── Run ${i + 1} of ${totalRuns} ──${c.reset}`);
          const runNav = { currentRun: i + 1, totalRuns, pathPrefix: '../' };
          const { summary, sideBySidePath, sideBySideName, clipTimes: runClipTimes } = await runSingleRace(ctx, path.join(resultsDir, String(i + 1)), runNav, { skipCopyFFmpeg: true, ffmpegPathPrefix: '../' });
          printSummary(summary);
          summaries.push(summary);
          sideBySideNames.push(sideBySidePath ? sideBySideName : null);
          allClipTimes.push(runClipTimes);
        }

        buildMedianOutput(summaries, sideBySideNames, allClipTimes);
      }
    } else {
      // --- Split mode: all runs of each racer in sequence, pause between racers ---
      // A₁ → A₂ → … → Aₙ → [PAUSE] → B₁ → B₂ → … → Bₙ
      fs.mkdirSync(resultsDir, { recursive: true });
      const multiRun = totalRuns > 1;

      // rawResults[racerIdx][runIdx], movedResults[racerIdx][runIdx]
      const rawResults  = racerNames.map(() => Array(totalRuns).fill(null));
      const movedResults = racerNames.map(() => Array(totalRuns).fill(null));

      for (let ri = 0; ri < racerNames.length; ri++) {
        if (ri > 0) {
          await waitForEnter(`\n  ${c.bold}${c.yellow}⏸  Paused — press Enter to start ${racerNames[ri]}...${c.reset} `);
        }
        for (let i = 0; i < totalRuns; i++) {
          const label = multiRun ? `${racerNames[ri]}: Run ${i + 1} of ${totalRuns}` : racerNames[ri];
          console.error(`\n  ${c.bold}${c.cyan}── ${label} ──${c.reset}`);
          const runDir = multiRun ? path.join(resultsDir, String(i + 1)) : resultsDir;
          const { rawResult, movedResult } = await runRacerAlone(ri, path.join(runDir, racerNames[ri]));
          rawResults[ri][i] = rawResult;
          movedResults[ri][i] = movedResult;
        }
      }

      const summaries = [], allClipTimes = [];
      for (let i = 0; i < totalRuns; i++) {
        const runDir = multiRun ? path.join(resultsDir, String(i + 1)) : resultsDir;
        const runNav = multiRun ? { currentRun: i + 1, totalRuns, pathPrefix: '../' } : null;
        const { summary, clipTimes } = buildRunOutput(
          runDir,
          racerNames.map((_, ri) => rawResults[ri][i]),
          racerNames.map((_, ri) => movedResults[ri][i]),
          runNav,
          { skipCopyFFmpeg: multiRun, ffmpegPathPrefix: multiRun ? '../' : './' }
        );
        printSummary(summary);
        summaries.push(summary);
        allClipTimes.push(clipTimes);
      }

      if (!multiRun) {
        fs.writeFileSync(path.join(resultsDir, 'README.md'), buildMarkdownSummary(summaries[0], null));
      } else {
        buildMedianOutput(summaries, summaries.map(() => null), allClipTimes);
      }
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
    process.exit(1);
  }
}

function buildMedianOutput(summaries, sideBySideNames, allClipTimes) {
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
    const medianMergedFile = sideBySideNames?.[overallMedianRunIdx] ? `${overallMedianRunDir}/${sideBySideNames[overallMedianRunIdx]}` : null;
    // Clip times: each racer takes their own best run's clip entry
    const medianClipTimes = allClipTimes.some(ct => ct != null)
      ? racerNames.map((_, i) => allClipTimes[perRacerRunIdx[i]]?.[i] ?? null)
      : null;
    // Label showing which runs were selected (e.g. "Run 2" or "Runs 1, 2, 3")
    const uniqueRunNums = [...new Set(perRacerRunIdx.map(idx => idx + 1))].sort((a, b) => a - b);
    const medianRunLabel = uniqueRunNums.length === 1
      ? `Run ${uniqueRunNums[0]}`
      : `Runs ${uniqueRunNums.join(', ')}`;

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
  fs.writeFileSync(path.join(resultsDir, 'README.md'), buildMultiRunMarkdown(medianSummary, summaries));
}

await main();
if (kvFlags.serve === 'false' || settings.noRecording) process.exit(0);

} // end isMainModule
