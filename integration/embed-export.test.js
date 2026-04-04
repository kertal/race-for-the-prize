/**
 * Integration tests for the two HTML player export modes:
 *
 * 1. Export Zip — self-contained ZIP with embedded-video index.html + bundled
 *    asset files (summary.json, traces, scripts). File links preserved in HTML.
 * 2. Export HTML — slim single .html file with embedded videos. No file links,
 *    no segment nav, no mode toggle. Minimal and portable.
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
    videos: {},
  };
}

function readZipEntries(buf) {
  const entries = [];
  let pos = 0;
  while (pos + 30 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x04034b50) break;
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

/** Wait for videos to load with blob: URLs and readyState >= 1. */
function waitForVideos(pg, count = 2, timeout = 15_000) {
  return pg.evaluate(({ count, timeout }) => new Promise(resolve => {
    let timer;
    const poll = setInterval(() => {
      const vs = Array.from(document.querySelectorAll('video'));
      if (vs.length >= count && vs.every(v => v.readyState >= 1)) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve({ ok: true, count: vs.length, srcs: vs.map(v => v.src.slice(0, 10)), durations: vs.map(v => v.duration) });
      }
    }, 100);
    timer = setTimeout(() => {
      clearInterval(poll);
      const vs = Array.from(document.querySelectorAll('video'));
      resolve({ ok: false, count: vs.length, srcs: vs.map(v => v.src.slice(0, 30)), readyStates: vs.map(v => v.readyState) });
    }, timeout);
  }), { count, timeout });
}

/** Wait for blob: URL videos specifically (for exported pages). */
function waitForBlobVideos(pg, count = 2, timeout = 15_000) {
  return pg.evaluate(({ count, timeout }) => new Promise(resolve => {
    let timer;
    const poll = setInterval(() => {
      const vs = Array.from(document.querySelectorAll('video'));
      if (vs.length >= count && vs.every(v => v.src.startsWith('blob:') && v.readyState >= 1)) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve({ ok: true, count: vs.length, durations: vs.map(v => v.duration) });
      }
    }, 100);
    timer = setTimeout(() => {
      clearInterval(poll);
      const vs = Array.from(document.querySelectorAll('video'));
      resolve({ ok: false, count: vs.length, srcs: vs.map(v => v.src.slice(0, 30)) });
    }, timeout);
  }), { count, timeout });
}

/** Click an export button, wait for export to finish, click download link. */
async function triggerExport(pg, buttonSelector) {
  // Open the share menu first (export buttons are inside a hidden dropdown)
  const shareToggle = await pg.$('#shareToggle');
  if (shareToggle) await shareToggle.click();
  await pg.click(buttonSelector);
  const dlLink = await pg.waitForSelector('.export-actions a[download]', { timeout: 60_000 });
  const [download] = await Promise.all([
    pg.waitForEvent('download', { timeout: 30_000 }),
    dlLink.click(),
  ]);
  return download;
}

// ── Shared setup ──────────────────────────────────────────────────────────────

let browser, context, page, server, tmpDir, setupError;

