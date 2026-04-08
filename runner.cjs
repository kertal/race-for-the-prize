/**
 * runner.cjs — Playwright browser automation engine for RaceForThePrize.
 *
 * Launched as a child process by race.js. Receives a JSON config via argv,
 * runs two Playwright-driven browsers (parallel or sequential), records video,
 * collects measurements and click events, and outputs a JSON result on stdout.
 *
 * CommonJS because Playwright requires it; the rest of the project is ESM.
 */

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Error: Playwright is not installed. Run "npm install" to install dependencies.');
  process.exit(1);
}
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { waitForStability } = require('./visual-stability.cjs');
const { deriveTraceTiming } = require('./trace-calibration.cjs');
const { flashCue, OverlayController } = require('./overlay.cjs');

// Track active browsers/contexts for cleanup on SIGTERM/SIGINT
let activeBrowsers = [];
let activeContexts = [];

// --- Named constants (previously magic numbers) ---

const OLD_VIDEO_CLEANUP_MS = 5000;      // Age threshold for deleting stale recordings
// MEDAL_DISPLAY_MS moved to overlay.cjs
const POST_RACE_WAIT_MS = 500;          // Pause after race finishes for final video frames
const SLOWMO_MULTIPLIER = 20;           // Playwright slowMo factor per slowmo unit
const PAGE_TIMEOUT_MS = 90000;          // Default page action/navigation timeout
const FFMPEG_TIMEOUT_MS = 120000;       // Timeout for ffmpeg operations

// --- Constants (loaded from shared ESM module) ---

// These will be populated by loadConstants() before main() runs
let SCREEN, WINDOW_HEIGHT;

async function loadConstants() {
  const { SCREEN: s, VIDEO_DEFAULTS: v } = await import('./cli/colors.js');
  SCREEN = s;
  WINDOW_HEIGHT = v.windowHeight;
}

// --- Video helpers ---

/** Return the most recently modified .webm filename in a directory, or null. */
function getMostRecentVideo(dir) {
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.webm'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].name : null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract recording segments from a full video and concatenate them.
 * Uses pre-computed PTS segments for frame-accurate cutting.
 * Keeps the original as a `_full` copy. Requires ffmpeg.
 */
function extractSegments(videoPath, segments, browserId) {
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  const fullPath = path.join(dir, `${base}_full${ext}`);

  fs.copyFileSync(videoPath, fullPath);

  if (!segments || segments.length === 0) {
    return { trimmedPath: videoPath, fullPath };
  }

  try {
    if (segments.length === 1) {
      const seg = segments[0];
      const trimmedPath = path.join(dir, `${base}_trimmed${ext}`);
      execFileSync('ffmpeg', [
        '-y', '-i', videoPath,
        '-ss', seg.start.toFixed(3), '-t', (seg.end - seg.start).toFixed(3),
        '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
        trimmedPath
      ], { timeout: FFMPEG_TIMEOUT_MS, stdio: 'pipe' });
      fs.unlinkSync(videoPath);
      fs.renameSync(trimmedPath, videoPath);
      return { trimmedPath: videoPath, fullPath };
    }

    // Multiple segments: extract each then concatenate
    const segmentFiles = [];
    const concatListPath = path.join(dir, `${base}_concat.txt`);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segPath = path.join(dir, `${base}_seg${i}${ext}`);
      segmentFiles.push(segPath);
      execFileSync('ffmpeg', [
        '-y', '-i', videoPath,
        '-ss', seg.start.toFixed(3), '-t', (seg.end - seg.start).toFixed(3),
        '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
        segPath
      ], { timeout: FFMPEG_TIMEOUT_MS, stdio: 'pipe' });
    }

    fs.writeFileSync(concatListPath, segmentFiles.map(f => `file '${f}'`).join('\n'));
    const outputPath = path.join(dir, `${base}_final${ext}`);
    execFileSync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', concatListPath, '-c', 'copy', outputPath
    ], { timeout: FFMPEG_TIMEOUT_MS, stdio: 'pipe' });

    for (const f of segmentFiles) { try { fs.unlinkSync(f); } catch (e) { console.error(`[extractSegments] Cleanup warning: ${e.message}`); } }
    try { fs.unlinkSync(concatListPath); } catch (e) { console.error(`[extractSegments] Cleanup warning: ${e.message}`); }
    fs.unlinkSync(videoPath);
    fs.renameSync(outputPath, videoPath);

    return { trimmedPath: videoPath, fullPath };
  } catch (error) {
    console.error(`[${browserId}] Failed to extract segments (ffmpeg may not be installed): ${error.message}`);
    try {
      for (const file of fs.readdirSync(dir)) {
        if (['_seg', '_concat', '_final', '_trimmed'].some(p => file.includes(p))) {
          try { fs.unlinkSync(path.join(dir, file)); } catch {}
        }
      }
    } catch {}
    return { trimmedPath: videoPath, fullPath };
  }
}

