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
 *   node race.js ./races/my-race --har --no-wasm --no-serve
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { spawn, spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { RaceAnimation, startProgress } from './cli/animation.js';
import { c, FORMAT_EXTENSIONS } from './cli/colors.js';
import { parseArgs, discoverRacers, applyOverrides, applyDefaults, isUrl, deriveRacerName, buildDefaultRaceScript, discoverSetupTeardown, discoverRacerSetupTeardown, findUnknownFlags, InvalidSettingError } from './cli/config.js';
import { buildSummary, printSummary, buildMarkdownSummary, buildMedianSummary, buildMultiRunMarkdown, printRecentRaces, getPlacementOrder, findMedianRunIndex, findMedianRunIndexPerRacer } from './cli/summary.js';
import { createSideBySide } from './cli/sidebyside.js';
import { moveResults, convertVideos, copyFFmpegFiles } from './cli/results.js';
import { buildPlayerHtml } from './cli/videoplayer.js';
import { buildRunNavHtml } from './cli/player-sections.js';
import { runGeminiSummary, runGeminiSpec } from './cli/gemini-summary.js';

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

/** Sentinel prefix used by runner.cjs to mark its one real result line. */
export const RUNNER_RESULT_SENTINEL = '__RACE_RESULT__';

/**
 * Module-level abort state. Set on SIGINT so in-flight work can bail out
 * (spawnRunner, waitForEnter, waitFor loops) and tear-down paths can avoid
 * treating the signal as a successful no-op.
 */
export const abortState = { aborted: false, reason: null };

// Restore cursor on any exit so we don't leave the user's terminal with a
// hidden cursor after an unexpected crash or Ctrl+C during the animation.
process.on('exit', () => {
  if (process.stderr.isTTY) process.stderr.write(c.showCursor);
});

/** Wait for the user to press Enter, displaying a prompt message. Resolves immediately in non-TTY environments. */
export async function waitForEnter(message) {
  if (!process.stdin.isTTY) {
    process.stderr.write(message + ' (skipped — non-interactive)\n');
    return;
  }
  if (abortState.aborted) return;

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
      process.removeListener('SIGINT', onAbort);
      process.stdin.pause();
    };

    const onData = () => { cleanup(); resolve(); };
    const onDone = () => { cleanup(); resolve(); };
    const onAbort = () => { abortState.aborted = true; abortState.reason = 'SIGINT'; cleanup(); resolve(); };

    process.stdin.once('data', onData);
    process.stdin.once('end', onDone);
    process.stdin.once('error', onDone);
    process.once('SIGINT', onAbort);
  });
}

// --- Race execution (module-scope functions with explicit context) ---

/**
 * Copy race scripts and settings.json from the race directory into runDir.
 * Returns { raceScriptFiles, settingsFileCopied }.
 */
function copyRaceAssets(raceDir, racerFiles, runDir) {
  const raceScriptFiles = [];
  let settingsFileCopied = false;
  if (raceDir && racerFiles) {
    for (const f of racerFiles) {
      try {
        fs.copyFileSync(path.join(raceDir, f), path.join(runDir, f));
        raceScriptFiles.push(f);
      } catch (e) {
        console.error(`${c.dim}Warning: Could not copy race script ${f}: ${e.message}${c.reset}`);
      }
    }
    const srcSettings = path.join(raceDir, 'settings.json');
    if (fs.existsSync(srcSettings)) {
      try {
        fs.copyFileSync(srcSettings, path.join(runDir, 'settings.json'));
        settingsFileCopied = true;
      } catch (e) {
        console.error(`${c.dim}Warning: Could not copy settings.json: ${e.message}${c.reset}`);
      }
    }
  }
  return { raceScriptFiles, settingsFileCopied };
}

/**
 * Build clip times from recording segments for player-level trimming (default mode).
 * Uses only the first segment per racer — multiple non-contiguous segments are not
 * supported in player-level trimming (--ffmpeg mode concatenates them into one video).
 *
 * @param {string[]} racerNames
 * @param {function} getBrowserData - (racerIndex) => browser data object
 * @param {boolean} ffmpeg - whether ffmpeg mode is enabled (clip times are null in ffmpeg mode)
 * @returns {Array|null}
 */