beforeAll(async () => {
  if (!hasFfmpeg()) {
    setupError = 'ffmpeg not available';
    return;
  }

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-export-'));

  // Generate test videos
  for (const name of ['alpha', 'bravo']) {
    fs.mkdirSync(path.join(tmpDir, name), { recursive: true });
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:size=8x8:rate=10 -t 4 ` +
      `-c:v libvpx -b:v 5k -an "${path.join(tmpDir, name, name + '.race.webm')}"`,
      { stdio: 'pipe', timeout: 30_000 },
    );
  }

  // Create asset files that the ZIP export should bundle
  fs.writeFileSync(path.join(tmpDir, 'summary.json'), JSON.stringify(makeSummary(), null, 2));

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

// ── Export Zip tests ──────────────────────────────────────────────────────────

describe('Export Zip — full export with bundled assets', () => {
  it('ZIP contains index.html with embedded videos and bundled summary.json', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    const vr = await waitForVideos(page);
    expect(vr.ok).toBe(true);

    const download = await triggerExport(page, '#exportHtmlBtn');
    const zipPath = await download.path();
    expect(zipPath).toBeTruthy();

    const entries = readZipEntries(fs.readFileSync(zipPath));
    const entryNames = entries.map(e => e.name);

    // index.html present
    expect(entryNames).toContain('index.html');

    // summary.json bundled as a separate ZIP entry
    expect(entryNames).toContain('summary.json');

    // Videos are NOT separate ZIP entries (embedded in HTML)
    expect(entryNames).not.toContain('alpha/alpha.race.webm');
    expect(entryNames).not.toContain('bravo/bravo.race.webm');

    // HTML has embedded data URIs
    const exportedHtml = entries.find(e => e.name === 'index.html').data.toString('utf8');
    expect(exportedHtml).toContain('src="data:video/webm;base64,');

    // Base64 of source videos is in the HTML
    const alphaB64 = fs.readFileSync(path.join(tmpDir, 'alpha', 'alpha.race.webm')).toString('base64');
    expect(exportedHtml).toContain(alphaB64);
  });

  it('ZIP extracted to disk: HTML has working file links and seekable videos', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await waitForVideos(page);

    const download = await triggerExport(page, '#exportHtmlBtn');
    const zipPath = await download.path();

    // Extract ZIP
    const extractDir = path.join(tmpDir, 'zip-extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    for (const entry of readZipEntries(fs.readFileSync(zipPath))) {
      const dest = path.join(extractDir, entry.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.data);
    }

    expect(fs.existsSync(path.join(extractDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'summary.json'))).toBe(true);

    // Serve and open
    const srv = await startServer(extractDir);
    const pg = await context.newPage();

    try {
      await pg.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'networkidle' });

      // Videos load as blob: URLs and are seekable
      const vr = await waitForBlobVideos(pg);
      expect(vr.ok, `Videos not ready: ${JSON.stringify(vr)}`).toBe(true);
      expect(vr.count).toBe(2);
      for (const dur of vr.durations) {
        expect(dur).toBeGreaterThan(0);
        expect(Number.isFinite(dur)).toBe(true);
      }

      // Player UI works
      const ui = await pg.evaluate(() => ({
        hasPlayBtn: !!document.getElementById('playBtn'),
        hasScrubber: !!document.getElementById('scrubber'),
        hasExportBtn: !!document.getElementById('exportBtn'),
        hasExportHtmlBtn: !!document.getElementById('exportHtmlBtn'),
      }));
      expect(ui.hasPlayBtn).toBe(true);
      expect(ui.hasScrubber).toBe(true);
      expect(ui.hasExportBtn).toBe(false);
      expect(ui.hasExportHtmlBtn).toBe(false);

      // Seeking works
      const seekOk = await pg.evaluate(() => {
        const v = document.querySelector('video');
        return new Promise(resolve => {
          const target = Math.min(1.0, v.duration / 2);
          v.currentTime = target;
          v.addEventListener('seeked', () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 5000);
        });
      });
      expect(seekOk).toBe(true);
    } finally {
      await pg.close().catch(() => {});
      await stopServer(srv);
    }
  });
});

// ── Export HTML tests ─────────────────────────────────────────────────────────

describe('Export HTML — slim single-file export', () => {
  it('produces a single HTML file with embedded videos and no file links', async ({ skip }) => {
    if (setupError) skip(setupError);

    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await waitForVideos(page);

    const download = await triggerExport(page, '#exportHtmlOnlyBtn');
    const dlPath = await download.path();
    expect(dlPath).toBeTruthy();

    const html = fs.readFileSync(dlPath, 'utf8');

    // Single HTML file
    expect(html).toContain('<!DOCTYPE html>');

    // Embedded video data URIs
    expect(html).toContain('data:video/webm;base64,');

    // No file-links section (slim mode)
    expect(html).not.toContain('class="file-links"');

    // No segment navigation or mode toggle
    expect(html).not.toContain('id="segmentNav"');
    expect(html).not.toContain('class="mode-toggle"');

    // No export buttons
    expect(html).not.toContain('id="exportHtmlBtn"');
    expect(html).not.toContain('id="exportHtmlOnlyBtn"');
    expect(html).not.toContain('id="exportBtn"');

    // Store for next test
    fs.writeFileSync(path.join(tmpDir, 'slim.html'), html);
  });

  it('slim HTML works standalone: videos seekable, no file links in DOM', async ({ skip }) => {
    if (setupError) skip(setupError);

    const slimPath = path.join(tmpDir, 'slim.html');
    if (!fs.existsSync(slimPath)) skip('slim.html not produced by previous test');

    const slimDir = path.join(tmpDir, 'slim-served');
    fs.mkdirSync(slimDir, { recursive: true });
    fs.copyFileSync(slimPath, path.join(slimDir, 'index.html'));

    const srv = await startServer(slimDir);
    const pg = await context.newPage();

    try {
      await pg.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'networkidle' });

      // Videos resolve to blob: URLs
      const vr = await waitForBlobVideos(pg);
      expect(vr.ok, `Videos not ready: ${JSON.stringify(vr)}`).toBe(true);
      expect(vr.count).toBe(2);
      for (const dur of vr.durations) {
        expect(dur).toBeGreaterThan(0);
      }

      // No file-links in the DOM
      const dom = await pg.evaluate(() => ({
        hasFileLinks: !!document.querySelector('.file-links'),
        hasSegmentNav: !!document.querySelector('#segmentNav'),
        hasModeToggle: !!document.querySelector('.mode-toggle'),
        hasPlayBtn: !!document.getElementById('playBtn'),
      }));
      expect(dom.hasFileLinks).toBe(false);
      expect(dom.hasSegmentNav).toBe(false);
      expect(dom.hasModeToggle).toBe(false);
      expect(dom.hasPlayBtn).toBe(true);

      // Seeking works
      const seekOk = await pg.evaluate(() => {
        const v = document.querySelector('video');
        return new Promise(resolve => {
          const target = Math.min(1.0, v.duration / 2);
          v.currentTime = target;
          v.addEventListener('seeked', () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 5000);
        });
      });
      expect(seekOk).toBe(true);
    } finally {
      await pg.close().catch(() => {});
      await stopServer(srv);
    }
  });
});
