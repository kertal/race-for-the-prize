/**
 * Integration test for the condition-matrix film: the overview page assembling
 * every condition into one downloadable video, each race behind an info card
 * carrying that condition's result.
 *
 * Records the film in a real browser (canvas + MediaRecorder) and checks the
 * download is a WebM long enough to hold both cards and both races.
 *
 * Requires: ffmpeg (to generate the recordings and to measure the film) and
 * Playwright (chromium). Skips cleanly when either is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler } from '../race.js';
import { buildConditionIndexHtml } from '../cli/condition-matrix.js';

// The card hold is the runtime's own number, so the length check below can
// never drift from what the film actually does.
const require = createRequire(import.meta.url);
const { CARD_SECONDS } = require('../cli/matrix-runtime/film-plan.cjs');

const RACERS = ['lauda', 'hunt'];
// Each racer's recording is a solid colour, so a frame of the film can say who
// is in it: lauda fills the left slot red, hunt the right slot blue.
const RACER_COLOURS = { lauda: 'red', hunt: 'blue' };
const CONDITIONS = [
  { label: 'none-cpu1x', title: 'Network: none · CPU: 1x', network: 'none', cpu: 1, winner: 'lauda' },
  { label: 'none-cpu4x', title: 'Network: none · CPU: 4x', network: 'none', cpu: 4, winner: 'hunt' },
];
const VIDEO_SECONDS = 1;

function hasFfmpeg() {
  try { execSync('ffmpeg -version', { stdio: 'pipe', timeout: 5_000 }); return true; }
  catch { return false; }
}

/**
 * Decode a video end to end and report its length. MediaRecorder's WebM has no
 * duration in its header, so the last progress line of a full decode — which
 * ffmpeg prints on stderr — is the honest answer.
 */
function decodedSeconds(file) {
  const { stderr } = spawnSync('ffmpeg', ['-i', file, '-f', 'null', '-'], {
    encoding: 'utf-8', timeout: 60_000,
  });
  const times = [...(stderr || '').matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)]
    .map(([, h, m, s]) => Number(h) * 3600 + Number(m) * 60 + Number(s));
  return times.length > 0 ? Math.max(...times) : 0;
}

/** The average colour of one half of the frame at `seconds` into a video, as [r, g, b]. */
function halfColour(file, seconds, half) {
  const x = half === 'left' ? '0' : 'iw/2';
  const { stdout } = spawnSync('ffmpeg', [
    '-ss', String(seconds), '-i', file, '-frames:v', '1',
    '-vf', `crop=iw/2:ih:${x}:0,scale=1:1:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { timeout: 60_000 });
  return [...(stdout || Buffer.alloc(0)).subarray(0, 3)];
}

/** Which of red or blue a colour is closest to, or 'neither' when it is not clearly either. */
function dominantHue([r, g, b]) {
  if (r > g + 60 && r > b + 60) return 'red';
  if (b > r + 60 && b > g + 60) return 'blue';
  return 'neither';
}

function summaryOf(durations, winner) {
  const racers = Object.keys(durations);
  return {
    racers,
    overallWinner: winner,
    comparisons: [{
      name: 'Race',
      isSyntheticTotal: true,
      winner,
      racers: racers.map(name => ({ duration: durations[name] })),
    }],
  };
}

/** Serve `dir` on a free port, resolving to the server and the URL to open. */
function startServer(dir) {
  return new Promise(resolve => {
    const srv = http.createServer(createStaticHandler(dir));
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({ server: srv, url: `http://127.0.0.1:${port}/` });
    });
  });
}

let browser, context, page, server, baseUrl, tmpDir, setupError;

beforeAll(async () => {
  if (!hasFfmpeg()) {
    setupError = 'ffmpeg not available';
    return;
  }

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-film-'));
  const entries = CONDITIONS.map(({ label, title, network, cpu, winner }) => {
    for (const name of RACERS) {
      const dir = path.join(tmpDir, label, name);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name + '.race.webm');
      execSync(
        `ffmpeg -y -f lavfi -i color=c=${RACER_COLOURS[name]}:size=32x32:rate=10 -t ${VIDEO_SECONDS} ` +
        `-c:v libvpx -b:v 20k -an "${file}"`,
        { stdio: 'pipe', timeout: 30_000 },
      );
    }
    return {
      label, title, network, cpu,
      summary: summaryOf({ lauda: cpu, hunt: cpu * 2 }, winner),
      videoFiles: RACERS.map(name => `${name}/${name}.race.webm`),
      clipTimes: null, // recordings are already trimmed, so the film plays them whole
    };
  });

  fs.writeFileSync(
    path.join(tmpDir, 'index.html'),
    buildConditionIndexHtml(RACERS.join(' vs '), entries),
  );

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

  ({ server, url: baseUrl } = await startServer(tmpDir));
}, 120_000);

afterAll(async () => {
  if (page) await page.close().catch(() => {});
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('condition matrix film', () => {
  it('records every condition into one downloadable video', async ({ skip }) => {
    if (setupError) skip(setupError);

    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.click('#filmBtn');

    // Both cards, both races, plus loading — generous room on a slow runner.
    const link = await page.waitForSelector('.film-actions a[download]', { timeout: 120_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      link.click(),
    ]);
    expect(download.suggestedFilename()).toBe('race-film.webm');

    const filmPath = path.join(tmpDir, 'downloaded-film.webm');
    await download.saveAs(filmPath);
    const bytes = fs.readFileSync(filmPath);
    expect(bytes.length).toBeGreaterThan(1_000);
    // EBML magic — a real WebM container, not a stub blob.
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

    // Long enough that both conditions are in there, cards and races alike — a
    // film that skipped its races would stop short of this.
    const expectedSeconds = CONDITIONS.length * (CARD_SECONDS + VIDEO_SECONDS);
    expect(decodedSeconds(filmPath)).toBeGreaterThan(expectedSeconds - 0.5);

    // Both racers made it into the frame: mid-way through the first race, the
    // left slot is lauda's red and the right slot is hunt's blue.
    const midRace = CARD_SECONDS + VIDEO_SECONDS / 2;
    expect(dominantHue(halfColour(filmPath, midRace, 'left'))).toBe('red');
    expect(dominantHue(halfColour(filmPath, midRace, 'right'))).toBe('blue');

    // And the plan the page embeds lists every racer for every condition.
    const planned = await page.evaluate(() => {
      const config = document.getElementById('film-config');
      return config ? JSON.parse(config.textContent).conditions.map(c => c.racers.map(r => r.name)) : null;
    });
    expect(planned).toEqual(CONDITIONS.map(() => RACERS));

    // computeExportLayout(2, 1) — two 640-wide cells plus the label strip.
    const size = await page.evaluate(() => {
      const canvas = document.querySelector('.film-canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });
    expect(size).toEqual({ width: 1280, height: 670 });
  }, 180_000);

  it('offers the film below the matrix', async ({ skip }) => {
    if (setupError) skip(setupError);

    await page.goto(baseUrl, { waitUntil: 'load' });
    const order = await page.evaluate(() => {
      const table = document.querySelector('table');
      const button = document.getElementById('filmBtn');
      if (!table || !button) return null;
      // Node.DOCUMENT_POSITION_FOLLOWING — the button comes after the matrix.
      return { after: Boolean(table.compareDocumentPosition(button) & 4) };
    });
    expect(order).toEqual({ after: true });
  });
});