/** Delete .webm files older than 5 seconds in a directory. */
function cleanupOldVideos(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.webm'))) {
      const filepath = path.join(dir, file);
      if (now - fs.statSync(filepath).mtime.getTime() > OLD_VIDEO_CLEANUP_MS) {
        fs.unlinkSync(filepath);
      }
    }
  } catch (e) {
    console.error(`[cleanupOldVideos] Warning: ${e.message}`);
  }
}

// --- Signal handling ---

async function cleanup() {
  for (const ctx of activeContexts) { try { await ctx.close(); } catch {} }
  for (const browser of activeBrowsers) { try { await browser.close(); } catch {} }
  await new Promise(r => setTimeout(r, 100));

  console.log(JSON.stringify({ browsers: [] }));
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// --- Sync barrier for parallel mode ---

const { SyncBarrier } = require('./sync-barrier.cjs');

// --- Performance metrics collection via CDP ---

/**
 * Set up CDP session for capturing network and performance metrics.
 * Tracks network transfer sizes, request counts, and prepares for Performance API collection.
 * Supports both total session metrics and measurement-scoped metrics (between raceStart/raceEnd).
 * @param {Page} page - Playwright page
 * @param {string} id - Browser identifier for logging
 * @returns {Object} Metrics collector with methods to snapshot and collect
 */
async function setupMetricsCollection(page, id) {
  // Running totals for network (accumulated via events)
  const networkTotals = {
    transferSize: 0,
    requestCount: 0
  };

  // Snapshot taken at raceStart for computing deltas
  let startSnapshot = null;

  // Network activity during measurement period
  let measuredNetwork = { transferSize: 0, requestCount: 0 };
  let isMeasuring = false;

  let client = null;

  try {
    client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Performance.enable');

    // Track network transfer sizes
    client.on('Network.loadingFinished', (params) => {
      const size = params.encodedDataLength || 0;
      networkTotals.transferSize += size;
      networkTotals.requestCount++;
      // Also track during measurement period
      if (isMeasuring) {
        measuredNetwork.transferSize += size;
        measuredNetwork.requestCount++;
      }
    });

  } catch (error) {
    console.error(`[${id}] Warning: metrics collection setup failed: ${error.message}`);
  }

  /**
   * Get current CDP performance metrics snapshot.
   */
  async function getCdpMetrics() {
    if (!client) return null;
    try {
      const perfMetrics = await client.send('Performance.getMetrics');
      const metricsMap = {};
      for (const m of perfMetrics.metrics) {
        metricsMap[m.name] = m.value;
      }
      // CDP Performance.getMetrics returns durations in seconds; convert to ms
      return {
        jsHeapUsedSize: metricsMap.JSHeapUsedSize || 0,
        scriptDuration: (metricsMap.ScriptDuration || 0) * 1000,
        layoutDuration: (metricsMap.LayoutDuration || 0) * 1000,
        recalcStyleDuration: (metricsMap.RecalcStyleDuration || 0) * 1000,
        taskDuration: (metricsMap.TaskDuration || 0) * 1000
      };
    } catch {
      return null;
    }
  }

  return {
    /**
     * Take a snapshot at measurement start (raceStart).
     * Call this to begin tracking measurement-scoped metrics.
     */
    async startMeasurement() {
      startSnapshot = await getCdpMetrics();
      measuredNetwork = { transferSize: 0, requestCount: 0 };
      isMeasuring = true;
    },

    /**
     * End measurement period (raceEnd).
     */
    stopMeasurement() {
      isMeasuring = false;
    },

    /**
     * Collect final metrics at the end of the race.
     * Returns both total session metrics and measurement-scoped metrics.
     */
    async collect() {
      const result = {
        total: {
          networkTransferSize: networkTotals.transferSize,
          networkRequestCount: networkTotals.requestCount,
          ttfb: null,
          fcp: null,
          lcp: null,
          cls: null,
          domContentLoaded: null,
          domComplete: null,
          jsHeapUsedSize: null,
          scriptDuration: null,
          layoutDuration: null,
          recalcStyleDuration: null,
          taskDuration: null
        },
        measured: {
          networkTransferSize: measuredNetwork.transferSize,
          networkRequestCount: measuredNetwork.requestCount,
          scriptDuration: null,
          layoutDuration: null,
          recalcStyleDuration: null,
          taskDuration: null
        }
      };

      try {
        // Get navigation timing + web vitals from the page in a single evaluate
        const timing = await page.evaluate(() => {
          const perf = window.performance;
          if (!perf) return null;
          const t = perf.timing || {};
          const nav = perf.getEntriesByType('navigation');
          const paint = perf.getEntriesByType('paint');
          const fcpEntry = paint.find(e => e.name === 'first-contentful-paint');
          const lcpEntries = window.__raceLCPEntries;
          return {
            domContentLoaded: t.domContentLoadedEventEnd && t.navigationStart
              ? t.domContentLoadedEventEnd - t.navigationStart : null,
            domComplete: t.domComplete && t.navigationStart
              ? t.domComplete - t.navigationStart : null,
            ttfb: nav.length > 0 ? nav[0].responseStart : (
              t.responseStart && t.navigationStart ? t.responseStart - t.navigationStart : null
            ),
            fcp: fcpEntry ? fcpEntry.startTime : null,
            lcp: lcpEntries && lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null,
            cls: typeof window.__raceCLSValue === 'number' ? window.__raceCLSValue : null,
          };
        });

        if (timing) {
          result.total.domContentLoaded = timing.domContentLoaded > 0 ? timing.domContentLoaded : null;
          result.total.domComplete = timing.domComplete > 0 ? timing.domComplete : null;
          result.total.ttfb = timing.ttfb > 0 ? timing.ttfb : null;
          result.total.fcp = timing.fcp > 0 ? timing.fcp : null;
          result.total.lcp = timing.lcp > 0 ? timing.lcp : null;
          result.total.cls = timing.cls != null ? timing.cls : null;
        }

        // Get final CDP metrics
        const endMetrics = await getCdpMetrics();
        if (endMetrics) {
          result.total.jsHeapUsedSize = endMetrics.jsHeapUsedSize || null;
          result.total.scriptDuration = endMetrics.scriptDuration || null;
          result.total.layoutDuration = endMetrics.layoutDuration || null;
          result.total.recalcStyleDuration = endMetrics.recalcStyleDuration || null;
          result.total.taskDuration = endMetrics.taskDuration || null;

          // Compute deltas for measurement period
          if (startSnapshot) {
            const computeDelta = (metric) => {
              const delta = endMetrics[metric] - startSnapshot[metric];
              if (delta < 0) console.warn(`[${id}] Negative delta for "${metric}" (${startSnapshot[metric]} → ${endMetrics[metric]}), clamping to 0`);
              return Math.max(0, delta);
            };
            result.measured.scriptDuration = computeDelta('scriptDuration');
            result.measured.layoutDuration = computeDelta('layoutDuration');
            result.measured.recalcStyleDuration = computeDelta('recalcStyleDuration');
            result.measured.taskDuration = computeDelta('taskDuration');
          }
        }
      } catch (error) {
        console.error(`[${id}] Warning: failed to collect metrics: ${error.message}`);
      }

      return result;
    },

    /**
     * Detach the CDP session.
     */
    async detach() {
      try {
        if (client) await client.detach();
      } catch {}
    }
  };
}

// --- Script execution ---

/** Fix smart quotes, non-breaking spaces, and line endings in user scripts. */
function sanitizeScript(script) {
  return script
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

// --- Race API (marker mode) ---

/**
 * Runs a user's race script with the page.race* API attached:
 *
 *   await page.raceStart(name)        — start a named stopwatch (async: syncs in parallel)
 *   page.raceEnd(name)                — stop the stopwatch (sync: just arithmetic)
 *   await page.raceRecordingStart()   — manually start a video segment (async: syncs)
 *   await page.raceRecordingEnd()     — manually end a video segment (async: flushes)
 *   page.raceMessage(text)            — send a message to the CLI terminal (sync)
 *   await page.raceWaitForVisualStability(opts?) — wait for rendering to settle (async)
 *
 * raceStart/raceEnd are async/sync respectively because starting requires
 * synchronizing both browsers at the starting line (via SyncBarrier), while
 * ending just records a timestamp — each racer stops their own clock independently.
 *
 * If no explicit raceRecordingStart/End calls are made, recording automatically
 * wraps from the first raceStart to the last raceEnd.
 *
 * Returns { segments, measurements } for video trimming and result comparison.
 */
async function runMarkerMode(page, context, config, barriers, isParallel, sharedState, recordingStartTime, noOverlay = false, metricsCollector = null, noRecording = false) {
  const { id, script: raceScript, vars } = config;

  const segments = [];
  let currentSegmentStart = null;
  const measurements = [];
  const activeMeasurements = {};

  // --- Visual cues for frame-accurate trimming / calibration ---
  const CUE_COLOR_START = '#00FF00';
  const CUE_COLOR_END = '#FF0000';
  const traceMarkPrefix = 'race:';
  const markTrace = async (markName) => {
    try {
      await page.evaluate((name) => {
        if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
          performance.mark(name);
        }
      }, markName);
      return true;
    } catch {
      return false;
    }
  };

  const queueTraceMark = (markName) => {
    page.evaluate((name) => {
      if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(name);
      }
    }, markName).catch(() => {});
  };

  const encodeMeasureName = (name) => encodeURIComponent(String(name ?? 'default'));

  const overlayCtrl = new OverlayController(page, { noOverlay, noRecording });

  const startRecording = async () => {
    if (currentSegmentStart !== null) return;
    if (isParallel && barriers) {
      const result = await barriers.recordingStart.wait(`${id} startRecording`);
      if (result?.aborted) return;
    }
    const startWallMs = Date.now();
    currentSegmentStart = (startWallMs - recordingStartTime) / 1000;
    await markTrace(`${traceMarkPrefix}recording:start`);
    await Promise.all([
      overlayCtrl.onStartRecording(),
      !noRecording ? flashCue(page, CUE_COLOR_START) : null,
    ]);
  };


  let stopPromise = null;
  const stopRecording = async () => {
    if (currentSegmentStart === null) return stopPromise;
    segments.push({ start: currentSegmentStart, end: (Date.now() - recordingStartTime) / 1000 });
    await markTrace(`${traceMarkPrefix}recording:end`);
    currentSegmentStart = null;
    stopPromise = (async () => {
      if (sharedState) {
        const lastMeasurement = measurements[measurements.length - 1];
        const endTime = lastMeasurement ? lastMeasurement.endTime : (Date.now() - recordingStartTime) / 1000;
        sharedState.finishOrder.push({ id, endTime });
        if (!noOverlay && !noRecording) {
          // Calculate placement from finish order for the medal display
          const sorted = [...sharedState.finishOrder].sort((a, b) => a.endTime - b.endTime);
          const place = isParallel ? sorted.findIndex(f => f.id === id) + 1 : null;
          await overlayCtrl.onFinish(place);
        }
      }
      await Promise.all([
        !noRecording ? flashCue(page, CUE_COLOR_END) : null,
        overlayCtrl.onStopRecording(),
      ]);
    })();
    return stopPromise;
  };

  let raceStartTime = null;

  const startMeasure = async (name = 'default') => {
    if (raceStartTime === null) raceStartTime = Date.now();
    activeMeasurements[name] = (Date.now() - recordingStartTime) / 1000;
    await markTrace(`${traceMarkPrefix}measure:start:${encodeMeasureName(name)}`);
    await overlayCtrl.onMeasureStart();
  };

  const endMeasure = (name = 'default') => {
    const start = activeMeasurements[name];
    if (start === undefined) return 0;
    const end = (Date.now() - recordingStartTime) / 1000;
    const duration = end - start;
    measurements.push({ name, startTime: start, endTime: end, duration });
    delete activeMeasurements[name];
    queueTraceMark(`${traceMarkPrefix}measure:end:${encodeMeasureName(name)}`);
    overlayCtrl.onMeasureEnd();
    return end - start;
  };

  let hasExplicitRecording = false;
  let autoRecordingStarted = false;

  page.raceMessage = (text) => {
    if (text == null) {
      text = '';
    } else if (typeof text !== 'string') {
      text = String(text);
    }
    const elapsed = raceStartTime ? ((Date.now() - raceStartTime) / 1000).toFixed(1) : '0.0';
    console.error(`[${id}] __raceMessage__[${elapsed}]:${text}`);
  };
  page.raceRecordingStart = async () => { hasExplicitRecording = true; await startRecording(); };
  page.raceRecordingEnd = async () => { hasExplicitRecording = true; await stopRecording(); };
  page.raceStart = async (name = 'default') => {
    if (!hasExplicitRecording && !autoRecordingStarted) {
      autoRecordingStarted = true;
      await startRecording();
    }
    // Start metrics measurement on first raceStart
    if (metricsCollector && raceStartTime === null) {
      await metricsCollector.startMeasurement();
    }
    await startMeasure(name);
  };
  page.raceEnd = (name = 'default') => {
    const duration = endMeasure(name);
    // Stop metrics measurement when the last measurement ends
    if (metricsCollector && Object.keys(activeMeasurements).length === 0) {
      metricsCollector.stopMeasurement();
    }
    return duration;
  };

  // CDP session for visual stability checks — created lazily, cleaned up after script
  let cdpSession = null;

  page.raceWaitForVisualStability = async (opts = {}) => {
    const callStart = Date.now();
    try {
      if (!cdpSession) {
        cdpSession = await page.context().newCDPSession(page);
        await cdpSession.send('Performance.enable');
      }
      const getCounters = async () => {
        const { metrics } = await cdpSession.send('Performance.getMetrics');
        const byName = {};
        for (const m of metrics) byName[m.name] = m.value;
        return {
          taskDuration: byName.TaskDuration || 0,
          layoutCount: byName.LayoutCount || 0,
          recalcStyleCount: byName.RecalcStyleCount || 0,
        };
      };
      const result = await waitForStability(getCounters, opts);
      if (!result.stable) {
        console.error(`[${id}] raceWaitForVisualStability timed out after ${result.elapsed}ms`);
      }
      return result;
    } catch (err) {
      console.error(`[${id}] raceWaitForVisualStability error: ${err.message}`);
      return { stable: false, elapsed: Date.now() - callStart };
    }
  };

  // Inject PerformanceObservers for LCP and CLS into every new document context.
  // These metrics require observers registered before entries are emitted —
  // getEntriesByType() returns nothing without them.
  await page.addInitScript(() => {
    window.__raceLCPEntries = [];
    const lcpObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__raceLCPEntries.push(entry.startTime);
      }
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });

    window.__raceCLSValue = 0;
    const clsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__raceCLSValue += entry.value;
        }
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
  });

  if (isParallel && barriers) {
    const result = await barriers.ready.wait(`${id} ready`);
    if (result?.aborted) {
      console.error(`[${id}] Ready barrier aborted, continuing...`);
    }
  }

  if (!raceScript || raceScript.trim() === '') return { segments: [], measurements: [] };

  // SECURITY: Race scripts execute with the full privileges of this Node.js
  // process. Only run scripts you trust — this is equivalent to `node <file>`.
  const sanitized = sanitizeScript(raceScript);
  const raceContext = Object.freeze({ name: id, vars: Object.freeze(vars || {}) });
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor; // NOSONAR — intentional: executes user-provided race scripts
    const fn = new AsyncFunction('page', 'race', '__startRecording', '__stopRecording', '__startMeasure', '__endMeasure', sanitized); // NOSONAR
    await fn(page, raceContext, startRecording, stopRecording, startMeasure, endMeasure);
  } catch (error) {
    console.error(`[${id}] Script failed: ${error.message}`);
    throw new Error(`Script execution failed: ${error.message}`);
  } finally {
    // Clean up CDP session used by raceWaitForVisualStability
    if (cdpSession) {
      try { await cdpSession.detach(); } catch {}
      cdpSession = null;
    }
  }

  if (currentSegmentStart !== null) await stopRecording();
  if (stopPromise) await stopPromise;

  if (isParallel && barriers) {
    await barriers.stop.wait(`${id} finished`);
  }

  await page.waitForTimeout(POST_RACE_WAIT_MS);
  return { segments, measurements };
}

