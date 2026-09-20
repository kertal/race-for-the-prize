import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export function hasChromiumInstalled(projectRoot) {
  const check = spawnSync(
    'node',
    [
      '-e',
      "const { chromium } = require('playwright'); const fs = require('fs'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);",
    ],
    { cwd: projectRoot, timeout: 10_000 }
  );
  return check.status === 0;
}

export function parseResultsDir(projectRoot, stderrText) {
  const ansiRe = new RegExp('\\u001B\\[[0-9;]*m', 'g');
  const stripped = stderrText.replace(ansiRe, '');
  const match = stripped.match(/📂\s+(.+)/);
  return match ? path.resolve(projectRoot, match[1].trim()) : null;
}

/**
 * Record one short webm with Playwright, the same way the runner records a
 * race, and return its path. The page repaints constantly so the file holds
 * real, distinct frames.
 *
 * @param {import('playwright').Browser} browser
 * @param {string} rawDir - directory the recording lands in
 * @param {number} [durationMs]
 * @returns {Promise<string>} path of the recorded .webm
 */
export async function recordSampleVideo(browser, rawDir, durationMs = 2200) {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 180 },
    recordVideo: { dir: rawDir, size: { width: 320, height: 180 } },
  });
  const page = await ctx.newPage();
  await page.setContent(
    '<body style="margin:0;background:#111"><div id=x style="font:700 64px monospace;color:#0f0"></div>' +
    '<script>let n=0;setInterval(()=>{x.textContent=n++;document.body.style.background="hsl("+(n*9%360)+" 60% 20%)"},33)<\/script></body>'
  );
  await page.waitForTimeout(durationMs);
  await ctx.close();
  const recorded = fs.readdirSync(rawDir).find(f => f.endsWith('.webm'));
  return path.join(rawDir, recorded);
}

/**
 * Serve a directory over HTTP with the media types Chromium needs to decode a
 * recording (it refuses a webm from file://). Resolves to { server, url }.
 */
export function serveDirectory(dir) {
  const types = { '.html': 'text/html', '.webm': 'video/webm' };
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
    });
    res.end(body);
  });
  return new Promise(resolve => server.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}/` })));
}

/** Read the stored (uncompressed) entries of a ZIP produced by the player's export. */
export function readZipEntries(buf) {
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
