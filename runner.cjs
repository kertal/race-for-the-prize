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
    // Crop 10x10 top-left corner where the cue pixel lives, then analyze color
    const escaped = videoPath.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/ /g, '\\ ');
    const result = execFileSync('ffprobe', [
      '-f', 'lavfi',
      '-i', 'movie=' + escaped + ',crop=10:10:0:0,signalstats',
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

      // Cue frames have high saturation (>80).
      // Green (#00FF00): hue ~146, sat ~118, Y ~38 in signalstats
      // Red (#FF0000): hue ~81, sat ~116, Y ~161 in signalstats
      if (sat > 80) {
        if (hue > 130 && hue < 170 && y < 80) {
          startCues.push(time);
        } else if (hue > 60 && hue < 100 && y > 120) {
          endCues.push(time);
        }
      }
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

  console.log(JSON.stringify({ browser1Video: null, browser2Video: null }));
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
  }

  releaseAll() {
    if (this.released) return;
    this.released = true;
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
          resolve({ aborted: true });
        }
      }, 100);
    });
  }
}

// --- Click visualizer (injected into browser pages) ---

/**
 * Injects a click indicator overlay into all pages in the context.
 * Shows a red ripple animation on every mousedown and records click events
 * with timestamps relative to recordingStartTime for later analysis.
 */
