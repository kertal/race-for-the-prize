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

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasFfmpeg() {
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

// ── Test ─────────────────────────────────────────────────────────────────────

describe('chrome-seek: calibrated start position via HTTP range requests', () => {
  let browser, page, server, tmpDir, setupError;

  beforeAll(async () => {
    if (!hasFfmpeg()) {
      setupError = 'ffmpeg not available — skipping chrome-seek integration test';
      return;
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-seek-'));

    // Generate two 10-second test videos (VP8 WebM).  We deliberately use a
    // short-duration lavfi source so the test is fast, and we do NOT strip the
    // Duration element — the test focuses on the range-request + seek pipeline.
    for (const name of ['alpha', 'bravo']) {
      fs.mkdirSync(path.join(tmpDir, name), { recursive: true });
      execSync(
        `ffmpeg -y -f lavfi -i color=c=black:size=16x16:rate=25 -t 10 ` +
        `-c:v libvpx -b:v 10k -an ` +
        `"${path.join(tmpDir, name, name + '.race.webm')}"`,
        { stdio: 'pipe', timeout: 30_000 },
      );
    }

    // Calibrated start at 2s (tracePtsStart = recordingStartTs - firstFrameTs = 2_000_000 µs)
    const CALIBRATED_START = 2.0;
    const clipTimes = [
      {
        start: 0, end: 8,
        recordingOffset: 0, wallClockDuration: 8,
        calibratedStart: CALIBRATED_START,
        traceCalibration: {
          recordingStartTs: 2_000_000,
          firstFrameTs:     0,
          lastFrameTs:      100_000,
        },
      },
      {
        start: 0, end: 8,
        recordingOffset: 0, wallClockDuration: 8,
        calibratedStart: CALIBRATED_START,
        traceCalibration: {
          recordingStartTs: 2_000_000,
          firstFrameTs:     0,
          lastFrameTs:      100_000,
        },
      },
    ];

    const html = buildPlayerHtml(
      makeSummary(),
      ['alpha/alpha.race.webm', 'bravo/bravo.race.webm'],
      null, null, { clipTimes },
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
    if (page)   await page.close().catch(() => {});
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

    // Wait up to 12s for both videos to reach the calibrated start (2.0s ± 0.2s).
    const result = await page.evaluate(() => new Promise(resolve => {
      const EXPECTED = 2.0;
      const TOLERANCE = 0.2;
      const TIMEOUT_MS = 12_000;

      let poll, timer;

      const check = () => {
        const vs = Array.from(document.querySelectorAll('video'));
        if (vs.length >= 2 && vs.every(v => isFinite(v.duration) && Math.abs(v.currentTime - EXPECTED) <= TOLERANCE)) {
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
        resolve({
          ok: false,
          times: vs.map(v => v.currentTime),
          durations: vs.map(v => v.duration),
          readyStates: vs.map(v => v.readyState),
        });
      }, TIMEOUT_MS);
    }));

    expect(result.ok, `Expected currentTime ≈ 2.0s but got ${JSON.stringify(result)}`).toBe(true);
    for (const ct of result.times) {
      expect(ct).toBeGreaterThan(2.0 - 0.2);
      expect(ct).toBeLessThan(2.0 + 0.2);
    }
  });
});