// --- Network & CPU throttling ---

const NETWORK_PRESETS = {
  'none': null,
  'slow-3g': { downloadThroughput: 500 * 1024 / 8, uploadThroughput: 500 * 1024 / 8, latency: 400 },
  'fast-3g': { downloadThroughput: 1500 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 150 },
  '4g': { downloadThroughput: 4000 * 1024 / 8, uploadThroughput: 3000 * 1024 / 8, latency: 50 },
};

async function applyThrottling(page, throttle, id) {
  if (!throttle) return;
  try {
    // CDP session intentionally kept alive — detaching removes throttling.
    // Session is cleaned up when the browser context closes.
    const client = await page.context().newCDPSession(page);
    const net = NETWORK_PRESETS[throttle.network];
    if (net) {
      await client.send('Network.enable');
      await client.send('Network.emulateNetworkConditions', { offline: false, ...net });
    }
    if (throttle.cpu > 1) {
      await client.send('Emulation.setCPUThrottlingRate', { rate: throttle.cpu });
    }
  } catch (error) {
    console.error(`[${id}] Warning: throttling failed: ${error.message}`);
  }
}

// --- Window layout calculation for N browsers ---

/**
 * Calculate window position and size for browser at given index.
 * For 2 browsers: side-by-side horizontally
 * For 3 browsers: 3 across
 * For 4 browsers: 2x2 grid
 * For 5 browsers: 3 on top, 2 on bottom
 */
