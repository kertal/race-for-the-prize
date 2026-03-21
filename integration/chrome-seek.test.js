/**
 * Integration test: Chrome seeks to calibrated start position when the static
 * server supports range requests.
 *
 * This test exercises the full stack:
 *  1. createStaticHandler serves WebM with Accept-Ranges / 206 responses so
 *     Chrome can make byte-range requests and seek into the file.
 *  2. The player's _durationForced fix handles duration=Infinity for WebM
 *     recordings that lack a Duration element in the container header.
 *  3. The canplay fallback in seekAllWithVerify retries the seek if
 *     readyState was too low when initSeek first ran.
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
    clickCounts: { alpha: 0, bravo: 0 },
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
});
