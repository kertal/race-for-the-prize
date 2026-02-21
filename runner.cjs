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

// Track active browsers/contexts for cleanup on SIGTERM/SIGINT
let activeBrowsers = [];
let activeContexts = [];

// --- Constants (loaded from shared ESM module) ---

// These will be populated by loadConstants() before main() runs
let SCREEN, WINDOW_HEIGHT, CUE_DETECTION;

async function loadConstants() {
  const { SCREEN: s, VIDEO_DEFAULTS: v, CUE_DETECTION: c } = await import('./cli/colors.js');
  SCREEN = s;
  WINDOW_HEIGHT = v.windowHeight;
  CUE_DETECTION = c;
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
 * Detect visual cue frames in the video using ffprobe.
 * Crops a small top-left region and looks for green/red cue pixels.
 * Returns { startCues: [timestamps], endCues: [timestamps] }.
 */
function detectCueFrames(videoPath) {
  try {
    // Crop 30x30 top-left corner where the cue square lives, then analyze color
    // Percent-encode characters that are special in FFmpeg lavfi filter syntax
    const escaped = videoPath.replace(/\\/g, '/').replace(/[';,\[\]=\\ ]/g, ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
    const result = execFileSync('ffprobe', [
      '-f', 'lavfi',
      '-i', 'movie=' + escaped + ',crop=30:30:0:0,signalstats',
      '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.HUEAVG,lavfi.signalstats.SATAVG,lavfi.signalstats.YAVG',
      '-of', 'csv=p=0',
      '-v', 'quiet'
    ], { timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });

    const lines = result.toString().trim().split('\n').filter(Boolean);
    const startCues = [];
    const endCues = [];
    let prevTime = 0;
    let frameDuration = 0.04; // default

    for (const line of lines) {
      const parts = line.split(',');
      const time = parseFloat(parts[0]);
      const hue = parseFloat(parts[1]);
      const sat = parseFloat(parts[2]);
      const y = parseFloat(parts[3]);
      if (isNaN(time) || isNaN(hue) || isNaN(sat)) continue;

      if (time > prevTime && prevTime > 0) frameDuration = time - prevTime;
      prevTime = time;

      // Cue frames have high saturation.
      // Green (#00FF00): hue ~146, sat ~118, Y ~38 in signalstats
      // Red (#FF0000): hue ~81, sat ~116, Y ~161 in signalstats
      if (sat > CUE_DETECTION.saturationMin) {
        if (hue > CUE_DETECTION.startHueMin && hue < CUE_DETECTION.startHueMax && y < CUE_DETECTION.startYMax) {
          startCues.push(time);
        } else if (hue > CUE_DETECTION.endHueMin && hue < CUE_DETECTION.endHueMax && y > CUE_DETECTION.endYMin) {
          endCues.push(time);
        }
      }
    }

    if (startCues.length === 0 || endCues.length === 0) {
      console.error(`[detectCueFrames] Warning: Could not detect cues (start: ${startCues.length}, end: ${endCues.length})`);
    }
    return { startCues, endCues, frameDuration };
  } catch (e) {
    console.error(`[detectCueFrames] Failed: ${e.message}`);
    return { startCues: [], endCues: [], frameDuration: 0.04 };
  }
}

/**
 * Build segments from detected cue frames.
 * Content starts after the green cue disappears and ends before the red cue appears.
 */
function cueSegments(startCues, endCues, frameDuration) {
  if (startCues.length === 0 || endCues.length === 0) return [];
  const dt = frameDuration || 0.04; // default ~25fps
  // Start one frame after the last green cue frame
  const start = startCues[startCues.length - 1] + dt;
  // End one frame before the first red cue frame
  const end = endCues[0] - dt;
  if (end > start) return [{ start, end }];
  return [];
}

/**
 * Extract recording segments from a full video and concatenate them.
 * Uses visual cue detection for frame-accurate cutting.
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
      ], { timeout: 120000, stdio: 'pipe' });
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
      ], { timeout: 120000, stdio: 'pipe' });
    }

    fs.writeFileSync(concatListPath, segmentFiles.map(f => `file '${f}'`).join('\n'));
    const outputPath = path.join(dir, `${base}_final${ext}`);
    execFileSync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', concatListPath, '-c', 'copy', outputPath
    ], { timeout: 120000, stdio: 'pipe' });

    for (const f of segmentFiles) { try { fs.unlinkSync(f); } catch {} }
    try { fs.unlinkSync(concatListPath); } catch {}
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
      if (now - fs.statSync(filepath).mtime.getTime() > 5000) {
        fs.unlinkSync(filepath);
      }
    }
  } catch {}
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

/**
 * Blocks until `count` callers have called wait(), then releases all.
 * Used to synchronize two browsers at key moments (ready, recording start, stop).
 */
class SyncBarrier {
  constructor(count, sharedState = null) {
    this.count = count;
    this.waiting = 0;
    this.resolvers = [];
    this.sharedState = sharedState;
    this.released = false;
    this.checkIntervals = [];
  }

  releaseAll() {
    if (this.released) return;
    this.released = true;
    // Clean up all polling intervals
    this.checkIntervals.forEach(clearInterval);
    this.checkIntervals = [];
    this.resolvers.forEach(r => r({ aborted: true }));
    this.resolvers = [];
  }

  async wait(label = '') {
    if (this.released || this.sharedState?.hasError) return { aborted: true };

    this.waiting++;
    if (this.waiting >= this.count) {
      this.resolvers.forEach(r => r({ aborted: false }));
      this.waiting = 0;
      this.resolvers = [];
      return { aborted: false };
    }

    return new Promise(resolve => {
      this.resolvers.push(resolve);
      const check = setInterval(() => {
        if (this.sharedState?.hasError || this.released) {
          clearInterval(check);
          this.checkIntervals = this.checkIntervals.filter(i => i !== check);
          resolve({ aborted: true });
        }
      }, 100);
      this.checkIntervals.push(check);
    });
  }
}

// --- Click event tracker (injected into browser pages) ---

/**
 * Injects a click event tracker into all pages in the context.
 * Records click events with timestamps relative to recordingStartTime for later analysis.
 */
async function setupClickTracker(context, recordingStartTime) {
  await context.addInitScript((startTime) => {
    if (window.__clickTrackerInjected) return;
    window.__clickTrackerInjected = true;
    window.__recordingStartTime = startTime;
    window.__clickEvents = [];

    const inject = () => {
      document.addEventListener('mousedown', (e) => {
        const ts = (Date.now() - window.__recordingStartTime) / 1000;
        let desc = e.target.tagName.toLowerCase();
        if (e.target.id) desc += `#${e.target.id}`;
        if (e.target.className && typeof e.target.className === 'string') {
          desc += '.' + e.target.className.split(' ').filter(Boolean).slice(0, 2).join('.');
        }
        const text = (e.target.textContent || '').trim().slice(0, 30);
        if (text) desc += ` "${text}${text.length >= 30 ? '...' : ''}"`;
        window.__clickEvents.push({ timestamp: ts, x: e.clientX, y: e.clientY, element: desc });
      }, true);
    };

    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', inject)
      : inject();
  }, recordingStartTime);
}

async function getClickEvents(page) {
  try { return await page.evaluate(() => window.__clickEvents || []); }
  catch { return []; }
}

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
        // Get navigation timing from the page
        const timing = await page.evaluate(() => {
          const perf = window.performance;
          if (!perf || !perf.timing) return null;
          const t = perf.timing;
          return {
            domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
            domComplete: t.domComplete - t.navigationStart
          };
        });

        if (timing) {
          result.total.domContentLoaded = timing.domContentLoaded > 0 ? timing.domContentLoaded : null;
          result.total.domComplete = timing.domComplete > 0 ? timing.domComplete : null;
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

/**
 * Remap click timestamps to match trimmed video segments.
 * Adjusts timestamps so they're relative to the start of the trimmed video.
 */
function remapClickTimestamps(clickEvents, segments) {
  if (segments.length === 0) return clickEvents;

  const adjusted = [];
  let offset = 0;
  for (const seg of segments) {
    for (const evt of clickEvents) {
      if (evt.timestamp >= seg.start && evt.timestamp <= seg.end) {
        adjusted.push({ ...evt, timestamp: offset + (evt.timestamp - seg.start) });
      }
    }
    offset += seg.end - seg.start;
  }
  return adjusted;
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
 *   page.raceRecordingEnd()           — manually end a video segment (sync)
 *   page.raceMessage(text)            — send a message to the CLI terminal (sync)
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
async function runMarkerMode(page, context, config, barriers, isParallel, sharedState, recordingStartTime, noOverlay = false, metricsCollector = null) {
  const { id, script: raceScript } = config;

  const segments = [];
  let currentSegmentStart = null;
  const measurements = [];
  const activeMeasurements = {};

  // --- Visual cues for frame-accurate video trimming ---
  // Place a colored square in the top-left corner so ffprobe can detect cut points.
  const CUE_COLOR_START = '#00FF00';
  const CUE_COLOR_END = '#FF0000';
  const CUE_DURATION_MS = 300;
  const CUE_SIZE = 30; // px — large enough for reliable detection

  const flashCue = async (color) => {
    await page.evaluate(({ c, size }) => {
      const el = document.createElement('div');
      el.id = '__race_cue';
      el.style.cssText = 'position:fixed;top:0;left:0;width:' + size + 'px;height:' + size + 'px;z-index:2147483647;background:' + c;
      document.documentElement.appendChild(el);
      el.offsetHeight;
    }, { c: color, size: CUE_SIZE });
    await page.waitForTimeout(CUE_DURATION_MS);
    await page.evaluate(() => {
      const el = document.getElementById('__race_cue');
      if (el) el.remove();
    });
  };

  const showRecordingIndicator = async () => {
    if (noOverlay) return;
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = '__race_rec_indicator';
      el.textContent = '📹 REC';
      el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;'
        + 'background:rgba(220,38,38,0.85);color:#fff;padding:4px 10px;border-radius:6px;'
        + 'font:bold 14px/1 system-ui,sans-serif;pointer-events:none';
      document.body.appendChild(el);
    });
  };

  const showFinishTime = (duration) => {
    if (noOverlay) return;
    page.evaluate((t) => {
      const el = document.getElementById('__race_rec_indicator');
      if (!el) return;
      el.textContent = '🏁 ' + t.toFixed(1) + 's';
      el.style.background = 'rgba(22,163,74,0.85)';
    }, duration);
  };

  const hideRecordingIndicator = async () => {
    if (noOverlay) return;
    await page.evaluate(() => {
      const el = document.getElementById('__race_rec_indicator');
      if (el) el.remove();
    });
  };

  const showMedal = async () => {
    if (!sharedState) return;
    // Record finish with actual measurement end time for accurate ranking
    const lastMeasurement = measurements[measurements.length - 1];
    const endTime = lastMeasurement ? lastMeasurement.endTime : (Date.now() - recordingStartTime) / 1000;
    sharedState.finishOrder.push({ id, endTime });
    if (noOverlay) return;

    if (isParallel) {
      // Parallel mode: show placement medals based on actual end times
      const sorted = [...sharedState.finishOrder].sort((a, b) => a.endTime - b.endTime);
      const place = sorted.findIndex(f => f.id === id) + 1;
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
      const medal = medals[place - 1] || `${place}`;
      const ordinal = ordinals[place - 1] || `${place}th`;
      await page.evaluate(({ medal, ordinal }) => {
        const el = document.createElement('div');
        el.id = '__race_medal';
        el.textContent = medal + ' ' + ordinal;
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
          + 'font:bold 64px/1 system-ui,sans-serif;pointer-events:none;'
          + 'background:rgba(0,0,0,0.6);color:#fff;padding:24px 48px;border-radius:16px';
        document.body.appendChild(el);
      }, { medal, ordinal });
    } else {
      // Sequential mode: just show finish flag (no placement since they don't race simultaneously)
      await page.evaluate(() => {
        const el = document.createElement('div');
        el.id = '__race_medal';
        el.textContent = '🏁';
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
          + 'font:bold 80px/1 system-ui,sans-serif;pointer-events:none;'
          + 'background:rgba(0,0,0,0.6);color:#fff;padding:24px 48px;border-radius:16px';
        document.body.appendChild(el);
      });
    }
    await page.waitForTimeout(500);
  };

  const startRecording = async () => {
    if (currentSegmentStart !== null) return;
    if (isParallel && barriers) {
      const result = await barriers.recordingStart.wait(`${id} startRecording`);
      if (result?.aborted) return;
    }
    // Show REC indicator BEFORE the green cue so it's visible when trimming starts
    await showRecordingIndicator();
    await flashCue(CUE_COLOR_START);
    currentSegmentStart = (Date.now() - recordingStartTime) / 1000;
  };


  let stopPromise = null;
  const stopRecording = async () => {
    if (currentSegmentStart === null) return stopPromise;
    segments.push({ start: currentSegmentStart, end: (Date.now() - recordingStartTime) / 1000 });
    currentSegmentStart = null;
    stopPromise = (async () => {
      await hideRecordingIndicator();
      await showMedal();
      await flashCue(CUE_COLOR_END);
    })();
    return stopPromise;
  };

  let raceStartTime = null;

  const startMeasure = (name = 'default') => {
    if (raceStartTime === null) raceStartTime = Date.now();
    activeMeasurements[name] = (Date.now() - recordingStartTime) / 1000;
  };

  const endMeasure = (name = 'default') => {
    const start = activeMeasurements[name];
    if (start === undefined) return 0;
    const end = (Date.now() - recordingStartTime) / 1000;
    const duration = end - start;
    measurements.push({ name, startTime: start, endTime: end, duration });
    delete activeMeasurements[name];
    showFinishTime(duration);
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
    startMeasure(name);
  };
  page.raceEnd = (name = 'default') => {
    const duration = endMeasure(name);
    // Stop metrics measurement when the last measurement ends
    if (metricsCollector && Object.keys(activeMeasurements).length === 0) {
      metricsCollector.stopMeasurement();
    }
    return duration;
  };

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
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('page', '__startRecording', '__stopRecording', '__startMeasure', '__endMeasure', sanitized);
    await fn(page, startRecording, stopRecording, startMeasure, endMeasure);
  } catch (error) {
    console.error(`[${id}] Script failed: ${error.message}`);
    throw new Error(`Script execution failed: ${error.message}`);
  }

  if (currentSegmentStart !== null) await stopRecording();
  if (stopPromise) await stopPromise;

  if (isParallel && barriers) {
    await barriers.stop.wait(`${id} finished`);
  }

  await page.waitForTimeout(500);
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
  await browser.startTracing(page, { screenshots: true, categories: ['devtools.timeline'] });
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
  return { tracePath, profileMetrics };
}

function trimVideoWithFfmpeg(outputDir, markerSegments, id) {
  const videoFile = getMostRecentVideo(outputDir);
  if (!videoFile) return null;
  const videoPath = path.join(outputDir, videoFile);
  const { startCues, endCues, frameDuration } = detectCueFrames(videoPath);
  const segments = cueSegments(startCues, endCues, frameDuration);
  const trimSegments = segments.length > 0 ? segments : markerSegments;
  if (segments.length === 0 && markerSegments.length > 0) {
    console.error(`[${id}] Cue detection failed, using marker segments`);
  }
  const res = extractSegments(videoPath, trimSegments, id);
  return path.basename(res.fullPath);
}

// --- Single browser recording flow ---

/**
 * Launch one browser, run the race script, record video, collect results.
 * Called N times (once per racer) by runParallel or runSequential.
 */
async function runBrowserRecording(config, barriers, isParallel, sharedState, opts = {}) {
  const { browserIndex = 0, totalBrowsers = 2, throttle = null, profile = false, slowmo = 0, noOverlay = false, ffmpeg = false } = opts;
  const { id, headless } = config;
  const outputDir = path.join(__dirname, 'recordings', id);
  let browser = null;
  let context = null;
  let error = null;

  fs.mkdirSync(outputDir, { recursive: true });
  cleanupOldVideos(outputDir);

  const layout = calculateWindowLayout(browserIndex, totalBrowsers);
  const windowArgs = isParallel
    ? [`--window-position=${layout.x},${layout.y}`, `--window-size=${layout.width},${layout.height}`]
    : [];

  try {
    const launchOpts = { headless: headless || false, args: windowArgs };
    if (slowmo > 0) launchOpts.slowMo = slowmo * 20;
    browser = await chromium.launch(launchOpts);
    activeBrowsers.push(browser);

    const viewportWidth = isParallel ? layout.width - 20 : 1280;
    const viewportHeight = isParallel ? layout.height - 100 : 720;
    const videoScale = slowmo > 0 ? 2 : 1;
    context = await browser.newContext({
      recordVideo: { dir: outputDir, size: { width: viewportWidth * videoScale, height: viewportHeight * videoScale } },
      viewport: { width: viewportWidth, height: viewportHeight },
    });
    const recordingStartTime = Date.now();
    activeContexts.push(context);

    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);

    await setupClickTracker(context, recordingStartTime);
    await applyThrottling(page, throttle, id);

    const metricsCollector = profile ? await startProfiling(page, browser, id) : null;

    const result = await runMarkerMode(page, context, config, barriers, isParallel, sharedState, recordingStartTime, noOverlay, metricsCollector);
    const markerSegments = result?.segments || [];
    const measurements = result?.measurements || [];

    let tracePath = null;
    let profileMetrics = null;
    if (profile) {
      const profiling = await collectProfilingResults(browser, metricsCollector, outputDir, id);
      tracePath = profiling.tracePath;
      profileMetrics = profiling.profileMetrics;
    }

    const clickEvents = await getClickEvents(page);
    const adjustedClicks = remapClickTimestamps(clickEvents, markerSegments);

    await context.close();
    activeContexts = activeContexts.filter(c => c !== context);
    context = null;
    console.error(`[${id}] Context closed`);

    let fullVideoFile = null;
    const recordingSegments = markerSegments;
    if (markerSegments.length > 0 && ffmpeg) {
      fullVideoFile = trimVideoWithFfmpeg(outputDir, markerSegments, id);
    } else if (markerSegments.length > 0) {
      console.error(`[${id}] Skipping video trimming (no --ffmpeg)`);
    }

    await browser.close();
    activeBrowsers = activeBrowsers.filter(b => b !== browser);
    browser = null;

    const videoFile = getMostRecentVideo(outputDir);
    return {
      id,
      videoPath: videoFile ? path.join(id, videoFile) : null,
      fullVideoPath: fullVideoFile ? path.join(id, fullVideoFile) : null,
      tracePath: tracePath ? path.join(id, path.basename(tracePath)) : null,
      clickEvents: adjustedClicks,
      measurements,
      profileMetrics,
      recordingSegments: recordingSegments.length > 0 ? recordingSegments : null,
      error: null
    };
  } catch (e) {
    error = e;
    console.error(`[${id}] Error: ${e.message}`);
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
    clickEvents: [],
    measurements: [],
    profileMetrics: null,
    recordingSegments: null,
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

  const { browsers, executionMode, throttle, headless, profile, slowmo, noOverlay, ffmpeg } = config;
  const runOpts = { throttle, profile, slowmo, noOverlay, ffmpeg };

  // Set headless flag on all browser configs
  for (const browser of browsers) {
    browser.headless = headless || false;
  }

  fs.mkdirSync(path.join(__dirname, 'recordings'), { recursive: true });

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
      clickEvents: r.clickEvents || [],
      measurements: r.measurements || [],
      profileMetrics: r.profileMetrics || null,
      recordingSegments: r.recordingSegments || null,
      error: r.error || null
    })),
    errors: errors.length > 0 ? errors : undefined
  }));

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  console.log(JSON.stringify({ browsers: [], errors: [err.message] }));
  process.exit(1);
});