function calculateWindowLayout(index, total) {
  const { width: screenWidth, height: screenHeight } = SCREEN;

  if (total <= 2) {
    // Side by side
    const width = Math.floor(screenWidth / 2);
    return { x: index * width, y: 0, width, height: WINDOW_HEIGHT };
  } else if (total === 3) {
    // 3 across
    const width = Math.floor(screenWidth / 3);
    return { x: index * width, y: 0, width, height: WINDOW_HEIGHT };
  } else if (total === 4) {
    // 2x2 grid
    const width = Math.floor(screenWidth / 2);
    const height = Math.floor(screenHeight / 2);
    const row = Math.floor(index / 2);
    const col = index % 2;
    return { x: col * width, y: row * height, width, height };
  } else {
    // 5 browsers: 3 on top, 2 on bottom (centered)
    const width = Math.floor(screenWidth / 3);
    const height = Math.floor(screenHeight / 2);
    if (index < 3) {
      // Top row: 3 browsers
      return { x: index * width, y: 0, width, height };
    } else {
      // Bottom row: 2 browsers, centered
      const bottomOffset = Math.floor(width / 2);
      return { x: bottomOffset + (index - 3) * width, y: height, width, height };
    }
  }
}

// --- Profiling & trimming helpers ---

async function startProfiling(page, browser, id) {
  const metricsCollector = await setupMetricsCollection(page, id);
  await browser.startTracing(page, { screenshots: true, categories: ['devtools.timeline', 'blink.user_timing'] });
  return metricsCollector;
}

