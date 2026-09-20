/**
 * Integration test: the player's presentation modes on a real recording.
 *
 *  - the segment picker keeps "Whole Recording" through a racer-filter click
 *  - the Merged button toggles back to the racer videos
 *  - an exported page keeps the trace calibration its segment picker needs
 *
 * The recording is made by Playwright and served over HTTP, as in
 * clip-playback.test.js. Skips when Chromium is not installed.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { hasChromiumInstalled, recordSampleVideo, serveDirectory, readZipEntries } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RACERS = ['a', 'b', 'c'];
const videoFiles = RACERS.map(n => `${n}/${n}.race.webm`);

// Trace timestamps are microseconds. Recording starts 0.3s after the first
// captured frame, so the calibrated race clip runs 0.3s–1.2s of video.
const FIRST_FRAME_TS = 1_000_000;
const REC_START_TS = 1_300_000;
const CLIP = { start: 0.5, end: 1.4 }; // wall-clock seconds; 0.9s long
// Two measured sections (the picker lists them only when there is more than one).
const LOAD = { start: 1_400_000, end: 1_800_000 };    // 0.4s–0.8s of video
const RENDER = { start: 1_900_000, end: 2_100_000 };  // 0.9s–1.1s of video
const clipEntry = () => ({
  ...CLIP,
  traceCalibration: { firstFrameTs: FIRST_FRAME_TS, recordingStartTs: REC_START_TS },
  measurements: [
    { name: 'Load', startTime: 0.6, endTime: 1.0, startTraceTs: LOAD.start, endTraceTs: LOAD.end },
    { name: 'Render', startTime: 1.1, endTime: 1.3, startTraceTs: RENDER.start, endTraceTs: RENDER.end },
  ],
});

let browser, context, page, server, baseUrl, tmpDir;

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

const summary = () => ({
  racers: RACERS, comparisons: [], overallWinner: null,
  timestamp: new Date().toISOString(), settings: {}, errors: [], wins: {}, videos: {},
});

/** Open a player page and wait until every video has metadata and the picker is built. */
async function openPlayer(url) {
  const pg = await context.newPage();
  await pg.goto(url);
  await pg.waitForFunction(
    () => [...document.querySelectorAll('video')].every(v => v.readyState >= 1)
      && document.getElementById('segmentNav').options.length > 2,
    null,
    { timeout: 20000 }
  );
  return pg;
}

const pickSegment = (pg, value) => pg.evaluate((value) => {
  const nav = document.getElementById('segmentNav');
  nav.value = value;
  nav.dispatchEvent(new Event('change'));
  return document.getElementById('timeDisplay').textContent;
}, value);

/** The clip length the time display shows, in seconds (its "m:ss.mmm" floors the millisecond). */
const clipLength = async (pg) => {
  const shown = await pg.evaluate(() => document.getElementById('timeDisplay').textContent.split(' / ')[1]);
  const [m, s] = shown.split(':');
  return Number(m) * 60 + Number(s);
};

