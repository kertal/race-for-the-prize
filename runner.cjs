/**
 * runner.cjs — Playwright browser automation engine for RaceForThePrize.
 *
 * Launched as a child process by race.js. Receives a JSON config (a temp file
 * named by `--config-file`, or inline in argv[2]), runs two to five
 * Playwright-driven browsers (parallel or sequential), records video,
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
const { waitForStability } = require('./visual-stability.cjs');
const { deriveTraceTiming } = require('./trace-calibration.cjs');
const { flashCue, OverlayController } = require('./overlay.cjs');
const { createRaceApi } = require('./race-api.cjs');
const { RESULT_SENTINEL, PROTOCOL_VERSION, isSafeRacerId, confinePath, formatRaceMessage, formatContextClosed } = require('./runner-protocol.cjs');
const { cleanupOldVideos, trimVideoWithFfmpeg } = require('./runner-video.cjs');
const { setupMetricsCollection, startProfiling, collectProfilingResults } = require('./runner-metrics.cjs');
const { applyThrottling } = require('./runner-throttling.cjs');
const { calculateWindowLayout } = require('./runner-layout.cjs');

// Track active browsers/contexts for cleanup on SIGTERM/SIGINT
let activeBrowsers = [];
let activeContexts = [];
let cleanupInProgress = false;

// --- Named constants (previously magic numbers) ---

const POST_RACE_WAIT_MS = 500;          // Pause after race finishes for final video frames
// The screencast runs at ~25fps, so a freshly painted flag needs a beat to land
// in a captured frame. Two frames' worth, spent before the recording-end mark
// the player trims on — otherwise the flag falls outside the clip and is lost.
const FLAG_CAPTURE_MS = 80;
const SLOWMO_MULTIPLIER = 20;           // Playwright slowMo factor per slowmo unit
const PAGE_TIMEOUT_MS = 90000;          // Default page action/navigation timeout
// Barrier deadline sits above the page timeout so Playwright's own errors fire
// first; it exists to catch pure-JS hangs those timeouts can't see, which would
// otherwise deadlock the other racer at a sync point forever.
const BARRIER_TIMEOUT_MS = PAGE_TIMEOUT_MS + 30000;
// Once a checkpoint has failed the race, how long a racer still running gets
// to unwind before the runner reports without it. Only ever spent on a race
// that has already failed (see settleRacers).
const ABANDON_GRACE_MS = 30000;

// --- Constants (loaded from shared ESM module) ---

// These will be populated by loadConstants() before main() runs
let SCREEN, WINDOW_HEIGHT;

async function loadConstants() {
  const { SCREEN: s, VIDEO_DEFAULTS: v } = await import('./cli/media-config.js');
  SCREEN = s;
  WINDOW_HEIGHT = v.windowHeight;
}

// --- Signal handling ---

/** Convert a signal name to its conventional exit code (128 + signum). */
function signalExitCode(signal) {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  if (signal === 'SIGHUP') return 129;
  return 1;
}

// Remember which signal first triggered cleanup so a second signal exits with
// the same conventional code (rather than always 130).
let cleanupSignal = null;

async function cleanup(signal) {
  if (cleanupInProgress) {
    // Second signal — force exit with the code matching the originating signal.
    process.exit(signalExitCode(cleanupSignal || signal));
  }
  cleanupInProgress = true;
  cleanupSignal = signal;
  for (const ctx of activeContexts) { try { await ctx.close(); } catch {} }
  for (const browser of activeBrowsers) { try { await browser.close(); } catch {} }
  await new Promise(r => setTimeout(r, 100));

  // Do NOT emit the RESULT_SENTINEL here. The parent must treat signal exit
  // as a failure and not as an empty-but-successful result.
  process.stderr.write(`[runner] Aborted by ${signal || 'signal'}\n`);
  process.exit(signalExitCode(signal));
}

if (require.main === module) {
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));
}

// --- Sync barrier for parallel mode ---