async function collectProfilingResults(browser, metricsCollector, outputDir, id) {
  let profileMetrics = null;
  if (metricsCollector) {
    profileMetrics = await metricsCollector.collect();
    await metricsCollector.detach();
  }
  const traceBuffer = await browser.stopTracing();
  const tracePath = path.join(outputDir, `${id}.trace.json`);
  fs.writeFileSync(tracePath, traceBuffer);
  console.error(`[${id}] Performance trace saved: ${tracePath}`);
  return {
    tracePath,
    profileMetrics,
    traceText: traceBuffer.toString('utf8'),
  };
}

function trimVideoWithFfmpeg(outputDir, trimSegments, id) {
  const videoFile = getMostRecentVideo(outputDir);
  if (!videoFile) return null;
  const videoPath = path.join(outputDir, videoFile);
  const res = extractSegments(videoPath, trimSegments, id);
  return path.basename(res.fullPath);
}

// --- Single browser recording flow ---

/**
 * Launch one browser, run the race script, record video, collect results.
 * Called N times (once per racer) by runParallel or runSequential.
 */
async function runBrowserRecording(config, barriers, isParallel, sharedState, opts = {}) {
  const { browserIndex = 0, totalBrowsers = 2, throttle = null, slowmo = 0, noOverlay = false, noRecording = false, ffmpeg = false, har = false, recordingsDir = null, ignoreHTTPSErrors = false, viewportHeight: configViewportHeight = null } = opts;
  const { id, headless: headlessRaw } = config;
  const headless = headlessRaw === true;
  const outputDir = recordingsDir ? path.join(recordingsDir, id) : path.join(__dirname, 'recordings', id);
  let browser = null;
  let context = null;
  let metricsCollector = null;
  let error = null;

  fs.mkdirSync(outputDir, { recursive: true });
  cleanupOldVideos(outputDir);

  const layout = calculateWindowLayout(browserIndex, totalBrowsers);
  const windowArgs = isParallel
    ? [`--window-position=${layout.x},${layout.y}`, `--window-size=${layout.width},${layout.height}`]
    : [];

  try {
    const launchOpts = { headless, args: windowArgs };
    if (slowmo > 0) launchOpts.slowMo = slowmo * SLOWMO_MULTIPLIER;
    browser = await chromium.launch(launchOpts);
    activeBrowsers.push(browser);

    const viewportWidth = isParallel ? layout.width - 20 : 1280;
    const viewportHeight = configViewportHeight ?? (isParallel ? layout.height - 100 : 720);
    const videoScale = slowmo > 0 ? 2 : 1;
    const contextCreationStart = Date.now();
    const harPath = har ? path.join(outputDir, `${id}.har`) : null;
    const contextOpts = {
      viewport: { width: viewportWidth, height: viewportHeight },
      ignoreHTTPSErrors: ignoreHTTPSErrors || false,
    };
    if (!noRecording) {
      contextOpts.recordVideo = { dir: outputDir, size: { width: viewportWidth * videoScale, height: viewportHeight * videoScale } };
    }
    if (harPath) {
      contextOpts.recordHar = { path: harPath, mode: 'minimal' };
    }
    context = await browser.newContext(contextOpts);
    const recordingStartTime = Date.now();
    const recordingOffset = (recordingStartTime - contextCreationStart) / 1000;
    activeContexts.push(context);

    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

    await applyThrottling(page, throttle, id);

    metricsCollector = await startProfiling(page, browser, id);

    const result = await runMarkerMode(page, context, config, barriers, isParallel, sharedState, recordingStartTime, noOverlay, metricsCollector, noRecording);
    const markerSegments = result?.segments || [];
    const markerMeasurements = result?.measurements || [];

    const { tracePath, profileMetrics, traceText } = await collectProfilingResults(browser, metricsCollector, outputDir, id);
    const traceTiming = deriveTraceTiming(traceText);
    const traceSegments = traceTiming?.recordingSegments || [];
    const recordingSegments = traceSegments.length > 0 ? traceSegments : markerSegments;
    const measurements = traceTiming?.measurements?.length > 0 ? traceTiming.measurements : markerMeasurements;

    await context.close();
    const wallClockDuration = (Date.now() - contextCreationStart) / 1000;
    activeContexts = activeContexts.filter(ctx => ctx !== context);
    context = null;
    console.error(`[${id}] Context closed`);

    await browser.close();
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
    browser = null;

    if (noRecording) {
      return {
        id,
        videoPath: null,
        fullVideoPath: null,
        tracePath: tracePath ? path.join(id, path.basename(tracePath)) : null,
        measurements,
        profileMetrics,
        recordingSegments: null,
        recordingOffset,
        wallClockDuration,
        calibratedStart: null,
        traceCalibration: null,
        error: null
      };
    }

    let fullVideoFile = null;

    if (recordingSegments.length > 0 && ffmpeg) {
      const trimSegments = traceTiming?.ptsSegments?.length > 0
        ? traceTiming.ptsSegments
        : recordingSegments;
      fullVideoFile = trimVideoWithFfmpeg(outputDir, trimSegments, id);
    } else if (recordingSegments.length > 0) {
      console.error(`[${id}] Skipping video trimming (no --ffmpeg)`);
    }

    const videoFile = getMostRecentVideo(outputDir);

    const calibratedStart = ffmpeg ? null : (traceTiming?.calibratedStartPts ?? null);
    const traceCalibration = ffmpeg ? null : (traceTiming?.traceCalibration || null);

    return {
      id,
      videoPath: videoFile ? path.join(id, videoFile) : null,
      fullVideoPath: fullVideoFile ? path.join(id, fullVideoFile) : null,
      tracePath: tracePath ? path.join(id, path.basename(tracePath)) : null,
      harPath: harPath && fs.existsSync(harPath) ? path.join(id, path.basename(harPath)) : null,
      measurements,
      profileMetrics,
      recordingSegments: recordingSegments.length > 0 ? recordingSegments : null,
      recordingOffset,
      wallClockDuration,
      calibratedStart,
      traceCalibration,
      error: null
    };
  } catch (e) {
    error = e;
    console.error(`[${id}] Error: ${e.message}`);
    if (metricsCollector) { try { await metricsCollector.detach(); } catch {} }
    if (sharedState) { sharedState.hasError = true; sharedState.errorMessage = e.message; }
    if (barriers) {
      barriers.ready.releaseAll();
      barriers.recordingStart.releaseAll();
      barriers.stop.releaseAll();
    }
  }

  if (context) { try { await context.close(); } catch {} }
  if (browser) { try { await browser.close(); } catch {} }

  return {
    id,
    videoPath: null,
    fullVideoPath: null,
    tracePath: null,
    harPath: null,
    measurements: [],
    profileMetrics: null,
    recordingSegments: null,
    recordingOffset: 0,
    wallClockDuration: 0,
    calibratedStart: null,
    traceCalibration: null,
    error: error ? error.message : null
  };
}

