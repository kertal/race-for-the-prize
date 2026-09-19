/**
 * Integration test: play a real recording in the player and watch where it
 * stops.
 *
 * The clip-end clamp is a timing question — not "does the code clamp?" but
 * "how late?" — so it needs a real <video> decoding real frames. The videos are
 * recorded by Playwright itself, the same way the runner records a race, and
 * served over HTTP because Chromium refuses to decode a webm from file://.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { hasChromiumInstalled } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RACERS = ['a', 'b'];
const videoFiles = RACERS.map(n => `${n}/${n}.race.webm`);
// Well inside the recording, so playback certainly reaches the end of the clip.
const clipTimes = [{ start: 0.3, end: 1.2 }, { start: 0.3, end: 1.2 }];
const CLIP_END = 1.2;
// One frame of slack: the clamp cannot fire before the frame that overruns.
const FRAME_STEP = 0.04;

let browser, page, server, baseUrl, tmpDir;

const canRun = hasChromiumInstalled(path.resolve(__dirname, '..'));
const describeMaybe = canRun ? describe : describe.skip;

/** Record one short webm with Playwright, and copy it in for every racer. */
async function recordSampleVideos(pw) {
  const rawDir = path.join(tmpDir, 'raw');
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 180 },
    recordVideo: { dir: rawDir, size: { width: 320, height: 180 } },
  });
  const rec = await ctx.newPage();
  // Repaint constantly, so the file holds real distinct frames.
  await rec.setContent(
    '<body style="margin:0;background:#111"><div id=x style="font:700 64px monospace;color:#0f0"></div>' +
    '<script>let n=0;setInterval(()=>{x.textContent=n++;document.body.style.background="hsl("+(n*9%360)+" 60% 20%)"},33)<\/script></body>'
  );
  await rec.waitForTimeout(2200);
  await ctx.close();

  const recorded = fs.readdirSync(rawDir).find(f => f.endsWith('.webm'));
  for (const vf of videoFiles) {
    fs.mkdirSync(path.join(tmpDir, path.dirname(vf)), { recursive: true });
    fs.copyFileSync(path.join(rawDir, recorded), path.join(tmpDir, vf));
  }
  return pw;
}

/** Serve tmpDir, with the media types Chromium needs to decode the recording. */
function startServer() {
  const types = { '.html': 'text/html', '.webm': 'video/webm' };
  server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(tmpDir, rel);
    if (!file.startsWith(tmpDir) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
    });
    res.end(body);
  });
  return new Promise(resolve => server.listen(0, () => resolve(`http://localhost:${server.address().port}/`)));
}

/**
 * Rewind to the clip start, let the seek settle, then play to the end while
 * sampling every painted frame. Sampling has to start after the rewind: the
 * jump back is itself a backwards step, and would look like the defect.
 */
const playToClipEnd = () => page.evaluate(async () => {
  const badge = document.getElementById('frameBadge0');
  const video = document.querySelectorAll('video')[0];
  const settled = () => new Promise(r => setTimeout(r, 250));

  // Calibration is a toggle, so only turn it on when it is off — calling this
  // helper twice must not switch the badges back off.
  if (document.getElementById('debugPanel').style.display !== 'block') {
    document.getElementById('modeDebug').click();
  }
  document.getElementById('goStart').click();
  await settled();

  return new Promise(resolve => {
    const samples = [];
    const started = performance.now();
    const sample = () => {
      samples.push({ currentTime: video.currentTime, badge: badge.textContent });
      if (performance.now() - started < 3000) requestAnimationFrame(sample);
      else resolve(samples);
    };
    requestAnimationFrame(sample);
    document.getElementById('playBtn').click();
  });
});

describeMaybe('clip playback', () => {
  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'clip-playback-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    await recordSampleVideos(pw);
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      buildPlayerHtml(
        {
          racers: RACERS, comparisons: [], overallWinner: 'a',
          timestamp: new Date().toISOString(), settings: {}, errors: [], wins: {}, videos: {},
        },
        videoFiles, null, null, { clipTimes }
      )
    );
    baseUrl = await startServer();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(baseUrl);
    await page.waitForFunction(
      () => [...document.querySelectorAll('video')].every(v => v.readyState >= 2),
      null,
      { timeout: 20000 }
    );
  }, 90000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise(r => server.close(r));
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stops within a frame of the clip end instead of overrunning it', async () => {
    // Regression: the clamp only ran on timeupdate, which Chromium fires about
    // four times a second, so playback sailed a quarter of a second past the
    // clip end and was then yanked back.
    const samples = await playToClipEnd();
    const furthest = Math.max(...samples.map(s => s.currentTime));

    expect(samples.length).toBeGreaterThan(10);
    expect(furthest).toBeLessThanOrEqual(CLIP_END + FRAME_STEP);
    // It did reach the end, rather than the test passing on a stalled video.
    expect(furthest).toBeGreaterThan(CLIP_END - 0.2);
  }, 30000);

  it('does not run the frame badge past the end of the clip', async () => {
    // What the overrun looked like on screen: "clip 41/40" climbing to
    // "clip 46/40", then a jump back to "clip 40/40" — one visible blink at the
    // end of every clip. The clamp runs on the frame clock now, so the counter
    // can still reach one past the total: that is the frame that overran, and
    // it is corrected on the next one.
    const samples = await playToClipEnd();
    const past = samples
      .map(s => /clip\s+(\d+)\/(\d+)/.exec(s.badge))
      .filter(Boolean)
      .map(m => Number(m[1]) - Number(m[2]))
      .filter(over => over > 0);

    expect(Math.max(0, ...past)).toBeLessThanOrEqual(1);
  }, 30000);

  it('settles back by at most a single frame at the clip end', async () => {
    // Clamping on the frame clock cannot pre-empt the frame that overruns, so
    // one frame of correction is inherent and imperceptible. The defect was a
    // jump back of six or more, which read as a blink. The readout itself is
    // deliberately not clamped — calibration nudges racers past the clip
    // boundary, and those positions have to stay readable.
    const samples = await playToClipEnd();
    const frames = samples
      .map(s => /f\s+(\d+)/.exec(s.badge))
      .filter(Boolean)
      .map(m => Number(m[1]));
    const backSteps = frames
      .map((n, i) => (i > 0 ? frames[i - 1] - n : 0))
      .filter(drop => drop > 0);

    expect(frames.length).toBeGreaterThan(10);
    expect(Math.max(0, ...backSteps)).toBeLessThanOrEqual(1);
  }, 30000);
});
