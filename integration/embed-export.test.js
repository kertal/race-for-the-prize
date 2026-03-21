/**
 * Integration test: ZIP export embeds all videos as data URIs in index.html.
 *
 * When the user clicks "Export Zip":
 *  1. Each video file is fetched and converted to a base64 data URI.
 *  2. The data URIs are baked into raceVideoPaths in the exported HTML.
 *  3. No separate video file entries appear in the ZIP.
 *  4. The exported HTML's resolveEmbeddedVideos() converts data URIs to
 *     seekable Blob URLs at runtime.
 *
 * Requires: ffmpeg (to generate test videos), Playwright (chromium).
 * Skips cleanly when either tool is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStaticHandler } from '../race.js';
import { buildPlayerHtml } from '../cli/videoplayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasFfmpeg() {
  try { execSync('ffmpeg -version', { stdio: 'pipe', timeout: 5_000 }); return true; }
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

// Parse ZIP local file headers (stored uncompressed) and return all entries.
function readZipEntries(buf) {
  const entries = [];
  let pos = 0;
  while (pos + 30 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x04034b50) break; // local file header signature
    const fnLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const compressedSize = buf.readUInt32LE(pos + 18);
    const name = buf.subarray(pos + 30, pos + 30 + fnLen).toString('utf8');
    const dataStart = pos + 30 + fnLen + extraLen;
    entries.push({ name, data: buf.subarray(dataStart, dataStart + compressedSize) });
    pos = dataStart + compressedSize;
  }
  return entries;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('embed-export: ZIP export embeds videos in index.html', () => {
  let browser, context, page, server, tmpDir, setupError;

  beforeAll(async () => {
    if (!hasFfmpeg()) {
      setupError = 'ffmpeg not available — skipping embed-export integration test';
      return;
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-export-'));

    // Generate two tiny (~5 KB) 4-second VP8 WebM files using synthetic sources.
    for (const name of ['alpha', 'bravo']) {
      fs.mkdirSync(path.join(tmpDir, name), { recursive: true });
      execSync(
        `ffmpeg -y -f lavfi -i color=c=black:size=8x8:rate=10 -t 4 ` +
        `-c:v libvpx -b:v 5k -an ` +
        `"${path.join(tmpDir, name, name + '.race.webm')}"`,
        { stdio: 'pipe', timeout: 30_000 },
      );
    }

    const html = buildPlayerHtml(
      makeSummary(),
      ['alpha/alpha.race.webm', 'bravo/bravo.race.webm'],
      null, null, {},
    );
    fs.writeFileSync(path.join(tmpDir, 'index.html'), html);

    try {
      const pw = await import('playwright');
      browser = await Promise.race([
        pw.chromium.launch({ headless: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Playwright launch timeout')), 20_000)),
      ]);
      context = await browser.newContext({ acceptDownloads: true });
      page = await context.newPage();
    } catch (e) {
      setupError = `Playwright launch failed: ${e.message}`;
    }

    server = await startServer(tmpDir);
  });

  afterAll(async () => {
    if (page)    await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server)  await stopServer(server);
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ZIP contains index.html with embedded data URIs and no separate video files', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    // Wait for both video elements to receive their Blob URLs from resolveEmbeddedVideos
    await page.waitForFunction(() => {
      const vs = Array.from(document.querySelectorAll('video'));
      return vs.length >= 2 && vs.every(v => v.readyState >= 1);
    }, { timeout: 15_000 });

    // Click Export Zip, wait for the export to finish, then click the download link
    await page.click('#exportHtmlBtn');
    const dlLink = await page.waitForSelector('.export-actions a[download]', { timeout: 60_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      dlLink.click(),
    ]);

    const zipPath = await download.path();
    expect(zipPath, 'download should produce a file').toBeTruthy();

    const zipBuf = fs.readFileSync(zipPath);
    const entries = readZipEntries(zipBuf);
    const entryNames = entries.map(e => e.name);

    // index.html must be present
    const indexEntry = entries.find(e => e.name === 'index.html');
    expect(indexEntry, 'ZIP must contain index.html').toBeTruthy();

    // Video files must NOT be separate ZIP entries — they are embedded in the HTML
    expect(entryNames, 'alpha video should not be a separate ZIP entry')
      .not.toContain('alpha/alpha.race.webm');
    expect(entryNames, 'bravo video should not be a separate ZIP entry')
      .not.toContain('bravo/bravo.race.webm');

    // The exported HTML must contain the embedded data URIs both in the JS config
    // and as <video src> attributes for immediate (no-JS) playback
    const exportedHtml = indexEntry.data.toString('utf8');
    expect(exportedHtml).toContain('src="data:video/webm;base64,');

    // The exact base64 content of both video files must appear in the HTML
    const alphaB64 = fs.readFileSync(path.join(tmpDir, 'alpha', 'alpha.race.webm')).toString('base64');
    const bravoB64 = fs.readFileSync(path.join(tmpDir, 'bravo', 'bravo.race.webm')).toString('base64');
    expect(exportedHtml).toContain(alphaB64);
    expect(exportedHtml).toContain(bravoB64);

    // Store the exported HTML for the next test
    fs.writeFileSync(path.join(tmpDir, 'exported.html'), exportedHtml);
  });

  it('exported HTML converts data URIs to Blob URLs for seekable playback', async ({ skip }) => {
    if (setupError) skip(setupError);

    const exportedPath = path.join(tmpDir, 'exported.html');
    if (!fs.existsSync(exportedPath)) skip('exported.html not produced by previous test');

    // Serve the exported HTML from the same static server and open it
    const { port } = server.address();
    const exportedPage = await context.newPage();
    await exportedPage.goto(`http://127.0.0.1:${port}/exported.html`, { waitUntil: 'networkidle' });

    // resolveEmbeddedVideos() should convert data URIs to blob: URLs asynchronously
    const result = await exportedPage.evaluate(() => new Promise(resolve => {
      let timer;
      const poll = setInterval(() => {
        const vs = Array.from(document.querySelectorAll('video'));
        if (vs.length >= 2 && vs.every(v => v.src.startsWith('blob:'))) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve({ ok: true, srcs: vs.map(v => v.src) });
        }
      }, 100);
      timer = setTimeout(() => {
        clearInterval(poll);
        const vs = Array.from(document.querySelectorAll('video'));
        resolve({ ok: false, srcs: vs.map(v => v.src) });
      }, 15_000);
    }));

    await exportedPage.close().catch(() => {});
    expect(result.ok, `Expected blob: URLs but got ${JSON.stringify(result.srcs)}`).toBe(true);
    for (const src of result.srcs) {
      expect(src).toMatch(/^blob:/);
    }
  });

  it('ZIP extracted to disk produces a fully working standalone player', async ({ skip }) => {
    if (setupError) skip(setupError);

    // Re-download the ZIP (or reuse if already cached from test 1)
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const vs = Array.from(document.querySelectorAll('video'));
      return vs.length >= 2 && vs.every(v => v.readyState >= 1);
    }, { timeout: 15_000 });

    await page.click('#exportHtmlBtn');
    const dlLink2 = await page.waitForSelector('.export-actions a[download]', { timeout: 60_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      dlLink2.click(),
    ]);

    const zipPath = await download.path();
    expect(zipPath).toBeTruthy();

    // Extract ZIP to a fresh directory on disk
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    const zipBuf = fs.readFileSync(zipPath);
    const entries = readZipEntries(zipBuf);
    for (const entry of entries) {
      const dest = path.join(extractDir, entry.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.data);
    }

    // Verify extracted files exist on disk
    expect(fs.existsSync(path.join(extractDir, 'index.html'))).toBe(true);
    // No separate video files should exist (embedded in HTML)
    expect(fs.existsSync(path.join(extractDir, 'alpha', 'alpha.race.webm'))).toBe(false);
    expect(fs.existsSync(path.join(extractDir, 'bravo', 'bravo.race.webm'))).toBe(false);

    // Serve the extracted directory and open in a new page
    const extractServer = await startServer(extractDir);
    const extractPort = extractServer.address().port;
    const extractPage = await context.newPage();

    try {
      await extractPage.goto(`http://127.0.0.1:${extractPort}/`, { waitUntil: 'networkidle' });

      // Videos should resolve to blob: URLs and become seekable
      const videoResult = await extractPage.evaluate(() => new Promise(resolve => {
        let timer;
        const poll = setInterval(() => {
          const vs = Array.from(document.querySelectorAll('video'));
          if (vs.length >= 2 && vs.every(v => v.src.startsWith('blob:') && v.readyState >= 1)) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve({
              ok: true,
              count: vs.length,
              srcs: vs.map(v => v.src.slice(0, 5)),
              durations: vs.map(v => v.duration),
              readyStates: vs.map(v => v.readyState),
            });
          }
        }, 100);
        timer = setTimeout(() => {
          clearInterval(poll);
          const vs = Array.from(document.querySelectorAll('video'));
          resolve({
            ok: false,
            count: vs.length,
            srcs: vs.map(v => v.src.slice(0, 30)),
            readyStates: vs.map(v => v.readyState),
          });
        }, 15_000);
      }));

      expect(videoResult.ok, `Videos not ready: ${JSON.stringify(videoResult)}`).toBe(true);
      expect(videoResult.count).toBe(2);
      for (const dur of videoResult.durations) {
        expect(dur).toBeGreaterThan(0);
        expect(Number.isFinite(dur)).toBe(true);
      }

      // Verify player UI elements are present and functional
      const uiResult = await extractPage.evaluate(() => {
        const playBtn = document.getElementById('playBtn');
        const scrubber = document.getElementById('scrubber');
        const timeDisplay = document.getElementById('timeDisplay');
        const title = document.querySelector('h1');
        return {
          hasPlayBtn: !!playBtn,
          hasScrubber: !!scrubber,
          hasTimeDisplay: !!timeDisplay,
          titleText: title?.textContent || '',
          // Export buttons should be removed in the exported HTML
          hasExportBtn: !!document.getElementById('exportBtn'),
          hasExportHtmlBtn: !!document.getElementById('exportHtmlBtn'),
        };
      });

      expect(uiResult.hasPlayBtn).toBe(true);
      expect(uiResult.hasScrubber).toBe(true);
      expect(uiResult.hasTimeDisplay).toBe(true);
      expect(uiResult.titleText).toContain('Race');
      // Export buttons should have been stripped from the exported HTML
      expect(uiResult.hasExportBtn).toBe(false);
      expect(uiResult.hasExportHtmlBtn).toBe(false);

      // Verify seeking works (videos are seekable via blob: URLs)
      const seekResult = await extractPage.evaluate(() => {
        const vs = Array.from(document.querySelectorAll('video'));
        return Promise.all(vs.map(v => new Promise(resolve => {
          const target = Math.min(1.0, v.duration / 2);
          v.currentTime = target;
          v.addEventListener('seeked', () => {
            resolve({ seeked: true, currentTime: v.currentTime, target });
          }, { once: true });
          setTimeout(() => resolve({ seeked: false, currentTime: v.currentTime, target }), 5000);
        })));
      });

      for (const s of seekResult) {
        expect(s.seeked, `Video should be seekable`).toBe(true);
        expect(Math.abs(s.currentTime - s.target)).toBeLessThan(0.5);
      }
    } finally {
      await extractPage.close().catch(() => {});
      await stopServer(extractServer);
    }
  });
});