// --- Execution modes ---

async function runParallel(browserConfigs, opts = {}) {
  const count = browserConfigs.length;
  const sharedState = { hasError: false, errorMessage: null, finishOrder: [] };
  const barriers = {
    ready: new SyncBarrier(count, sharedState),
    recordingStart: new SyncBarrier(count, sharedState),
    stop: new SyncBarrier(count, sharedState)
  };

  const promises = browserConfigs.map((config, i) =>
    runBrowserRecording(config, barriers, true, sharedState, { ...opts, browserIndex: i, totalBrowsers: count })
  );

  const results = await Promise.allSettled(promises);

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { id: browserConfigs[i].id, videoPath: null, error: r.reason?.message || 'Unknown error' };
  });
}

async function runSequential(browserConfigs, opts = {}) {
  const sharedState = { hasError: false, errorMessage: null, finishOrder: [] };
  const results = [];
  for (let i = 0; i < browserConfigs.length; i++) {
    const result = await runBrowserRecording(browserConfigs[i], null, false, sharedState, { ...opts, browserIndex: i, totalBrowsers: browserConfigs.length });
    results.push(result);
  }
  return results;
}

// --- Main entry point ---

async function main() {
  // Load shared constants from ESM module
  await loadConstants();

  const configJson = process.argv[2];
  if (!configJson) { console.error('Error: Config JSON required'); process.exit(1); }

  let config;
  try { config = JSON.parse(configJson); }
  catch (e) { console.error('Error: Invalid JSON:', e.message); process.exit(1); }

  const { browsers, executionMode, throttle, headless: headlessRaw, slowmo, noOverlay, noRecording, ffmpeg, har, recordingsDir, ignoreHTTPSErrors, viewportHeight } = config;
  const headless = headlessRaw === true;
  const runOpts = { throttle, slowmo, noOverlay, noRecording, ffmpeg, har, recordingsDir, ignoreHTTPSErrors, viewportHeight };

  // Set headless flag on all browser configs (strict boolean — strings must not slip through)
  for (const browser of browsers) {
    browser.headless = headless;
  }

  const recBase = recordingsDir || path.join(__dirname, 'recordings');
  fs.mkdirSync(recBase, { recursive: true });

  let results;
  try {
    results = executionMode === 'parallel'
      ? await runParallel(browsers, runOpts)
      : await runSequential(browsers, runOpts);
  } catch (error) {
    results = browsers.map(b => ({ id: b.id, videoPath: null, error: error.message }));
  }

  const errors = results.filter(r => r.error).map(r => `${r.id}: ${r.error}`);

  // Output in new array-based format
  console.log(JSON.stringify({
    browsers: results.map(r => ({
      id: r.id,
      videoPath: r.videoPath || null,
      fullVideoPath: r.fullVideoPath || null,
      tracePath: r.tracePath || null,
      harPath: r.harPath || null,
      measurements: r.measurements || [],
      profileMetrics: r.profileMetrics || null,
      recordingSegments: r.recordingSegments || null,
      recordingOffset: r.recordingOffset || 0,
      wallClockDuration: r.wallClockDuration || 0,
      calibratedStart: r.calibratedStart ?? null,
      traceCalibration: r.traceCalibration || null,
      error: r.error || null
    })),
    errors: errors.length > 0 ? errors : undefined
  }));

  process.exit(errors.length > 0 ? 1 : 0);
}

// Allow unit testing of internal functions when required as a module
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    console.log(JSON.stringify({ browsers: [], errors: [err.message] }));
    process.exit(1);
  });
}

module.exports = {};