async function setupClickVisualizer(context, recordingStartTime) {
  await context.addInitScript((startTime) => {
    if (window.__clickVisualizerInjected) return;
    window.__clickVisualizerInjected = true;
    window.__recordingStartTime = startTime;
    window.__clickEvents = [];

    const style = document.createElement('style');
    style.textContent = `
      .playwright-click-indicator {
        position: fixed; pointer-events: none; z-index: 999999;
        width: 40px; height: 40px; border-radius: 50%;
        background: radial-gradient(circle, rgba(255,82,82,0.9) 0%, rgba(255,82,82,0.5) 30%, transparent 60%);
        transform: translate(-50%, -50%) scale(0);
        animation: click-ripple 0.5s ease-out forwards;
      }
      .playwright-click-indicator::after {
        content: ''; position: absolute; top: 50%; left: 50%;
        width: 50px; height: 50px; border-radius: 50%;
        border: 3px solid rgba(255,82,82,0.7);
        transform: translate(-50%, -50%) scale(0);
        animation: click-ring 0.5s ease-out forwards;
      }
      @keyframes click-ripple {
        0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
        60% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.7; }
        100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
      }
      @keyframes click-ring {
        0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1.3); opacity: 0; }
      }
    `;

    const inject = () => {
      const target = document.head || document.body;
      if (!target) { requestAnimationFrame(inject); return; }
      target.appendChild(style);

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

        const dot = document.createElement('div');
        dot.className = 'playwright-click-indicator';
        dot.style.left = e.clientX + 'px';
        dot.style.top = e.clientY + 'px';
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 500);
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
async function runMarkerMode(page, context, config, barriers, isParallel, sharedState, recordingStartTime) {
  const { id, script: raceScript } = config;

  const segments = [];
  let currentSegmentStart = null;
  const measurements = [];
  const activeMeasurements = {};

  // --- Visual cues for frame-accurate video trimming ---
  // Place a small colored pixel in the top-left corner so ffprobe can detect cut points.
  const CUE_COLOR_START = '#00FF00';
  const CUE_COLOR_END = '#FF0000';
  const CUE_DURATION_MS = 300;
  const CUE_SIZE = 10; // px — small enough to be invisible, large enough for detection

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
    page.evaluate((t) => {
      const el = document.getElementById('__race_rec_indicator');
      if (!el) return;
      el.textContent = '🏁 ' + t.toFixed(1) + 's';
      el.style.background = 'rgba(22,163,74,0.85)';
    }, duration);
  };

  const hideRecordingIndicator = async () => {
    await page.evaluate(() => {
      const el = document.getElementById('__race_rec_indicator');
      if (el) el.remove();
    });
  };

  const showMedal = async () => {
    if (!sharedState) return;
    sharedState.finishOrder.push(id);
    const place = sharedState.finishOrder.length;
    const medal = place === 1 ? '🥇' : '🥈';
    await page.evaluate(({ medal, place }) => {
      const el = document.createElement('div');
      el.id = '__race_medal';
      el.textContent = medal + ' ' + (place === 1 ? '1st' : '2nd');
      el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
        + 'font:bold 64px/1 system-ui,sans-serif;pointer-events:none;'
        + 'background:rgba(0,0,0,0.6);color:#fff;padding:24px 48px;border-radius:16px';
      document.body.appendChild(el);
    }, { medal, place });
    await page.waitForTimeout(1500);
  };

  const startRecording = async () => {
    if (currentSegmentStart !== null) return;
    if (isParallel && barriers) {
      const result = await barriers.recordingStart.wait(`${id} startRecording`);
      if (result?.aborted) return;
    }
    await flashCue(CUE_COLOR_START);
    await showRecordingIndicator();
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

  const startMeasure = (name = 'default') => {
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
    console.error(`[${id}] __raceMessage__:${text}`);
  };
  page.raceRecordingStart = async () => { hasExplicitRecording = true; await startRecording(); };
  page.raceRecordingEnd = async () => { hasExplicitRecording = true; await stopRecording(); };
  page.raceStart = async (name = 'default') => {
    if (!hasExplicitRecording && !autoRecordingStarted) {
      autoRecordingStarted = true;
      await startRecording();
    }
    startMeasure(name);
  };
  page.raceEnd = (name = 'default') => endMeasure(name);

  if (isParallel && barriers) {
    const result = await barriers.ready.wait(`${id} ready`);
    if (result?.aborted) {
      console.error(`[${id}] Ready barrier aborted, continuing...`);
    }
  }

  if (!raceScript || raceScript.trim() === '') return { segments: [], measurements: [] };

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

// --- Single browser recording flow ---

/**
 * Launch one browser, run the race script, record video, collect results.
 * Called twice (once per racer) by runParallel or runSequential.
 */
async function runBrowserRecording(config, barriers, isParallel, sharedState, browserIndex = 0, throttle = null, profile = false, slowmo = 0) {
  const { id, headless } = config;
  const outputDir = path.join(__dirname, 'recordings', id);
  let browser = null;
  let context = null;
  let error = null;

  fs.mkdirSync(outputDir, { recursive: true });
  cleanupOldVideos(outputDir);

  const windowWidth = 960;
  const windowHeight = 800;
  const windowArgs = isParallel
    ? [`--window-position=${browserIndex === 0 ? 0 : windowWidth},0`, `--window-size=${windowWidth},${windowHeight}`]
    : [];

  try {
    const launchOpts = { headless: headless || false, args: windowArgs };
    if (slowmo > 0) launchOpts.slowMo = slowmo * 20;
    browser = await chromium.launch(launchOpts);
    activeBrowsers.push(browser);

    const viewportWidth = isParallel ? windowWidth - 20 : 1280;
    const viewportHeight = isParallel ? windowHeight - 100 : 720;
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

    await setupClickVisualizer(context, recordingStartTime);
    await applyThrottling(page, throttle, id);

    if (profile) {
      await browser.startTracing(page, { screenshots: true, categories: ['devtools.timeline'] });
    }

    const result = await runMarkerMode(page, context, config, barriers, isParallel, sharedState, recordingStartTime);
    const markerSegments = result?.segments || [];
    const measurements = result?.measurements || [];

    let tracePath = null;
    if (profile) {
      const traceBuffer = await browser.stopTracing();
      tracePath = path.join(outputDir, `${id}.trace.json`);
      fs.writeFileSync(tracePath, traceBuffer);
      console.error(`[${id}] Performance trace saved: ${tracePath}`);
    }

    // Adjust click timestamps to match trimmed video segments
    const clickEvents = await getClickEvents(page);
    let adjustedClicks;
    if (markerSegments.length > 0) {
      adjustedClicks = [];
      let offset = 0;
      for (const seg of markerSegments) {
        for (const evt of clickEvents) {
          if (evt.timestamp >= seg.start && evt.timestamp <= seg.end) {
            adjustedClicks.push({ ...evt, timestamp: offset + (evt.timestamp - seg.start) });
          }
        }
        offset += seg.end - seg.start;
      }
    } else {
      adjustedClicks = clickEvents;
    }

    await context.close();
    activeContexts = activeContexts.filter(c => c !== context);
    context = null;
    console.error(`[${id}] Context closed`);

    let fullVideoFile = null;
    if (markerSegments.length > 0) {
      const videoFile = getMostRecentVideo(outputDir);
      if (videoFile) {
        const videoPath = path.join(outputDir, videoFile);
        // Use visual cue detection for frame-accurate trimming
        const { startCues, endCues, frameDuration } = detectCueFrames(videoPath);
        const segments = cueSegments(startCues, endCues, frameDuration);
        const trimSegments = segments.length > 0 ? segments : markerSegments;
        const res = extractSegments(videoPath, trimSegments, id);
        fullVideoFile = path.basename(res.fullPath);
      }
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
    error: error ? error.message : null
  };
}

// --- Execution modes ---

async function runParallel(browser1Config, browser2Config, throttle, profile, slowmo) {
  const sharedState = { hasError: false, errorMessage: null, finishOrder: [] };
  const barriers = {
    ready: new SyncBarrier(2, sharedState),
    recordingStart: new SyncBarrier(2, sharedState),
    stop: new SyncBarrier(2, sharedState)
  };

  const results = await Promise.allSettled([
    runBrowserRecording(browser1Config, barriers, true, sharedState, 0, throttle, profile, slowmo),
    runBrowserRecording(browser2Config, barriers, true, sharedState, 1, throttle, profile, slowmo)
  ]);

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const id = i === 0 ? browser1Config.id : browser2Config.id;
    return { id, videoPath: null, error: r.reason?.message || 'Unknown error' };
  });
}

async function runSequential(browser1Config, browser2Config, throttle, profile, slowmo) {
  const sharedState = { hasError: false, errorMessage: null, finishOrder: [] };
  const r1 = await runBrowserRecording(browser1Config, null, false, sharedState, 0, throttle, profile, slowmo);
  const r2 = await runBrowserRecording(browser2Config, null, false, sharedState, 1, throttle, profile, slowmo);
  return [r1, r2];
}

// --- Main entry point ---

async function main() {
  const configJson = process.argv[2];
  if (!configJson) { console.error('Error: Config JSON required'); process.exit(1); }

  let config;
  try { config = JSON.parse(configJson); }
  catch (e) { console.error('Error: Invalid JSON:', e.message); process.exit(1); }

  const { browser1, browser2, executionMode, throttle, headless, profile, slowmo } = config;
  browser1.headless = headless || false;
  browser2.headless = headless || false;

  fs.mkdirSync(path.join(__dirname, 'recordings'), { recursive: true });

  let results;
  try {
    results = executionMode === 'parallel'
      ? await runParallel(browser1, browser2, throttle, profile, slowmo)
      : await runSequential(browser1, browser2, throttle, profile, slowmo);
  } catch (error) {
    results = [
      { id: browser1.id, videoPath: null, error: error.message },
      { id: browser2.id, videoPath: null, error: error.message }
    ];
  }

  const errors = results.filter(r => r.error).map(r => `${r.id}: ${r.error}`);

  console.log(JSON.stringify({
    browser1Video: results[0]?.videoPath || null,
    browser2Video: results[1]?.videoPath || null,
    browser1FullVideo: results[0]?.fullVideoPath || null,
    browser2FullVideo: results[1]?.fullVideoPath || null,
    browser1Trace: results[0]?.tracePath || null,
    browser2Trace: results[1]?.tracePath || null,
    browser1ClickEvents: results[0]?.clickEvents || [],
    browser2ClickEvents: results[1]?.clickEvents || [],
    browser1Measurements: results[0]?.measurements || [],
    browser2Measurements: results[1]?.measurements || [],
    errors: errors.length > 0 ? errors : undefined
  }));

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  console.log(JSON.stringify({ browser1Video: null, browser2Video: null, errors: [err.message] }));
  process.exit(1);
});
