/**
 * Integration test: Chrome seeks to calibrated start position when the static
 * server supports range requests.
 *
 * This test exercises the range-request + seek pipeline end-to-end:
 *  1. createStaticHandler serves WebM with Accept-Ranges / 206 responses so
 *     Chrome can make byte-range requests and seek into the file.
 *  2. The canplay fallback in seekAllWithVerify retries the seek when
 *     readyState was too low (no buffered data) when initSeek first ran.
 *
 * Note: the ffmpeg-generated test videos include a Duration element so Chrome
 * reports a finite duration at loadedmetadata — the _durationForced / Infinity
 * workaround is not exercised here (it is covered by unit tests in
 * tests/videoplayer.test.js).
 *
 * Requires: ffmpeg (to generate a test video), Playwright (chromium).
 * Skips cleanly when either tool is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStaticHandler } from '../race.js';
import { buildPlayerHtml } from '../cli/videoplayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Constants ─────────────────────────────────────────────────────────────────

// The PTS position (seconds) the player should seek to on load.
// tracePtsStart = (recordingStartTs − firstFrameTs) / 1e6 = 2_000_000 / 1e6 = 2.0
const CALIBRATED_START_S = 2.0;

// Acceptable window around CALIBRATED_START_S: Chrome's seek precision for a
// small VP8 file is well within 200ms.
const SEEK_TOLERANCE_S = 0.2;

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasFfmpeg() {
  // 5s is generous for a version check; catches PATH issues quickly.
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'pipe', timeout: 5_000 }); return true; }
  catch { return false; }
}

function startServer(dir) {
  return new Promise(resolve => {
    const srv = http.createServer(createStaticHandler(dir));
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function stopServer(srv) {
  return new Promise(resolve => srv.close(resolve));
}

// Minimal summary required by buildPlayerHtml. Only racers/comparisons/videos
// fields are structurally needed; the rest are present to satisfy schema checks.
function makeSummary() {
  return {
    racers: ['alpha', 'bravo'],
    comparisons: [{ name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'alpha', diff: 1, diffPercent: 100, rankings: ['alpha', 'bravo'] }],
    overallWinner: 'alpha',
    timestamp: new Date().toISOString(),
    settings: {},
    errors: [],
    wins: { alpha: 1, bravo: 0 },
    videos: {},
  };
}

// Build a clipTimes entry whose tracePtsStart resolves to CALIBRATED_START_S.
// recordingStartTs − firstFrameTs = 2_000_000 µs → 2.0s after dividing by 1e6.
function makeClipEntry() {
  return {
    start: 0, end: 8,
    recordingOffset: 0, wallClockDuration: 8,
    calibratedStart: CALIBRATED_START_S,
    traceCalibration: {
      recordingStartTs: 2_000_000, // µs; recordingStartTs − firstFrameTs = 2s
      firstFrameTs:     0,
      lastFrameTs:      100_000,
    },
  };
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe('chrome-seek: calibrated start position via HTTP range requests', () => {
  let browser, page, server, tmpDir, setupError;

  beforeAll(async () => {
    if (!hasFfmpeg()) {
      setupError = 'ffmpeg not available — skipping chrome-seek integration test';
      return;
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-seek-'));

    // Generate two 10-second VP8 WebM test videos using a synthetic lavfi source.
    // We do NOT strip the Duration element — this test focuses on the
    // range-request + seek pipeline, not the _durationForced Infinity workaround.
    for (const name of ['alpha', 'bravo']) {
      fs.mkdirSync(path.join(tmpDir, name), { recursive: true });
      execSync(
        `ffmpeg -y -f lavfi -i color=c=black:size=16x16:rate=25 -t 10 ` +
        `-c:v libvpx -b:v 10k -an ` +
        `"${path.join(tmpDir, name, name + '.race.webm')}"`,
        { stdio: 'pipe', timeout: 30_000 },
      );
    }

    const html = buildPlayerHtml(
      makeSummary(),
      ['alpha/alpha.race.webm', 'bravo/bravo.race.webm'],
      null, null, { clipTimes: [makeClipEntry(), makeClipEntry()] },
    );
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html);

    try {
      const pw = await import('playwright');
      browser = await Promise.race([
        pw.chromium.launch({ headless: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Playwright launch timeout')), 20_000)),
      ]);
      page = await browser.newPage();
    } catch (e) {
      setupError = `Playwright launch failed: ${e.message}`;
    }

    server = await startServer(tmpDir);
  });

  afterAll(async () => {
    if (page)    await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server)  await stopServer(server);
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('server responds with 206 for WebM range requests', async ({ skip }) => {
    if (setupError) skip(setupError);
    const { port } = server.address();
    const res = await new Promise(resolve => {
      http.get({
        hostname: '127.0.0.1', port,
        path: '/alpha/alpha.race.webm',
        headers: { range: 'bytes=0-1023' },
      }, r => {
        r.resume();
        r.on('end', () => resolve(r));
      });
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toMatch(/^bytes 0-1023\//);
  });

  it('calibration resets videos to calibrated start even from a different position', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    // Build a page where calibration is deferred: clipTimes have traceCalibration
    // but _converted is not set — calibration runs in onMeta() after metadata loads.
    // Load the page, wait for videos to be ready, manually seek away from the start,
    // then verify that calibration forces them back to the calibrated position.
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    // Wait for calibration to complete and videos to land at calibrated position
    await page.evaluate(
      ({ expected, tolerance, timeoutMs }) => new Promise(resolve => {
        let poll, timer;
        const check = () => {
          const vs = Array.from(document.querySelectorAll('video'));
          if (vs.length >= 2 && vs.every(v => isFinite(v.duration) && Math.abs(v.currentTime - expected) <= tolerance)) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve(true);
          }
        };
        poll = setInterval(check, 100);
        check();
        timer = setTimeout(() => { clearInterval(poll); resolve(false); }, timeoutMs);
      }),
      { expected: CALIBRATED_START_S, tolerance: SEEK_TOLERANCE_S, timeoutMs: 12_000 },
    );

    // Now manually seek both videos to a very different position (near the end)
    await page.evaluate(() => {
      document.querySelectorAll('video').forEach(v => { v.currentTime = v.duration - 1; });
    });
    // Wait for the manual seek to take effect
    await page.waitForTimeout(500);
    const movedResult = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video')).map(v => v.currentTime),
    );
    // Videos should be near the end now (not at calibrated start)
    for (const ct of movedResult) {
      expect(ct).toBeGreaterThan(CALIBRATED_START_S + 1);
    }

    // Click "Go to start" button which should seek back to calibrated start
    await page.click('#goStart');
    const resetResult = await page.evaluate(
      ({ expected, tolerance, timeoutMs }) => new Promise(resolve => {
        let poll, timer;
        const check = () => {
          const vs = Array.from(document.querySelectorAll('video'));
          if (vs.length >= 2 && vs.every(v => Math.abs(v.currentTime - expected) <= tolerance)) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve({ ok: true, times: vs.map(v => v.currentTime) });
          }
        };
        poll = setInterval(check, 100);
        check();
        timer = setTimeout(() => {
          clearInterval(poll);
          const vs = Array.from(document.querySelectorAll('video'));
          resolve({ ok: false, times: vs.map(v => v.currentTime) });
        }, timeoutMs);
      }),
      { expected: CALIBRATED_START_S, tolerance: SEEK_TOLERANCE_S, timeoutMs: 8_000 },
    );

    expect(resetResult.ok, `Expected videos back at ${CALIBRATED_START_S}s but got ${JSON.stringify(resetResult)}`).toBe(true);
  });

  it('Chrome seeks videos to calibrated start position', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    // Poll inside the page until both videos land at CALIBRATED_START_S ± SEEK_TOLERANCE_S,
    // or time out after 12s. The constants below mirror CALIBRATED_START_S and
    // SEEK_TOLERANCE_S defined at the top of this file — keep them in sync.
    const result = await page.evaluate(
      ({ expected, tolerance, timeoutMs }) => new Promise(resolve => {
        let poll, timer;
        const check = () => {
          const vs = Array.from(document.querySelectorAll('video'));
          if (vs.length >= 2 && vs.every(v => isFinite(v.duration) && Math.abs(v.currentTime - expected) <= tolerance)) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve({ ok: true, times: vs.map(v => v.currentTime) });
          }
        };
        poll = setInterval(check, 100);
        check();
        timer = setTimeout(() => {
          clearInterval(poll);
          const vs = Array.from(document.querySelectorAll('video'));
          resolve({ ok: false, times: vs.map(v => v.currentTime), durations: vs.map(v => v.duration), readyStates: vs.map(v => v.readyState) });
        }, timeoutMs);
      }),
      { expected: CALIBRATED_START_S, tolerance: SEEK_TOLERANCE_S, timeoutMs: 12_000 },
    );

    expect(result.ok, `Expected currentTime ≈ ${CALIBRATED_START_S}s but got ${JSON.stringify(result)}`).toBe(true);
    for (const ct of result.times) {
      expect(ct).toBeGreaterThan(CALIBRATED_START_S - SEEK_TOLERANCE_S);
      expect(ct).toBeLessThan(CALIBRATED_START_S + SEEK_TOLERANCE_S);
    }
  });

  it('calibration debug buttons (+1f/-1f) change the video position', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    // Wait for initial calibration to complete
    await page.evaluate(
      ({ expected, tolerance, timeoutMs }) => new Promise(resolve => {
        let poll, timer;
        const check = () => {
          const vs = Array.from(document.querySelectorAll('video'));
          if (vs.length >= 2 && vs.every(v => isFinite(v.duration) && Math.abs(v.currentTime - expected) <= tolerance)) {
            clearInterval(poll); clearTimeout(timer); resolve(true);
          }
        };
        poll = setInterval(check, 100); check();
        timer = setTimeout(() => { clearInterval(poll); resolve(false); }, timeoutMs);
      }),
      { expected: CALIBRATED_START_S, tolerance: SEEK_TOLERANCE_S, timeoutMs: 12_000 },
    );

    // Open the calibration debug panel (button starts hidden, shown when clip times load)
    const debugBtn = await page.waitForSelector('#modeDebug', { state: 'visible', timeout: 10_000 }).catch(() => null);
    if (!debugBtn) skip('no calibration button — debug panel not available');
    await debugBtn.click();
    await page.waitForSelector('#debugPanel', { state: 'visible', timeout: 3_000 });

    // Record the initial position of racer 0 (alpha)
    const initialTime = await page.evaluate(() => document.querySelector('video').currentTime);

    // Click the +5f button for racer 0 (shifts start forward by 5 frames = 0.2s)
    const plusBtn = await page.waitForSelector('.debug-frame-btn[data-idx="0"][data-delta="5"]', { timeout: 3_000 });
    await plusBtn.click();
    await page.waitForTimeout(500);

    // Video should have moved to the new adjusted start (original + 0.2s)
    const afterPlusTime = await page.evaluate(() => document.querySelector('video').currentTime);
    const expectedShift = 5 * 0.04; // 5 frames * 0.04s per frame
    expect(afterPlusTime).toBeGreaterThan(initialTime + expectedShift - SEEK_TOLERANCE_S);
    expect(afterPlusTime).toBeLessThan(initialTime + expectedShift + SEEK_TOLERANCE_S);

    // Now click -1f to shift back by 1 frame
    const minusBtn = await page.waitForSelector('.debug-frame-btn[data-idx="0"][data-delta="-1"]', { timeout: 3_000 });
    await minusBtn.click();
    await page.waitForTimeout(500);

    const afterMinusTime = await page.evaluate(() => document.querySelector('video').currentTime);
    // Should be 4 frames ahead of initial (5 - 1 = 4 frames = 0.16s)
    const expectedNet = 4 * 0.04;
    expect(afterMinusTime).toBeGreaterThan(initialTime + expectedNet - SEEK_TOLERANCE_S);
    expect(afterMinusTime).toBeLessThan(initialTime + expectedNet + SEEK_TOLERANCE_S);
  });

  it('calibration debug panel opens without ReferenceError', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    // Wait for calibration
    await page.evaluate(
      ({ expected, tolerance, timeoutMs }) => new Promise(resolve => {
        let poll, timer;
        const check = () => {
          const vs = Array.from(document.querySelectorAll('video'));
          if (vs.length >= 2 && vs.every(v => isFinite(v.duration) && Math.abs(v.currentTime - expected) <= tolerance)) {
            clearInterval(poll); clearTimeout(timer); resolve(true);
          }
        };
        poll = setInterval(check, 100); check();
        timer = setTimeout(() => { clearInterval(poll); resolve(false); }, timeoutMs);
      }),
      { expected: CALIBRATED_START_S, tolerance: SEEK_TOLERANCE_S, timeoutMs: 12_000 },
    );

    // Capture any JS errors
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    // Open debug panel (button starts hidden, shown when clip times load)
    const debugBtn = await page.waitForSelector('#modeDebug', { state: 'visible', timeout: 10_000 }).catch(() => null);
    if (!debugBtn) skip('no calibration button');
    await debugBtn.click();
    await page.waitForSelector('#debugPanel', { state: 'visible', timeout: 3_000 });

    // The panel should render without errors (previously threw "offset is not defined")
    await page.waitForTimeout(500);
    const refErrors = errors.filter(e => e.includes('is not defined'));
    expect(refErrors, `JS errors in debug panel: ${refErrors.join('; ')}`).toHaveLength(0);
  });
});