function buildClipTimes(racerNames, getBrowserData, ffmpeg) {
  if (ffmpeg) return null;
  return racerNames.map((_, i) => {
    const b = getBrowserData(i);
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
}

/**
 * Write the player HTML and optionally copy FFmpeg files into runDir.
 *
 * @param {object} options
 * @param {string} options.runDir - output directory
 * @param {object} options.summary - race summary
 * @param {object} options.settings
 * @param {string[]} options.videoFiles
 * @param {object} options.playerExtras - additional fields merged into playerOptions (may include altFiles)
 * @param {object} options.raceOptions - { skipCopyFFmpeg, ffmpegPathPrefix }
 */
function writePlayerAndAssets({ runDir, summary, settings, videoFiles, playerExtras, raceOptions }) {
  const { format, ffmpeg, noWasm } = settings;
  const altFormat = ffmpeg && format !== 'webm' ? format : null;
  // altFiles is passed as a separate arg to buildPlayerHtml, not via playerOptions
  const { altFiles, ...restExtras } = playerExtras;
  const playerOptions = {
    ...restExtras,
    ffmpegPathPrefix: raceOptions.ffmpegPathPrefix || './',
  };
  fs.writeFileSync(
    path.join(runDir, 'index.html'),
    buildPlayerHtml(summary, videoFiles, altFormat, altFiles || null, playerOptions)
  );
  if (!raceOptions.skipCopyFFmpeg && !noWasm) copyFFmpegFiles(runDir);
}

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
    // NOSONAR — spawns runner.cjs subprocess with race config; this is the core
    // execution mechanism equivalent to running `node runner.cjs <config>`
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

    const sigHandler = () => {
      abortState.aborted = true;
      abortState.reason = 'SIGINT';
      child.kill('SIGTERM');
    };
    process.on('SIGINT', sigHandler);

    function cleanup() {
      process.removeListener('SIGINT', sigHandler);
      if (animation.interval) animation.stop();
    }

    child.on('error', (err) => {
      cleanup();
      reject(new Error(`Runner process failed to start: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      cleanup();

      if (abortState.aborted || signal === 'SIGTERM' || signal === 'SIGINT' || code === 130 || code === 143) {
        reject(new Error(`Race aborted${abortState.reason ? ` (${abortState.reason})` : ''}`));
        return;
      }

      // Parse only the line starting with the sentinel. This guards against
      // arbitrary stdout noise (Playwright logs, subprocess output) and
      // ensures a signal-cleanup stub from a previous killed run can never
      // be mistaken for a real result.
      const lines = stdout.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.startsWith(RUNNER_RESULT_SENTINEL)) continue;
        try {
          return resolve(JSON.parse(line.slice(RUNNER_RESULT_SENTINEL.length)));
        } catch (e) {
          console.error(`Warning: Malformed runner result line: ${e.message}`);
        }
      }
      reject(new Error(`Runner exited with code ${code} and produced no parseable result`));
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
  const { raceScriptFiles, settingsFileCopied } = copyRaceAssets(ctx.raceDir, ctx.racerFiles, runDir);
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
        measurements: b.measurements || [],
        profileMetrics: b.profileMetrics || null, error: b.error || null,
      };
      fs.writeFileSync(path.join(racerRunDirs[i], 'measurements.json'), JSON.stringify(data.measurements, null, 2));
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
    const harFiles = racerNames.map((name, i) => {
      return results[i]?.harPath ? `${name}/${name}.har` : null;
    });

    clipTimes = buildClipTimes(racerNames, (i) => result.browsers?.[i], ffmpeg);

    writePlayerAndAssets({
      runDir, summary, settings, videoFiles,
      playerExtras: {
        fullVideoFiles,
        mergedVideoFile: sideBySidePath ? sideBySideName : null,
        traceFiles,
        harFiles,
        raceScriptFiles,
        settingsFileCopied,
        runNavigation,
        clipTimes,
        altFiles,
      },
      raceOptions,
    });
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
    browsers: racerNames.map((name, i) => ({
      id: name,
      script: scripts[i],
      vars: settings.racers?.[name]?.vars,
    })),
    executionMode,
    throttle,
    headless: settings.headless,
    slowmo: settings.slowmo,
    noOverlay: settings.noOverlay,
    noRecording: settings.noRecording,
    ffmpeg: settings.ffmpeg,
    har: settings.har,
    ignoreHTTPSErrors: settings.ignoreHTTPSErrors,
    viewportHeight: settings.viewportHeight,
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
 *
 * Security: rejects any path that resolves outside `dir` (path traversal).
 * Range requests: advertises `Accept-Ranges: bytes` and responds with
 * `206 Partial Content` so browsers can seek within media files (WebM, MP4).
 * COOP/COEP headers are required for `SharedArrayBuffer` isolation used by
 * FFmpeg.wasm in the browser player.
 *
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
    // Reject paths that escape the served directory. `filePath !== dir` allows
    // the root directory itself to resolve (though in practice req.url='/' is
    // rewritten to index.html above).
    if (!filePath.startsWith(dir + path.sep) && filePath !== dir) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const baseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      // Required for SharedArrayBuffer isolation (FFmpeg.wasm uses COOP/COEP).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    };
    fs.stat(filePath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const total = stat.size;
      const rangeHeader = req.headers['range'];

      const pipeStream = (stream) => {
        stream.on('error', () => { if (!res.writableEnded) res.end(); });
        stream.pipe(res);
      };

      if (rangeHeader) {
        const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
        if (!m) { res.writeHead(416); res.end(); return; }
        let start, end;
        if (!m[1] && !m[2]) {
          // bytes=- with no numbers is invalid
          res.writeHead(416); res.end(); return;
        } else if (!m[1]) {
          // Suffix range: bytes=-N → last N bytes
          start = Math.max(0, total - parseInt(m[2], 10));
          end = total - 1;
        } else {
          start = parseInt(m[1], 10);
          end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
        }
        if (start > end || start >= total) { res.writeHead(416); res.end(); return; }
        res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${total}` });
        pipeStream(fs.createReadStream(filePath, { start, end }));
      } else {
        res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
        pipeStream(fs.createReadStream(filePath));
      }
    });
  };
}

