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

    // Click Export Zip and capture the download
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.click('#exportHtmlBtn'),
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

    // The exported HTML must contain the embedded data URIs in the JS config
    const exportedHtml = indexEntry.data.toString('utf8');
    expect(exportedHtml).toContain('data:video/webm;base64,');

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
});