const { SyncBarrier } = require('./sync-barrier.cjs');

// --- Script execution ---

/** Fix smart quotes, non-breaking spaces, and line endings in user scripts. */
function sanitizeScript(script) {
  return script
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

const SCRIPT_PARAMS = ['page', 'race', '__startRecording', '__stopRecording', '__startMeasure', '__endMeasure'];

/**
 * Compile a race script into an async function.
 *
 * A script pasted from a chat or a document can carry typographic quotes and
 * odd spaces where JavaScript needs plain ones, so a script that does not
 * parse gets a second try after sanitizeScript(). A script that parses as
 * written is never rewritten: an apostrophe inside a selector or a message
 * stays exactly as its author typed it.
 *
 * SECURITY: Race scripts execute with the full privileges of this Node.js
 * process. Only run scripts you trust \u2014 this is equivalent to `node <file>`.
 */
function compileScript(source) {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor; // NOSONAR \u2014 intentional: executes user-provided race scripts
  try {
    return new AsyncFunction(...SCRIPT_PARAMS, source); // NOSONAR
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return new AsyncFunction(...SCRIPT_PARAMS, sanitizeScript(source)); // NOSONAR
}

/**
 * Pick the timing the results are built from. The Playwright trace is the
 * preferred source (its marks sit on the page's own clock and calibrate to the
 * video frames), but only when it is complete: a mark lost to a navigation
 * pairs the remaining ones wrongly, and without screenshot frames the trace's
 * segments start at 0 rather than at the recording's position in the video,
 * which is what the player's fallback and ffmpeg trimming would read them as.
 * Otherwise the race API's own marker clock, which counts from context
 * creation (video PTS 0), is the safer answer.
 *
 * `usedTraceSegments` reports which clock the segments came from, because
 * everything else derived from the trace — the PTS segments ffmpeg trims on,
 * the calibration the player recalibrates clip times with — is only valid for
 * trace segments. Applied to marker segments it would trim or align against a
 * different clock.
 *
 * @param {object|null} traceTiming - deriveTraceTiming() output, or null
 * @param {Array} markerSegments - segments from the race API
 * @param {Array} markerMeasurements - measurements from the race API
 * @returns {{recordingSegments: Array, measurements: Array, usedTraceSegments: boolean}}
 */
function selectRaceTiming(traceTiming, markerSegments, markerMeasurements) {
  const traceSegments = traceTiming?.recordingSegments || [];
  const traceMeasurements = traceTiming?.measurements || [];
  const calibratable = (traceTiming?.ptsSegments?.length || 0) > 0;
  const segmentsComplete = traceSegments.length > 0 && traceSegments.length === markerSegments.length;
  const measurementsComplete = traceMeasurements.length > 0 && traceMeasurements.length === markerMeasurements.length;
  const usedTraceSegments = calibratable && segmentsComplete;
  return {
    recordingSegments: usedTraceSegments ? traceSegments : markerSegments,
    measurements: measurementsComplete ? traceMeasurements : markerMeasurements,
    usedTraceSegments,
  };
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
 *
 * @param {import('playwright').Page} page
 * @param {{id: string, script: string, vars?: object}} config - this racer's entry from the RunnerConfig
 * @param {object} [options]
 * @param {object|null} [options.barriers] - parallel-mode checkpoints (ready, recordingStart, stop)
 * @param {boolean} [options.isParallel]
 * @param {number} [options.recordingStartTime] - epoch ms the race clock counts from (context creation)
 * @param {boolean} [options.noOverlay]
 * @param {object|null} [options.metricsCollector] - from startProfiling(), or null
 * @param {boolean} [options.noRecording]
 * @param {boolean} [options.cueMarkers]
 * @param {boolean} [options.wallClock]
 */
async function runMarkerMode(page, config, {
  barriers = null,
  isParallel = false,
  recordingStartTime = Date.now(),
  noOverlay = false,
  metricsCollector = null,
  noRecording = false,
  cueMarkers = false,
  wallClock = false,
} = {}) {
  const { id, script: raceScript, vars } = config;

  // --- Visual cues (opt-in via --cue-markers) ---
  // Colored flashes injected at segment boundaries so ffprobe-based tests can
  // verify trace calibration against ground truth in the recorded frames.
  // Off by default: the flash forces a reflow and animates a DOM element at
  // the exact raceStart/raceEnd boundaries, perturbing the CPU/layout/paint
  // metrics being measured — and no production consumer reads the cues (the
  // player and ffmpeg trimming both calibrate from the Playwright trace).
  const flashCues = cueMarkers && !noRecording;
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

  // Overlays and cue flashes are cosmetic. A page that navigates or closes in
  // the middle of one ("Execution context was destroyed") must not turn a
  // racer whose measurements are already in hand into a failed racer — the
  // trace marks and the race API are what the results are built from.
  let cosmeticFailureReported = false;
  const cosmetic = async (work) => {
    try {
      await work();
    } catch (error) {
      if (cosmeticFailureReported) return;
      cosmeticFailureReported = true;
      console.error(`[${id}] Warning: overlay update failed (${error.message}); the race continues without it`);
    }
  };

  const overlayCtrl = new OverlayController(page, { noOverlay, noRecording, wallClock, timeBase: recordingStartTime });

  // The state machine lives in race-api.cjs; everything runner-specific
  // (trace marks, overlays, cues, CDP metrics, barriers, stderr protocol)
  // is injected as hooks.
  const api = createRaceApi({
    recordingStartTime,
    hooks: {
      gateRecordingStart: isParallel && barriers
        ? () => barriers.recordingStart.wait(`${id} startRecording`)
        : null,
      onRecordingStart: async () => {
        // The clock's zero, read before the trace mark's page round-trip so a
        // slow evaluate can't shift it. race-api timestamps the segment start
        // immediately before calling this hook, so the two agree.
        const startEpochMs = Date.now();
        await markTrace(`${traceMarkPrefix}recording:start`);
        await cosmetic(() => Promise.all([
          overlayCtrl.onStartRecording(startEpochMs),
          flashCues ? flashCue(page, CUE_COLOR_START) : null,
        ]));
      },
      markRecordingEnd: async () => {
        // Flag first, mark second: the player trims the clip at this mark, so a
        // flag painted after it lands outside the clip and is never seen. Never
        // at the mark's expense, though — the trim depends on it.
        if (!noOverlay && !noRecording) {
          // A segment with no measured finish flies no flag and spends no beat.
          const painted = await overlayCtrl.onFinish().catch(() => false);
          if (painted) await page.waitForTimeout(FLAG_CAPTURE_MS);
        }
        await markTrace(`${traceMarkPrefix}recording:end`);
      },
      onRecordingStop: async ({ segmentEnd }) => {
        await cosmetic(() => Promise.all([
          flashCues ? flashCue(page, CUE_COLOR_END) : null,
          // The clock stops with the recording, not on the finish: it ran
          // through the spec's untimed waits, so it counts the outro too.
          overlayCtrl.onStopRecording(segmentEnd),
        ]));
      },
      onMeasureStart: async (name) => {
        await markTrace(`${traceMarkPrefix}measure:start:${encodeMeasureName(name)}`);
        await cosmetic(() => overlayCtrl.onMeasureStart());
      },
      onMeasureEnd: (name, endTime, activeCount) => {
        queueTraceMark(`${traceMarkPrefix}measure:end:${encodeMeasureName(name)}`);
        // raceEnd stays synchronous; raise the flag without waiting on it.
        overlayCtrl.onMeasureEnd(activeCount).catch(() => {});
      },
      onUnmatchedMeasureEnd: (name) => {
        console.error(`[${id}] Warning: raceEnd(${JSON.stringify(name)}) called with no matching raceStart — measurement ignored.`);
      },
      onFirstRaceStart: metricsCollector
        ? () => metricsCollector.startMeasurement()
        : null,
      onSectionStart: metricsCollector
        ? (name) => metricsCollector.startSectionMeasurement(name)
        : null,
      onSectionEnd: metricsCollector
        ? (name, activeCount) => {
            metricsCollector.stopSectionMeasurement(name);
            // Stop metrics measurement when the last measurement ends
            if (activeCount === 0) metricsCollector.stopMeasurement();
          }
        : null,
      onMessage: (elapsed, text) => console.error(formatRaceMessage(id, elapsed, text)),
    },
  });
  api.attach(page);

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

  // An empty script has nothing to run, but still reaches the checkpoints
  // below so its partner is never left waiting for it.
  const hasScript = Boolean(raceScript && raceScript.trim() !== '');

  if (hasScript) {
    const raceContext = Object.freeze({ name: id, vars: Object.freeze(vars || {}) });
    try {
      const fn = compileScript(raceScript);
      await fn(page, raceContext, api.startRecording, api.stopRecording, api.startMeasure, api.endMeasure);
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
  }

  await api.finalize();

  if (isParallel && barriers) {
    // Done racing: this racer will never open another segment. Saying so frees
    // a partner that records more segments than it did — including a partner
    // still waiting right now for a racer whose script has already ended.
    barriers.recordingStart.leave();
    await barriers.stop.wait(`${id} finished`);
  }

  await page.waitForTimeout(POST_RACE_WAIT_MS);
  return { segments: api.segments, measurements: api.measurements };
}

// --- Single browser recording flow ---

/**
 * Launch one browser, run the race script, record video, collect results.
 * Called N times (once per racer) by runParallel or runSequential.
 */
async function runBrowserRecording(config, barriers, isParallel, sharedState, opts = {}) {
  const { browserIndex = 0, totalBrowsers = 2, throttle = null, slowmo = 0, noOverlay = false, noRecording = false, ffmpeg = false, har = false, cueMarkers = false, wallClock = false, recordingsDir = null, ignoreHTTPSErrors = false, viewportHeight: configViewportHeight = null } = opts;
  const { id, headless: headlessRaw } = config;
  const headless = headlessRaw === true;
  // id is validated at config entry (isSafeRacerId); confinePath re-checks the
  // constructed path so the racer's output can never land outside the base.
  const outputDir = confinePath(recordingsDir || path.join(__dirname, 'recordings'), id);
  let browser = null;
  let context = null;
  let page = null;
  let metricsCollector = null;
  let error = null;

  const layout = calculateWindowLayout(browserIndex, totalBrowsers, { screen: SCREEN, windowHeight: WINDOW_HEIGHT });
  const windowArgs = isParallel
    ? [`--window-position=${layout.x},${layout.y}`, `--window-size=${layout.width},${layout.height}`]
    : [];

  // Everything that can fail runs inside the try: the catch below releases the
  // barriers, and a failure before it (say, an unwritable recordings dir) would
  // otherwise leave a parallel partner waiting at its first checkpoint.
  try {
    fs.mkdirSync(outputDir, { recursive: true }); // NOSONAR — outputDir comes from confinePath (id validated by isSafeRacerId at config entry)
    cleanupOldVideos(outputDir);

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

    page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

    await applyThrottling(page, throttle, id);

    metricsCollector = await startProfiling(page, browser, id);

    const result = await runMarkerMode(page, config, {
      barriers, isParallel, recordingStartTime, noOverlay, metricsCollector, noRecording, cueMarkers, wallClock,
    });
    const markerSegments = result?.segments || [];
    const markerMeasurements = result?.measurements || [];

    const { tracePath, profileMetrics, traceText } = await collectProfilingResults(browser, metricsCollector, outputDir, id);
    const traceTiming = deriveTraceTiming(traceText);
    const { recordingSegments, measurements, usedTraceSegments } = selectRaceTiming(traceTiming, markerSegments, markerMeasurements);

    await context.close();
    const wallClockDuration = (Date.now() - contextCreationStart) / 1000;
    activeContexts = activeContexts.filter(ctx => ctx !== context);
    context = null;
    console.error(formatContextClosed(id));

    await browser.close();
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
    browser = null;

    if (noRecording) {
      return {
        id,
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

    // The parent finds the recordings by scanning the racer's directory
    // (cli/results.js moveResults), so the trimmed and full files are not
    // named in the result.
    // Everything below is trace-derived, so it rides on the same decision that
    // picked the segments: against marker segments, the trace's PTS segments
    // would trim a different span and its calibration would move the player's
    // clip to a frame the marker clock never meant.
    if (recordingSegments.length > 0 && ffmpeg) {
      const trimSegments = usedTraceSegments ? traceTiming.ptsSegments : recordingSegments;
      trimVideoWithFfmpeg(outputDir, trimSegments, id);
    } else if (recordingSegments.length > 0) {
      console.error(`[${id}] Skipping video trimming (no --ffmpeg)`);
    }

    const publishCalibration = !ffmpeg && usedTraceSegments;
    const calibratedStart = publishCalibration ? (traceTiming?.calibratedStartPts ?? null) : null;
    const traceCalibration = publishCalibration ? (traceTiming?.traceCalibration || null) : null;

    return {
      id,
      tracePath: tracePath ? path.join(id, path.basename(tracePath)) : null,
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
    // Set hasError + release barriers BEFORE doing capture, so the other
    // racer in parallel mode doesn't sit at its barrier while we snapshot.
    if (sharedState) { sharedState.hasError = true; sharedState.errorMessage = e.message; }
    if (barriers) {
      barriers.ready.releaseAll();
      barriers.recordingStart.releaseAll();
      barriers.stop.releaseAll();
    }
    if (page) {
      try { console.error(`[${id}] Failure URL: ${page.url()}`); } catch {}
      try {
        const screenshotPath = path.join(outputDir, `${id}.failure.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5000 });
        console.error(`[${id}] Failure screenshot saved: ${screenshotPath}`);
      } catch (e2) {
        console.error(`[${id}] Could not capture screenshot: ${e2.message}`);
      }
      try {
        const htmlPath = path.join(outputDir, `${id}.failure.html`);
        // page.content() honors the page's default timeout (90s) — cap it
        // ourselves so a hung renderer can't stall cleanup.
        const html = await Promise.race([
          page.content(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('content() timed out after 5s')), 5000)),
        ]);
        await fs.promises.writeFile(htmlPath, html);
        console.error(`[${id}] Failure HTML saved: ${htmlPath}`);
      } catch (e2) {
        console.error(`[${id}] Could not capture HTML: ${e2.message}`);
      }
    }
    if (metricsCollector) { try { await metricsCollector.detach(); } catch {} }
  }

  if (context) { try { await context.close(); } catch {} }
  if (browser) { try { await browser.close(); } catch {} }

  return {
    id,
    tracePath: null,
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
  const sharedState = { hasError: false, errorMessage: null };
  const barriers = {
    ready: new SyncBarrier(count, sharedState, { timeoutMs: BARRIER_TIMEOUT_MS }),
    recordingStart: new SyncBarrier(count, sharedState, { timeoutMs: BARRIER_TIMEOUT_MS }),
    stop: new SyncBarrier(count, sharedState, { timeoutMs: BARRIER_TIMEOUT_MS })
  };

  const promises = browserConfigs.map((config, i) =>
    runBrowserRecording(config, barriers, true, sharedState, { ...opts, browserIndex: i, totalBrowsers: count })
  );

  const results = await settleRacers(promises, browserConfigs.map(c => c.id), sharedState);

  return attachSharedError(results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { id: browserConfigs[i].id, error: r.reason?.message || 'Unknown error' };
  }), sharedState);
}

/**
 * Wait for every racer to settle — but not forever once the race has already
 * failed.
 *
 * A racer hung inside its own script (an unresolving promise, which no
 * Playwright timeout can see) never settles. A plain Promise.allSettled would
 * then stay pending even though a checkpoint has already timed out and failed
 * the race, so the runner would never report it and the CLI would sit there.
 * Once the shared error is set, whoever is still running gets `graceMs` to
 * unwind; after that the race is reported without them.
 *
 * Nothing is waited on while the race is healthy, so a long but well-behaved
 * race is never cut short.
 *
 * @param {Promise[]} promises - one per racer, as passed to Promise.allSettled
 * @param {string[]} ids - racer ids, positionally matching `promises`
 * @param {{hasError: boolean, errorMessage: string|null}} sharedState
 * @returns {Promise<Array<{status: string, value?: object, reason?: Error}>>}
 */
function settleRacers(promises, ids, sharedState, { graceMs = ABANDON_GRACE_MS, pollMs = 250 } = {}) {
  const outcomes = new Array(promises.length).fill(null);
  promises.forEach((p, i) => {
    p.then(
      value => { outcomes[i] = { status: 'fulfilled', value }; },
      reason => { outcomes[i] = { status: 'rejected', reason }; },
    );
  });

  const abandoned = new Promise(resolve => {
    let deadline = null;
    const timer = setInterval(() => {
      if (!sharedState?.hasError) return;
      deadline ??= Date.now() + graceMs;
      if (Date.now() < deadline) return;
      clearInterval(timer);
      const stuck = ids.filter((_, i) => !outcomes[i]);
      console.error(
        `[runner] Giving up on ${stuck.join(', ')} after ${graceMs}ms: still running with the race already failed` +
        `${sharedState.errorMessage ? ` (${sharedState.errorMessage})` : ''}`
      );
      resolve(outcomes.map((outcome, i) => outcome || {
        status: 'rejected',
        reason: new Error(`still running ${graceMs}ms after the race failed; abandoned (${ids[i]} never finished)`),
      }));
    }, pollMs);
    // Never a reason on its own to keep the process alive.
    timer.unref();
  });

  return Promise.race([Promise.allSettled(promises), abandoned]);
}

/**
 * Make a checkpoint failure visible in the results. A barrier that times out
 * only hands its waiters `{ aborted: true }` and flags sharedState; the racers
 * then run on and can finish with no error of their own, so the race would
 * pass (exit 0) even though they never synchronised. When the shared error is
 * not already explained by a racer's own failure, every racer carries it —
 * with the measurements it did collect kept alongside.
 *
 * @param {BrowserResult[]} results
 * @param {{hasError: boolean, errorMessage: string|null}} sharedState
 * @returns {BrowserResult[]}
 */
function attachSharedError(results, sharedState) {
  if (!sharedState?.hasError || !sharedState.errorMessage) return results;
  if (results.some(r => r.error)) return results;
  return results.map(r => ({ ...r, error: sharedState.errorMessage }));
}

async function runSequential(browserConfigs, opts = {}) {
  const sharedState = { hasError: false, errorMessage: null };
  const results = [];
  for (let i = 0; i < browserConfigs.length; i++) {
    const result = await runBrowserRecording(browserConfigs[i], null, false, sharedState, { ...opts, browserIndex: i, totalBrowsers: browserConfigs.length });
    results.push(result);
  }
  return results;
}

// --- Main entry point ---

/**
 * Emit the sentinel result line and exit with the given code, but only after
 * stdout has been flushed. process.exit() does not wait for a piped stdout to
 * drain, so a large result payload can be truncated mid-JSON if we exit on the
 * next line. The timeout is a safety net in case the write callback never fires.
 */
function emitResultAndExit(payload, code) {
  const line = RESULT_SENTINEL + payload + '\n';
  const done = () => process.exit(code);
  const timer = setTimeout(done, 5000);
  timer.unref();
  process.stdout.write(line, () => { clearTimeout(timer); done(); });
}

async function main() {
  // Load shared constants from ESM module
  await loadConstants();

  // Config is passed either inline as argv[2] (legacy / direct invocation) or,
  // to stay well under the OS argv size limit for large race scripts, via a
  // temp file: `runner.cjs --config-file <path>`. The file is consumed once.
  let configJson;
  if (process.argv[2] === '--config-file') {
    const configPath = process.argv[3];
    if (!configPath) { console.error('Error: --config-file requires a path'); process.exit(1); }
    try { configJson = fs.readFileSync(configPath, 'utf-8'); }
    catch (e) { console.error('Error: Could not read config file:', e.message); process.exit(1); }
    finally { try { fs.unlinkSync(configPath); } catch {} }
  } else {
    configJson = process.argv[2];
  }
  if (!configJson) { console.error('Error: Config JSON required'); process.exit(1); }

  let config;
  try { config = JSON.parse(configJson); }
  catch (e) { console.error('Error: Invalid JSON:', e.message); process.exit(1); }

  if (config.protocolVersion !== PROTOCOL_VERSION) {
    console.error(
      `Error: Runner protocol mismatch — runner.cjs speaks v${PROTOCOL_VERSION} but the config is ` +
      `v${config.protocolVersion ?? 'unversioned'}. race.js and runner.cjs must come from the same install.`
    );
    process.exit(1);
  }

  const { browsers, executionMode, throttle, headless: headlessRaw, slowmo, noOverlay, noRecording, ffmpeg, har, cueMarkers, wallClock, recordingsDir, ignoreHTTPSErrors, viewportHeight } = config;

  // Racer ids become directory/file names under the recordings dir, so reject
  // anything that isn't a plain basename before any path is built from them.
  if (!Array.isArray(browsers) || browsers.length === 0) {
    console.error('Error: Config must include a non-empty browsers array');
    process.exit(1);
  }
  for (const b of browsers) {
    if (!isSafeRacerId(b?.id)) {
      console.error(`Error: Unsafe racer id ${JSON.stringify(b?.id)} — ids must be plain names without path separators`);
      process.exit(1);
    }
  }
  const headless = headlessRaw === true;

  // The recordings dir is chosen by the parent process (or defaults to a dir
  // next to the runner). Resolve it once to an absolute path so every path the
  // runner derives from it stays anchored under this directory.
  const recBase = path.resolve(recordingsDir || path.join(__dirname, 'recordings'));
  fs.mkdirSync(recBase, { recursive: true });

  const runOpts = { throttle, slowmo, noOverlay, noRecording, ffmpeg, har, cueMarkers, wallClock, recordingsDir: recBase, ignoreHTTPSErrors, viewportHeight };

  // Set headless flag on all browser configs (strict boolean — strings must not slip through)
  for (const browser of browsers) {
    browser.headless = headless;
  }

  let results;
  try {
    results = executionMode === 'parallel'
      ? await runParallel(browsers, runOpts)
      : await runSequential(browsers, runOpts);
  } catch (error) {
    results = browsers.map(b => ({ id: b.id, error: error.message }));
  }

  const errors = results.filter(r => r.error).map(r => `${r.id}: ${r.error}`);

  // Output in new array-based format. Prefix with sentinel so the parent
  // can reliably distinguish this line from any other stdout (e.g. from
  // subprocess tooling, Playwright logs, or a signal-cleanup stub).
  const payload = JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    browsers: results.map(r => ({
      id: r.id,
      tracePath: r.tracePath || null,
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
  });

  emitResultAndExit(payload, errors.length > 0 ? 1 : 0);
}

// Allow unit testing of internal functions when required as a module
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    emitResultAndExit(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, browsers: [], errors: [err.message] }), 1);
  });
}

module.exports = { RESULT_SENTINEL, setupMetricsCollection, runMarkerMode, selectRaceTiming, attachSharedError, settleRacers };  // RESULT_SENTINEL/setupMetricsCollection re-exported for back-compat with existing imports.