describeMaybe('player modes', () => {
  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'player-modes-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    await recordRacerVideos();
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      buildPlayerHtml(summary(), videoFiles, null, null, {
        clipTimes: RACERS.map(clipEntry),
        mergedVideoFile: videoFiles[0],
      })
    );
    ({ server, url: baseUrl } = await serveDirectory(tmpDir));
    page = await openPlayer(baseUrl);
  }, 90000);

  afterAll(async () => {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise(r => server.close(r));
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('plays a measured section as its own clip', async () => {
    await pickSegment(page, 'Load');
    expect(await clipLength(page)).toBeCloseTo(0.4, 2);
    await pickSegment(page, 'Render');
    expect(await clipLength(page)).toBeCloseTo(0.2, 2);
    await pickSegment(page, '__all__');
    expect(await clipLength(page)).toBeCloseTo(0.9, 2);
  });

  it('plays a measured section of a race that has no trace calibration', async () => {
    // Without a usable trace the runner reports the race API's own clock for
    // both the segments and the measurements. The picker offered those
    // sections but could not place them, so choosing one played the whole
    // recording from the start instead of the section.
    const markerClip = () => ({
      ...CLIP,
      measurements: [
        { name: 'Load', startTime: 0.6, endTime: 1.0 },
        { name: 'Render', startTime: 1.1, endTime: 1.3 },
      ],
    });
    fs.mkdirSync(path.join(tmpDir, 'markers'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'markers', 'index.html'),
      buildPlayerHtml(summary(), videoFiles.map(v => `../${v}`), null, null, {
        clipTimes: RACERS.map(markerClip),
      })
    );

    const markerPage = await openPlayer(`${baseUrl}markers/index.html`);
    try {
      await pickSegment(markerPage, 'Load');
      expect(await clipLength(markerPage)).toBeCloseTo(0.4, 2);
      await pickSegment(markerPage, 'Render');
      expect(await clipLength(markerPage)).toBeCloseTo(0.2, 2);
      await pickSegment(markerPage, '__all__');
      expect(await clipLength(markerPage)).toBeCloseTo(0.9, 2);
    } finally {
      await markerPage.close().catch(() => {});
    }
  });

  it('keeps Whole Recording selected when a racer is filtered out', async () => {
    await pickSegment(page, '__full__');
    const whole = await clipLength(page);
    expect(whole).toBeGreaterThan(1.5); // the whole recording, not the 0.9s clip

    // Hide the third racer. The picker still says Whole Recording, so the
    // window must not snap back to the race clip.
    const after = await page.evaluate(() => {
      document.querySelectorAll('#racerFilter .racer-filter-btn')[2].click();
      return {
        segment: document.getElementById('segmentNav').value,
      };
    });
    expect(after.segment).toBe('__full__');
    expect(await clipLength(page)).toBeCloseTo(whole, 2);

    // Restore for the tests that follow.
    await page.evaluate(() => document.querySelectorAll('#racerFilter .racer-filter-btn')[2].click());
    await pickSegment(page, '__all__');
  });

  it('toggles the Merged view back to the racer videos', async () => {
    const shown = () => page.evaluate(() => ({
      racers: getComputedStyle(document.getElementById('playerContainer')).display !== 'none',
      merged: getComputedStyle(document.getElementById('mergedContainer')).display !== 'none',
      active: document.getElementById('modeMerged').classList.contains('active'),
    }));

    // The button sits in the collapsed settings panel, so click it directly.
    const clickMerged = () => page.evaluate(() => document.getElementById('modeMerged').click());

    await clickMerged();
    expect(await shown()).toEqual({ racers: false, merged: true, active: true });

    await clickMerged();
    expect(await shown()).toEqual({ racers: true, merged: false, active: false });
  });

  it('exports a page whose segment picker still finds the measured sections', async () => {
    // Export Zip keeps the segment picker (the slim HTML export drops it).
    await page.click('#shareToggle');
    await page.click('#exportHtmlBtn');
    const link = await page.waitForSelector('.export-actions a[download]', { timeout: 60000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      link.click(),
    ]);
    const html = readZipEntries(fs.readFileSync(await download.path())).find(e => e.name === 'index.html').data.toString('utf8');

    const config = JSON.parse(html.match(/<script id="race-config" type="application\/json">(.*?)<\/script>/s)[1]);
    for (const ct of config.clipTimes) {
      expect(ct.traceCalibration.firstFrameTs).toBe(FIRST_FRAME_TS);
      expect(ct.traceCalibration.recordingStartTs).toBe(REC_START_TS);
    }

    fs.mkdirSync(path.join(tmpDir, 'export'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'export', 'index.html'), html);
    const exported = await openPlayer(`${baseUrl}export/index.html`);
    try {
      await exported.waitForFunction(
        () => [...document.querySelectorAll('video')].every(v => v.src.startsWith('blob:') && v.readyState >= 1),
        null,
        { timeout: 20000 }
      );
      await pickSegment(exported, 'Load');
      expect(await clipLength(exported)).toBeCloseTo(0.4, 2);
    } finally {
      await exported.close().catch(() => {});
    }
  });
});