/**
 * Detect whether the current environment is headless/CI, where auto-opening
 * a browser is likely to fail or be unwanted.
 */
function isHeadlessEnv() {
  if (process.env.CI) return true;
  if (!process.stderr.isTTY) return true;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }
  return false;
}

/**
 * Serve `dir` over HTTP on a random free port, optionally open `index.html`
 * in the browser, and install a SIGINT handler that cleanly closes the
 * server before exiting. Returns the server instance so callers can close it.
 */
export function serveResults(dir) {
  // NOSONAR — local-only server for viewing race results; binds to 127.0.0.1
  // with path traversal protection in createStaticHandler
  const server = http.createServer(createStaticHandler(dir));

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const url = `http://localhost:${port}/`;
    console.error(`  ${c.dim}🌐 Serving at ${c.reset}${c.cyan}${c.bold}${url}${c.reset}`);
    console.error(`  ${c.dim}Press Ctrl+C to stop the server.${c.reset}`);

    if (!isHeadlessEnv()) {
      const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
      const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true });
      child.on('error', () => {}); // ignore ENOENT on headless/CI environments
      child.unref();
    }
  });

  const shutdown = () => {
    process.stderr.write(c.showCursor);
    server.close(() => process.exit(0));
    // Fallback if server.close hangs on keep-alive connections
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
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

// Reject unknown flags early — typos in CLI invocations have silently degraded benchmarks.
const unknownFlags = findUnknownFlags(boolFlags, kvFlags);
if (unknownFlags.length > 0) {
  const labels = unknownFlags.map(n => `--${n}`).join(', ');
  console.error(`${c.red}Error: Unknown flag(s): ${labels}${c.reset}`);
  console.error(`${c.dim}  Run with no arguments to see the list of supported flags.${c.reset}`);
  process.exit(2);
}

const verbose = boolFlags.has('verbose');

// --- --init: scaffold a starter race directory ---

if (boolFlags.has('init')) {
  const dirName = positional[0] || 'my-race';
  const targetDir = path.resolve(dirName);

  if (fs.existsSync(targetDir)) {
    console.error(`${c.red}Error: Directory already exists: ${targetDir}${c.reset}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const defaultRacerA = `// Racer A — edit this script to test your first URL
// Available race helpers injected into page:
//   await page.raceRecordingStart()   — start video segment (optional)
//   await page.raceStart('name')      — start a measurement
//   page.raceEnd('name')              — end a measurement (sync)
//   page.raceMessage('text')          — send a message to the CLI
//   await page.raceRecordingEnd()     — end video segment (optional)
//   race.name                         — this racer's name (from filename)
//   race.vars                         — per-racer vars from settings.json

await page.goto('https://example.com');
await page.raceRecordingStart();
await page.raceStart('Load');
await page.waitForLoadState('networkidle');
page.raceEnd('Load');
await page.raceRecordingEnd();
`;

  const defaultRacerB = `// Racer B — edit this script to test your second URL
// Available race helpers injected into page:
//   await page.raceRecordingStart()   — start video segment (optional)
//   await page.raceStart('name')      — start a measurement
//   page.raceEnd('name')              — end a measurement (sync)
//   page.raceMessage('text')          — send a message to the CLI
//   await page.raceRecordingEnd()     — end video segment (optional)
//   race.name                         — this racer's name (from filename)
//   race.vars                         — per-racer vars from settings.json

await page.goto('https://example.org');
await page.raceRecordingStart();
await page.raceStart('Load');
await page.waitForLoadState('networkidle');
page.raceEnd('Load');
await page.raceRecordingEnd();
`;

  // --gemini-spec="<prompt>": use Gemini + Playwright HTML research to generate specs
  if (kvFlags['gemini-spec'] !== undefined) {
    const userPrompt = kvFlags['gemini-spec'];
    console.error(`\n  ${c.bold}${c.cyan}🤖 Generating race specs with Gemini…${c.reset}`);
    console.error(`  ${c.dim}Prompt: ${userPrompt}${c.reset}\n`);

    try {
      const specFiles = await runGeminiSpec(userPrompt);
      const written = [];
      for (const [filename, content] of Object.entries(specFiles)) {
        fs.writeFileSync(path.join(targetDir, filename), content + '\n');
        written.push(filename);
      }

      const expectedSpecs = [
        { file: 'racer-a.spec.js', default: defaultRacerA },
        { file: 'racer-b.spec.js', default: defaultRacerB },
      ];
      for (const { file, default: fallback } of expectedSpecs) {
        if (!specFiles[file]) {
          fs.writeFileSync(path.join(targetDir, file), fallback);
          written.push(`${file} (default — Gemini did not generate this file)`);
        }
      }

      const settings = JSON.stringify({ parallel: false, headless: false, runs: 3 }, null, 2) + '\n';
      fs.writeFileSync(path.join(targetDir, 'settings.json'), settings);

      console.error(`
${c.green}${c.bold}✓ Race scaffolded with Gemini:${c.reset} ${c.cyan}${path.relative(process.cwd(), targetDir)}/${c.reset}

  ${written.map(f => `${c.dim}${f}${c.reset}`).join('\n  ')}
  ${c.dim}settings.json${c.reset}

${c.bold}Run it:${c.reset}
  ${c.cyan}npx race-for-the-prize ${path.relative(process.cwd(), targetDir)}${c.reset}
`);
    } catch (e) {
      console.error(`${c.red}Gemini spec generation failed: ${e.message}${c.reset}`);
      console.error(`${c.dim}Falling back to default scaffold…${c.reset}`);
      // Write default scaffold files and exit
      fs.writeFileSync(path.join(targetDir, 'racer-a.spec.js'), defaultRacerA);
      fs.writeFileSync(path.join(targetDir, 'racer-b.spec.js'), defaultRacerB);
      fs.writeFileSync(path.join(targetDir, 'settings.json'), JSON.stringify({ parallel: false, headless: false, runs: 3 }, null, 2) + '\n');
    }

    process.exit(0);
  }

  const settings = JSON.stringify({ parallel: false, headless: false, runs: 3 }, null, 2) + '\n';

  fs.writeFileSync(path.join(targetDir, 'racer-a.spec.js'), defaultRacerA);
  fs.writeFileSync(path.join(targetDir, 'racer-b.spec.js'), defaultRacerB);
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

  const { racerFiles, racerNames, totalFound, dropped } = discoverRacers(raceDir);
  if (racerFiles.length < 2) {
    console.error(`${c.red}Error: Need at least 2 .spec.js (or .js) script files in ${raceDir}, found ${racerFiles.length}${c.reset}`);
    process.exit(1);
  }
  if (totalFound > 5) {
    console.error(`${c.yellow}Warning: Found ${totalFound} script files, using first five: ${racerFiles.join(', ')}${c.reset}`);
    console.error(`${c.dim}  Skipped: ${dropped.join(', ')}${c.reset}`);
  }

  let settings = {};
  const settingsPath = path.join(raceDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (e) {
      console.error(`${c.red}Error: Could not parse settings.json: ${e.message}${c.reset}`);
      console.error(`${c.dim}  File: ${settingsPath}${c.reset}`);
      process.exit(1);
    }
  }
  try {
    settings = applyDefaults(applyOverrides(settings, boolFlags, kvFlags));
  } catch (e) {
    if (e instanceof InvalidSettingError) {
      console.error(`${c.red}Error: ${e.message}${c.reset}`);
      process.exit(2);
    }
    throw e;
  }

  // Compute effective racer files (may be overridden by settings.racers[name].script).
  // Security: restrict to a basename within raceDir; no separators, no parent traversal.
  const effectiveRacerFiles = racerFiles.map((f, i) => {
    const name = racerNames[i];
    const racerScript = settings.racers?.[name]?.script;
    if (!racerScript) return f;
    if (typeof racerScript !== 'string' || racerScript.trim() === '') {
      console.error(`${c.red}Error: settings.racers.${name}.script must be a non-empty string${c.reset}`);
      process.exit(1);
    }
    const basename = path.basename(racerScript);
    if (basename !== racerScript || racerScript.includes('..') || path.isAbsolute(racerScript)) {
      console.error(`${c.red}Error: settings.racers.${name}.script must be a filename (no path separators): ${racerScript}${c.reset}`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(raceDir, racerScript))) {
      console.error(`${c.red}Error: settings.racers.${name}.script not found: ${racerScript}${c.reset}`);
      process.exit(1);
    }
    return racerScript;
  });

  const scripts = effectiveRacerFiles.map(f =>
    fs.readFileSync(path.join(raceDir, f), 'utf-8')
  );

  const ctx = buildRaceContext({ racerNames, scripts, settings, rootDir: __dirname, raceDir, racerFiles: effectiveRacerFiles });
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
       ${c.dim}settings.json${c.reset}        ${c.dim}# Optional: { parallel, network, cpuThrottle, setup, teardown }${c.reset}
       ${c.dim}setup.sh${c.reset}             ${c.dim}# Optional: global setup before race${c.reset}
       ${c.dim}teardown.sh${c.reset}          ${c.dim}# Optional: global teardown after race${c.reset}
       ${c.dim}contender-a.setup.sh${c.reset} ${c.dim}# Optional: per-racer setup (runs before this racer)${c.reset}
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
     race.name                              ${c.dim}// this racer's name${c.reset}
     race.vars                              ${c.dim}// per-racer vars from settings.json${c.reset}

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
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--headed${c.reset}            Show browsers (overrides ${c.dim}settings.json${c.reset} ${c.dim}headless${c.reset})
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--network${c.reset}=${c.green}slow-3g${c.reset}   Network: none, slow-3g, fast-3g, 4g
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--cpu${c.reset}=${c.green}4${c.reset}              CPU throttle multiplier (1=none)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--format${c.reset}=${c.green}mov${c.reset}          Output format: webm (default), mov, gif
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--runs${c.reset}=${c.green}3${c.reset}            Run multiple times, report median
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--pause${c.reset}              Pause between runs (press Enter to continue)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--slowmo${c.reset}=${c.green}2${c.reset}           Slow-motion side-by-side replay (2x, 3x, etc.)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-overlay${c.reset}         Record videos without overlays
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-recording${c.reset}      Skip video recording, just measure
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--ffmpeg${c.reset}             Enable FFmpeg processing (trim, merge, convert)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--har${c.reset}                Record network HAR files alongside videos
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-wasm${c.reset}            Skip copying ffmpeg.wasm files (~25 MB) to results
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--height${c.reset}=${c.green}900${c.reset}          Viewport/recording height in pixels (480–4320, default 720)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--ignore-https-errors${c.reset}  Accept invalid/self-signed TLS certificates
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--no-serve${c.reset}           Don't start local results server (CI/headless; open index.html manually)
  node race.js ${c.cyan}<dir>${c.reset} ${c.yellow}--gemini${c.reset}             Gemini CLI sports reporter commentary after race
  node race.js ${c.yellow}--init${c.reset} ${c.cyan}[dir]${c.reset} ${c.yellow}--gemini-spec${c.reset}=${c.green}"prompt"${c.reset}  Generate specs via Gemini + Playwright HTML research

${c.dim}  All flags except --results work with both URL mode and directory mode.${c.reset}
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

// Catch mixed URL/path inputs (e.g. "node race.js https://a.com ./dir")
if (!urlMode && positional.length >= 2 && positional.some(p => isUrl(p))) {
  const nonUrls = positional.filter(p => !isUrl(p));
  console.error(`${c.red}Error: Cannot mix URLs and directory paths. These are not valid URLs: ${nonUrls.join(', ')}${c.reset}`);
  console.error(`${c.dim}  For URL mode, pass only URLs: node race.js https://a.com https://b.com${c.reset}`);
  console.error(`${c.dim}  For directory mode, pass a race directory: node race.js ./races/my-race${c.reset}`);
  process.exit(1);
}

let raceDir;
let ctx, settings, racerNames;

if (urlMode) {
  if (boolFlags.has('results')) {
    console.error(`${c.red}Error: --results is not supported in URL mode${c.reset}`);
    process.exit(1);
  }

  // URL mode: generate race scripts from URLs
  if (positional.length > 5) {
    console.error(`${c.yellow}Warning: Using first 5 URLs of ${positional.length} provided${c.reset}`);
  }
  const urls = positional.slice(0, 5);

  // Derive names and deduplicate: first occurrence keeps its base name,
  // subsequent duplicates get -2, -3, etc. Uses Object.create(null) to
  // avoid inherited property collisions (e.g. "constructor", "toString").
  const rawNames = urls.map(u => deriveRacerName(u));
  const counts = Object.create(null);
  for (const n of rawNames) counts[n] = (counts[n] || 0) + 1;
  const used = Object.create(null);
  const names = rawNames.map(n => {
    if (counts[n] === 1) return n;
    used[n] = (used[n] || 0) + 1;
    return used[n] === 1 ? n : `${n}-${used[n]}`;
  });
  // Verify no duplicates remain (defensive — covers edge cases in deriveRacerName)
  const seen = new Set();
  for (let i = 0; i < names.length; i++) {
    while (seen.has(names[i])) names[i] = names[i] + '-' + (i + 1);
    seen.add(names[i]);
  }

  // SECURITY: URLs are validated by isUrl() (requires http(s) + valid hostname).
  // buildDefaultRaceScript embeds them via JSON.stringify (safe escaping).
  // Scripts execute in the same trust context as user .spec.js files.
  const scripts = urls.map(u => buildDefaultRaceScript(u)); // NOSONAR — intentional code generation from validated URLs
  // Create race directory under races/ to keep cwd clean.
  // Results persist here so the user can re-serve them later.
  // Names are sanitized by deriveRacerName (filesystem-safe, no traversal).
  raceDir = path.resolve('races', names.join('-vs-'));
  fs.mkdirSync(raceDir, { recursive: true }); // NOSONAR — directory from sanitized racer names

  try {
    settings = applyDefaults(applyOverrides({}, boolFlags, kvFlags));
  } catch (e) {
    if (e instanceof InvalidSettingError) {
      console.error(`${c.red}Error: ${e.message}${c.reset}`);
      process.exit(2);
    }
    throw e;
  }
  racerNames = names;
  ctx = buildRaceContext({ racerNames, scripts, settings, rootDir: __dirname, raceDir });
} else {
  if (positional.length > 1) {
    console.error(`${c.yellow}Warning: Directory mode expects 1 argument (the race directory), ignoring extra arguments: ${positional.slice(1).join(', ')}${c.reset}`);
  }
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


// --- Setup/Teardown discovery ---
// URL mode uses a generated race dir with no user scripts; skip discovery to
// avoid picking up stale files from a previously generated dir with the same name.

const { setup: setupScript, teardown: teardownScript } = urlMode
  ? { setup: null, teardown: null }
  : discoverSetupTeardown(raceDir, settings);

// Per-racer setup/teardown (e.g., lauda.setup.sh, hunt.teardown.js)
const racerScripts = racerNames.map(name => ({
  name,
  ...(urlMode ? { setup: null, teardown: null } : discoverRacerSetupTeardown(raceDir, name, settings)),
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
  const { command, timeout = 300000, waitFor } = config;

  // Validate command is a non-empty string
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error(`${label} script config missing valid 'command' field`);
  }

  // Validate timeout bounds
  if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) {
    throw new Error(`${label} timeout must be a positive number`);
  }

  const scriptPath = path.resolve(raceDir, command);
  const ext = path.extname(scriptPath);

  // Security: ensure resolved path stays within the race directory
  const normalizedScript = path.normalize(scriptPath);
  const normalizedRaceDir = path.normalize(raceDir);
  if (!normalizedScript.startsWith(normalizedRaceDir + path.sep) && normalizedScript !== normalizedRaceDir) {
    throw new Error(`${label} script path must be within race directory: ${command}`);
  }

  // Validate script exists and is a regular file (not a directory or symlink)
  let stat;
  try {
    stat = fs.lstatSync(scriptPath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(`${c.yellow}Warning: ${label} script not found: ${scriptPath}${c.reset}`);
      return;
    }
    throw e;
  }

  // lstatSync returns stats for the link itself; isFile() is false for symlinks and directories
  if (!stat.isFile()) {
    throw new Error(`${label} script path is not a regular file: ${scriptPath}`);
  }

  if (ext !== '.sh' && ext !== '.js') {
    throw new Error(`${label} script has unsupported extension '${ext}' (expected .sh or .js)`);
  }

  // On Windows, warn if trying to run .sh without bash available
  if (ext === '.sh' && process.platform === 'win32') {
    try {
      execSync('bash --version', { stdio: 'ignore' }); // NOSONAR — bash resolved via PATH is intentional
    } catch {
      throw new Error(
        `${label} script '${command}' requires bash, which was not found. ` +
        `Install Git Bash or WSL, or use a .js script instead.`
      );
    }
  }

  const progress = startProgress(`Running ${label.toLowerCase()}…`);

  return new Promise((resolve, reject) => {
    const isShell = ext === '.sh';
    const args = [scriptPath];
    const cmd = isShell ? 'bash' : 'node';

    const child = spawn(cmd, args, {
      cwd: raceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RACE_DIR: raceDir },
    });

    let stderr = '';
    let timedOut = false;
    let settled = false;
    let sigkillTimeoutId = null;

    child.stdout.on('data', d => { if (verbose) process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; if (verbose) process.stderr.write(d); });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Give process 5s to clean up after SIGTERM, then SIGKILL
      sigkillTimeoutId = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5000);
    }, timeout);

    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      if (sigkillTimeoutId) clearTimeout(sigkillTimeoutId);
      if (settled) return;
      settled = true;

      if (timedOut) {
        progress.done(`${label} timed out after ${timeout}ms`);
        reject(new Error(`${label} script timed out after ${timeout}ms`));
        return;
      }

      // Handle process killed by signal (code is null)
      if (code === null && signal) {
        progress.done(`${label} killed by ${signal}`);
        if (stderr) console.error(`${c.dim}${stderr}${c.reset}`);
        reject(new Error(`${label} script was killed by ${signal}`));
        return;
      }

      if (code === 0) {
        progress.done(`${label} completed`);

        // If waitFor is specified, poll for the condition
        if (waitFor) {
          if (typeof waitFor !== 'object' || Array.isArray(waitFor)) {
            reject(new Error(`${label} waitFor must be an object with a 'url' field`));
            return;
          }
          if (typeof waitFor.url !== 'string' || !waitFor.url.trim()) {
            reject(new Error(`${label} waitFor.url must be a non-empty string`));
            return;
          }
          if (waitFor.timeout !== undefined && (!Number.isFinite(waitFor.timeout) || waitFor.timeout <= 0)) {
            reject(new Error(`${label} waitFor.timeout must be a positive number`));
            return;
          }
          if (waitFor.interval !== undefined && (!Number.isFinite(waitFor.interval) || waitFor.interval <= 0)) {
            reject(new Error(`${label} waitFor.interval must be a positive number`));
            return;
          }
          const { url, timeout: waitTimeout = 30000, interval = 1000 } = waitFor;
          if (url) {
            const waitProgress = startProgress(`Waiting for ${url}…`);
            const startTime = Date.now();
            let waitSettled = false;

            const poll = async () => {
              if (waitSettled) return;
              const remaining = waitTimeout - (Date.now() - startTime);
              if (remaining <= 0) {
                if (waitSettled) return;
                waitSettled = true;
                waitProgress.done(`Timeout waiting for ${url}`);
                reject(new Error(`Timeout waiting for ${url} after ${waitTimeout}ms`));
                return;
              }

              try {
                const res = await fetch(url, {
                  signal: AbortSignal.timeout(Math.min(remaining, interval * 2)),
                });
                if (res.ok) {
                  if (waitSettled) return;
                  waitSettled = true;
                  waitProgress.done(`Service ready at ${url}`);
                  resolve();
                  return;
                }
              } catch {
                // Connection failed or timed out, will retry
              }

              if (!waitSettled) setTimeout(poll, interval);
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
      if (sigkillTimeoutId) clearTimeout(sigkillTimeoutId);
      if (settled) return;
      settled = true;
      progress.done(`${label} error: ${err.message}`);
      reject(err);
    });
  });
}
const totalRuns = settings.runs;
// Include a short random nonce so rapid successive runs (timestamp collisions,
// e.g. same second) don't overwrite each other's output.
const resultsDir = path.join(raceDir, `results-${formatTimestamp(new Date())}-${crypto.randomBytes(3).toString('hex')}`);

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
 * Generate Gemini sports reporter commentary for a summary, if --gemini is enabled.
 * Returns the commentary string or null. Adds it to the summary object and writes
 * a separate text file alongside the summary.
 */
function isGeminiAvailable() {
  try {
    const result = spawnSync('gemini', ['--version'], { encoding: 'utf-8', timeout: 5000 }); // NOSONAR — gemini CLI resolved via PATH is intentional
    return !result.error && result.status === 0;
  } catch { return false; }
}

function generateGeminiCommentary(summary, outputDir) {
  if (!settings.gemini) return null;
  if (!isGeminiAvailable()) {
    console.error(`  ${c.yellow}⚠ Gemini CLI not found — install with: npm install -g @google/gemini-cli${c.reset}`);
    return null;
  }
  try {
    console.error(`\n  ${c.bold}${c.cyan}🤖 Gemini Race Commentary${c.reset}`);
    console.error(`  ${c.dim}${'─'.repeat(50)}${c.reset}\n`);
    const commentary = runGeminiSummary(summary);
    console.error(commentary);
    console.error(`\n  ${c.dim}${'─'.repeat(50)}${c.reset}\n`);
    summary.geminiCommentary = commentary;
    fs.writeFileSync(path.join(outputDir, 'gemini-commentary.txt'), commentary + '\n');
    return commentary;
  } catch (e) {
    console.error(`  ${c.yellow}⚠ Gemini summary skipped: ${e.message}${c.reset}`);
    return null;
  }
}

/** Inject gemini commentary into the notes textarea of an existing index.html. */
function bakeNotesIntoHtml(dir, commentary) {
  if (!commentary) return;
  const htmlPath = path.join(dir, 'index.html');
  if (!fs.existsSync(htmlPath)) return;
  let html = fs.readFileSync(htmlPath, 'utf-8');
  const escaped = commentary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Replace the empty textarea with commentary content and open the notes section.
  // Target the notes section specifically via the textarea id.
  const placeholder = 'id="notesTextarea" placeholder="Add notes about this race..."></textarea>';
  const replacement = `id="notesTextarea" placeholder="Add notes about this race...">\n🤖 Gemini Race Commentary\n${'─'.repeat(40)}\n${escaped}\n</textarea>`;
  html = html.replace(placeholder, replacement);
  // Uncollapse the notes section — match specifically the Notes section's <details>
  // by anchoring on its unique <summary><h2>Notes</h2></summary> heading.
  // This prevents accidentally opening a different section even if notesTextarea
  // appears later in the document.
  html = html.replace(
    /(<details class="section" )(?=(?:(?!<\/details>)[\s\S])*?<summary><h2>Notes<\/h2><\/summary>(?:(?!<\/details>)[\s\S])*?id="notesTextarea")/,
    '$1open'
  );
  fs.writeFileSync(htmlPath, html);
}

/** Update run nav in each run's index.html with winner colors now that all summaries are available. */
function updateRunNavColors(summaries) {
  for (let i = 0; i < summaries.length; i++) {
    const htmlPath = path.join(resultsDir, String(i + 1), 'index.html');
    if (!fs.existsSync(htmlPath)) continue;
    let html = fs.readFileSync(htmlPath, 'utf-8');
    const oldNavMatch = html.match(/<div class="run-nav">[\s\S]*?<\/div>/);
    if (!oldNavMatch) continue;
    const runNav = { currentRun: i + 1, totalRuns: summaries.length, pathPrefix: '../' };
    const newNav = buildRunNavHtml(runNav, racerNames, summaries);
    html = html.replace(oldNavMatch[0], newNav);
    fs.writeFileSync(htmlPath, html);
  }
}

/**
 * Build the per-run output (summary.json + index.html) after all racers' recordings
 * for run `i` are already moved into their run directories.
 */
function buildRunOutput(runDir, runRawResults, runMovedResults, runNav, raceOpts = {}) {
  const { ffmpeg } = settings;
  const isFinalOutput = !runNav || runNav.totalRuns === 1;

  const progress = startProgress('Processing recordings…');
  const summary = buildSummary(racerNames, runMovedResults, settings, runDir);
  if (isFinalOutput) generateGeminiCommentary(summary, runDir);
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  const { raceScriptFiles, settingsFileCopied } = copyRaceAssets(ctx.raceDir, ctx.racerFiles, runDir);

  progress.done('Recordings processed');

  const clipTimes = buildClipTimes(racerNames, (ri) => runRawResults[ri].browsers?.[0], ffmpeg);

  const videoFiles = racerNames.map(name => `${name}/${name}.race${FORMAT_EXTENSIONS.webm}`);
  const traceFiles = racerNames.map(name => `${name}/${name}.trace.json`);

  writePlayerAndAssets({
    runDir, summary, settings, videoFiles,
    playerExtras: {
      traceFiles, raceScriptFiles, settingsFileCopied,
      runNavigation: runNav, clipTimes,
    },
    raceOptions: raceOpts,
  });

  return { summary, clipTimes };
}

async function main() {
  let setupCompleted = false;

  try {
    // Run global setup script before races
    await runScript(setupScript, 'Setup');

    const hasRacerSetups = racerScripts.some(r => r.setup);

    setupCompleted = true;
    if (!settings.pauseBetweenRuns && !hasRacerSetups) {
      // --- Normal mode: both racers run together per run ---
      if (totalRuns === 1) {
        const { summary, sideBySidePath, sideBySideName } = await runSingleRace(ctx, resultsDir);
        printSummary(summary);
        generateGeminiCommentary(summary, resultsDir);
        // Re-write summary.json with gemini commentary included
        fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(summary, null, 2));
        bakeNotesIntoHtml(resultsDir, summary.geminiCommentary);
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

        updateRunNavColors(summaries);
        buildMedianOutput(summaries, sideBySideNames, allClipTimes);
      }
    } else {
      // --- Split mode: all runs of each racer in sequence ---
      // Activated when per-racer setup scripts exist or --pause is set.
      // Pattern: setupA → A₁, A₂, …, Aₙ → setupB → B₁, B₂, …, Bₙ
      fs.mkdirSync(resultsDir, { recursive: true });
      const multiRun = totalRuns > 1;

      // rawResults[racerIdx][runIdx], movedResults[racerIdx][runIdx]
      const rawResults  = racerNames.map(() => Array(totalRuns).fill(null));
      const movedResults = racerNames.map(() => Array(totalRuns).fill(null));

      for (let ri = 0; ri < racerNames.length; ri++) {
        if (ri > 0 && settings.pauseBetweenRuns && !racerScripts[ri].setup) {
          await waitForEnter(`\n  ${c.bold}${c.yellow}⏸  Paused — press Enter to start ${racerNames[ri]}...${c.reset} `);
        }
        // Run per-racer setup right before this racer's runs
        if (racerScripts[ri].setup) {
          await runScript(racerScripts[ri].setup, `Setup [${racerScripts[ri].name}]`);
        }
        for (let i = 0; i < totalRuns; i++) {
          if (i > 0 && settings.pauseBetweenRuns) {
            await waitForEnter(`\n  ${c.bold}${c.yellow}⏸  Paused — press Enter to start ${racerNames[ri]} run ${i + 1}...${c.reset} `);
          }
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
        updateRunNavColors(summaries);
        buildMedianOutput(summaries, summaries.map(() => null), allClipTimes);
      }
    }


    const { relResults, relHtml } = buildResultsPaths(resultsDir);
    console.error(`  ${c.dim}📂 ${relResults}${c.reset}`);

    if (!settings.noRecording) {
      if (!settings.noServe) {
        serveResults(resultsDir);
      } else {
        console.error(`  ${c.cyan}${c.bold}open ${relHtml}${c.reset}`);
      }
    }
  } catch (e) {
    const phase = setupCompleted ? 'Race' : 'Setup';
    console.error(`\n${c.red}${c.bold}${phase} failed:${c.reset} ${e.message}\n`);
    if (!process.exitCode) process.exitCode = 1;
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

function buildMedianOutput(summaries, sideBySideNames, allClipTimes) {
  const medianSummary = buildMedianSummary(summaries, resultsDir);
  generateGeminiCommentary(medianSummary, resultsDir);
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
      runSummaries: summaries,
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
if (settings.noServe || settings.noRecording) process.exit(process.exitCode || 0);

} // end isMainModule
