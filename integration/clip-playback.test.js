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
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { hasChromiumInstalled, recordSampleVideo, serveDirectory } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RACERS = ['a', 'b'];
const videoFiles = RACERS.map(n => `${n}/${n}.race.webm`);
// Well inside the recording, so playback certainly reaches the end of the clip.
const CLIP_START = 0.3;
const CLIP_END = 1.2;
const clipTimes = [{ start: CLIP_START, end: CLIP_END }, { start: CLIP_START, end: CLIP_END }];

// The finish badge needs a measured section and per-racer totals, which change
// how the clip window resolves — so it gets a page of its own rather than
// shifting the numbers the clamp tests above measure. The wall-clock fields put
// the finish at 0.8s of video: inside the clip, with room to seek either side.
const FINISH_AT = 0.8;
const finishClip = () => ({
  start: CLIP_START,
  end: CLIP_END,
  _wcStart: 1000,
  _wcEnd: 1000 + (CLIP_END - CLIP_START),
  measurements: [{ name: 'Load', startTime: 1000.1, endTime: 1000 + (FINISH_AT - CLIP_START) }],
});
const finishComparisons = [
  { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'a', rankings: RACERS },
];
// One frame of slack: the clamp cannot fire before the frame that overruns.
const FRAME_STEP = 0.04;

let browser, page, server, baseUrl, tmpDir;

const canRun = hasChromiumInstalled(path.resolve(__dirname, '..'));
const describeMaybe = canRun ? describe : describe.skip;

/** One recording, copied in for every racer. */
async function recordRacerVideos() {
  const recorded = await recordSampleVideo(browser, path.join(tmpDir, 'raw'));
  for (const vf of videoFiles) {
    fs.mkdirSync(path.join(tmpDir, path.dirname(vf)), { recursive: true });
    fs.copyFileSync(recorded, path.join(tmpDir, vf));
  }
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
    await recordRacerVideos();
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
    ({ server, url: baseUrl } = await serveDirectory(tmpDir));
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

  describe('finish badge', () => {
    beforeAll(async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'finish.html'),
        buildPlayerHtml(
          {
            racers: RACERS, comparisons: finishComparisons, overallWinner: 'a',
            timestamp: new Date().toISOString(), settings: {}, errors: [], wins: {}, videos: {},
          },
          videoFiles, null, null, { clipTimes: [finishClip(), finishClip()] }
        )
      );
      await page.goto(baseUrl + 'finish.html');
      await page.waitForFunction(
        () => [...document.querySelectorAll('video')].every(v => v.readyState >= 2),
        null,
        { timeout: 20000 }
      );
    }, 30000);

    /** Drive an interaction while sampling the badge every painted frame. */
    const sampleWhile = (action) => page.evaluate(async (action) => {
      const badge = document.getElementById('finishResult0');
      const video = document.querySelectorAll('video')[0];
      const samples = [];
      const started = performance.now();
      const sample = () => {
        samples.push({ hidden: badge.hidden, seeking: video.seeking });
        if (performance.now() - started < 1800) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);

      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      await pause(120);
      if (action === 'step') {
        for (let i = 0; i < 6; i++) { document.getElementById('prevFrame').click(); await pause(120); }
      } else {
        const scrubber = document.getElementById('scrubber');
        for (let i = 0; i < 12; i++) {
          scrubber.value = String(1000 - i * 10);
          scrubber.dispatchEvent(new Event('input', { bubbles: true }));
          await pause(60);
        }
      }
      await pause(700);

      let flips = 0;
      for (let i = 1; i < samples.length; i++) if (samples[i].hidden !== samples[i - 1].hidden) flips++;
      return {
        flips,
        seekingFrames: samples.filter(s => s.seeking).length,
        endHidden: samples[samples.length - 1].hidden,
      };
    }, action);

    /** Play from the clip start through the finish, leaving the badge up. */
    async function playToFinish() {
      await page.evaluate(() => document.getElementById('goStart').click());
      await page.evaluate(() => new Promise(r => setTimeout(r, 250)));
      await page.evaluate(() => document.getElementById('playBtn').click());
      await page.evaluate(() => new Promise(r => setTimeout(r, 1600)));
    }

    const badgeHidden = () => page.evaluate(() => document.getElementById('finishResult0').hidden);

    it('shows once playback passes the finish, and hides again before it', async () => {
      await page.evaluate(() => document.getElementById('goStart').click());
      await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
      expect(await badgeHidden()).toBe(true);

      await playToFinish();
      expect(await badgeHidden()).toBe(false);

      // Seeking back before the finish must still take it down — holding the
      // last answer through a seek must not make the badge sticky.
      await page.evaluate(() => document.getElementById('goStart').click());
      await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
      expect(await badgeHidden()).toBe(true);
    }, 30000);

    it.each(['step', 'scrub'])('does not blink while you %s past it', async (action) => {
      // Regression: the badge was blanked for the whole of every seek, so
      // frame-stepping flickered and a scrub strobed. Worse, a paused seek is
      // followed by no timeupdate, so it could stay gone for good.
      await playToFinish();
      expect(await badgeHidden()).toBe(false);

      const seen = await sampleWhile(action);

      expect(seen.seekingFrames).toBeGreaterThan(0); // the seeks really happened
      expect(seen.flips).toBe(0);
      expect(seen.endHidden).toBe(false);
    }, 30000);
  });
});
