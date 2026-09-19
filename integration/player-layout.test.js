/**
 * Integration test: measure the player's controls bar in a real browser.
 *
 * The bar packs the transport, the scrubber, two readouts, the speed picker and
 * four action buttons onto one line. Whether that line holds — and whether the
 * scrubber thumb keeps clear of the time readout — is a flex-layout question no
 * assertion on the stylesheet text can answer. So we lay it out and measure it.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { listSkins } from '../cli/skins.js';
import { hasChromiumInstalled } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const summary = {
  racers: ['lauda', 'hunt'],
  comparisons: [],
  overallWinner: 'lauda',
  timestamp: new Date().toISOString(),
  settings: {},
  errors: [],
  wins: {},
  videos: {},
};
const videoFiles = ['lauda/lauda.race.webm', 'hunt/hunt.race.webm'];
// Clip times make the calibration toggle available, so the bar is at its fullest.
const clipTimes = [{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }];

// One row of buttons plus the bar's own padding. Anything taller has wrapped.
const ONE_ROW_MAX_HEIGHT = 56;
// The title band's declared floor, read from the token so a restyle moves both.
const BAND_MIN_HEIGHT = Number.parseFloat(
  /^\s*--header-min-height:\s*([\d.]+)px;/m.exec(
    fs.readFileSync(path.join(__dirname, '..', 'cli', 'tokens.css'), 'utf-8')
  )[1]
);
// The width from which the bar is expected to hold a single row.
const SINGLE_ROW_WIDTH = 860;

let browser, page, tmpDir;

const canRun = hasChromiumInstalled(path.resolve(__dirname, '..'));
const describeMaybe = canRun ? describe : describe.skip;

function writePlayer(name, options) {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const vf of videoFiles) fs.mkdirSync(path.join(dir, path.dirname(vf)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildPlayerHtml(summary, videoFiles, null, null, options));
  return `file://${path.join(dir, 'index.html')}`;
}

/**
 * Put the bar in its worst case — calibration shown, the longest readouts, the
 * thumb parked at the end of the track — then report its height and the
 * smallest horizontal gap between any two controls sharing a line.
 */
const measureBar = () => page.evaluate(() => {
  document.getElementById('modeDebug').style.display = '';
  document.getElementById('timeDisplay').textContent = '0:12.345 / 1:23.456';
  document.getElementById('frameDisplay').textContent = '12.3s';
  const scrubber = document.getElementById('scrubber');
  scrubber.value = scrubber.max;

  const items = [...document.querySelectorAll('.controls > *, .controls-row > *')]
    .filter(el => !el.classList.contains('sr-only') && getComputedStyle(el).display !== 'none');

  let minGap = Infinity;
  let closest = null;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
      const a = items[i].getBoundingClientRect();
      const b = items[j].getBoundingClientRect();
      // Only pairs that share a line can collide horizontally.
      if (!(a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5)) continue;
      const gap = a.left < b.left ? b.left - a.right : a.left - b.right;
      if (gap < minGap) {
        minGap = gap;
        closest = `${items[i].id || items[i].className} / ${items[j].id || items[j].className}`;
      }
    }
  }
  // The thumb rides inside the end of the track, so this is the clearance that
  // actually decides whether the disc reads as touching the time readout.
  const track = scrubber.getBoundingClientRect();
  const time = document.getElementById('timeDisplay').getBoundingClientRect();
  const sharesLine = track.top < time.bottom - 0.5 && time.top < track.bottom - 0.5;

  const doc = document.documentElement;
  return {
    height: document.querySelector('.controls').getBoundingClientRect().height,
    scrubberWidth: track.width,
    thumbToTime: sharesLine ? time.left - track.right : null,
    minGap,
    closest,
    overflowsPage: doc.scrollWidth > doc.clientWidth,
  };
});

describeMaybe('player controls layout', () => {
  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'player-layout-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps the whole bar on one row at desktop width', async () => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(writePlayer('one-row', { clipTimes }));
    const bar = await measureBar();

    expect(bar.height).toBeLessThanOrEqual(ONE_ROW_MAX_HEIGHT);
    // …and the scrubber is still the item that got the leftover width.
    expect(bar.scrubberWidth).toBeGreaterThan(120);
    // The thumb needs more than the row gap, or it sits on the readout.
    expect(bar.thumbToTime).toBeGreaterThanOrEqual(14);
  });

  it('never lets two controls collide, at any width or skin', async () => {
    // The thumb is a ~16px disc riding the end of the track, so the pair that
    // comes closest is usually the scrubber and the time readout.
    for (const skin of [undefined, ...listSkins()]) {
      const url = writePlayer(`collide-${skin || 'default'}`, skin ? { clipTimes, skin } : { clipTimes });
      await page.goto(url);
      for (let width = 320; width <= 1600; width += 40) {
        await page.setViewportSize({ width, height: 800 });
        const bar = await measureBar();
        expect.soft(bar.minGap, `${skin || 'default'} @${width}px: ${bar.closest}`).toBeGreaterThan(0);
        expect.soft(bar.overflowsPage, `${skin || 'default'} @${width}px scrolls sideways`).toBe(false);
        expect.soft(bar.scrubberWidth, `${skin || 'default'} @${width}px scrubber`).toBeGreaterThan(40);
      }
    }
  });

  it('gives settings the same panel presentation as calibration', async () => {
    // Both are opened from the controls bar, so they should read as the same
    // kind of thing: one bordered block, headed by its name and a line saying
    // what it does. Only the accent separates them — calibration wears the tool
    // colour because it changes playback timing, settings is page chrome.
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(writePlayer('panels', { clipTimes }));
    await page.click('#settingsToggle');
    await page.evaluate(() => { document.getElementById('debugPanel').style.display = 'block'; });

    const panels = await page.evaluate(() => {
      const read = (sel) => {
        const el = document.querySelector(sel);
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          width: Math.round(box.width),
          left: Math.round(box.left),
          top: box.top,
          bottom: box.bottom,
          padding: style.padding,
          radius: style.borderRadius,
          accent: getComputedStyle(el.querySelector('h3')).color,
          heading: el.querySelector('h3').textContent.trim(),
          note: el.querySelector('.panel-note')?.textContent.trim() || '',
        };
      };
      const controls = document.querySelector('.controls').getBoundingClientRect();
      return { settings: read('#settingsPanel'), calibration: read('#debugPanel'), controlsBottom: controls.bottom };
    });

    // Both drop out of the bar that opens them, rather than one of them sitting
    // above the player where the toggle cannot point at it.
    expect(panels.settings.top).toBeGreaterThanOrEqual(panels.controlsBottom);
    expect(panels.calibration.top).toBeGreaterThanOrEqual(panels.controlsBottom);
    // Stacked in the order their buttons appear, and never touching.
    expect(panels.calibration.top).toBeLessThan(panels.settings.top);
    expect(panels.settings.top).toBeGreaterThan(panels.calibration.bottom);

    // Same block, laid out identically.
    for (const key of ['width', 'left', 'padding', 'radius']) {
      expect(panels.settings[key], key).toEqual(panels.calibration[key]);
    }
    expect(panels.settings.heading).toBe('Settings');
    // Each explains itself rather than leaving the controls to speak for themselves.
    expect(panels.settings.note.length).toBeGreaterThan(40);
    expect(panels.calibration.note.length).toBeGreaterThan(40);
    // …but settings does not borrow the tool accent.
    expect(panels.settings.accent).not.toBe(panels.calibration.accent);
  });

  it('keeps the title band in view, with the flag faded out behind the words', async () => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.goto(writePlayer('title-band', { clipTimes }));
    const atTop = await page.evaluate(() => {
      const header = document.querySelector('.race-header');
      const box = header.getBoundingClientRect();
      const texture = getComputedStyle(header, '::before');
      const title = document.querySelector('h1').getBoundingClientRect();
      return {
        top: box.top,
        height: box.height,
        // The band has to make room for itself; a fixed one would sit on top of
        // whatever came first on the page.
        position: getComputedStyle(header).position,
        titleCentred: Math.abs((title.left + title.right) / 2 - box.width / 2) < 2,
        // The mask is what stops the pattern running under the title.
        masked: texture.maskImage !== 'none' || texture.webkitMaskImage !== 'none',
        firstBelow: document.querySelector('.player-container').getBoundingClientRect().top,
      };
    });

    expect(atTop.position).toBe('sticky');
    expect(atTop.height).toBeGreaterThanOrEqual(BAND_MIN_HEIGHT);
    // Compact: a title strip, not a hero banner.
    expect(atTop.height).toBeLessThan(BAND_MIN_HEIGHT * 1.5);
    expect(atTop.titleCentred).toBe(true);
    expect(atTop.masked).toBe(true);
    // Nothing starts underneath it.
    expect(atTop.firstBelow).toBeGreaterThanOrEqual(atTop.height);

    // …and it rides along instead of scrolling away.
    await page.evaluate(() => window.scrollTo(0, 400));
    const scrolled = await page.evaluate(() => document.querySelector('.race-header').getBoundingClientRect().top);
    expect(scrolled).toBe(0);
  });

  it('flags both ends of the page with whole rows of squares', async () => {
    // Head and foot wear the same band. Each draws a 2x2 conic tile, so it
    // reads as a flag only if whole rows of squares fit its height — a height
    // that is not a whole multiple clips the bottom row mid-square.
    for (const skin of [undefined, ...listSkins()]) {
      const url = writePlayer(`checkers-${skin || 'default'}`, skin ? { skin } : {});
      await page.goto(url);
      const bands = await page.evaluate(() => ['.race-header', '.checkered-bar'].map(sel => {
        const el = document.querySelector(sel);
        const texture = getComputedStyle(el, '::before');
        const [tile] = texture.backgroundSize.split(' ').map(Number.parseFloat);
        return {
          sel,
          height: el.getBoundingClientRect().height,
          square: tile / 2,
          washed: texture.backgroundImage.includes('conic'),
          masked: texture.maskImage !== 'none' || texture.webkitMaskImage !== 'none',
        };
      }));

      for (const band of bands) {
        const where = `${skin || 'default'} ${band.sel}`;
        expect.soft(band.washed, `${where} texture`).toBe(true);
        expect.soft(band.masked, `${where} mask`).toBe(true);
        expect.soft(band.height / band.square, `${where} rows`).toBeGreaterThanOrEqual(4);
        // Fractional squares blur — they cannot land on device pixels at 1x.
        expect.soft(band.square % 1, `${where} square`).toBe(0);
      }

      // Only the foot has a fixed height, so only there can a row be clipped
      // by one that does not divide it. The head is sized by its title.
      const foot = bands.find(b => b.sel === '.checkered-bar');
      expect.soft((foot.height / foot.square) % 1, `${skin || 'default'} partial row`).toBe(0);
    }
  });

  it('wraps rather than crushing the scrubber once the row runs out of width', async () => {
    await page.goto(writePlayer('wrap', { clipTimes }));
    await page.setViewportSize({ width: SINGLE_ROW_WIDTH, height: 800 });
    const wide = await measureBar();
    await page.setViewportSize({ width: 500, height: 800 });
    const narrow = await measureBar();

    expect(wide.height).toBeLessThanOrEqual(ONE_ROW_MAX_HEIGHT);
    expect(narrow.height).toBeGreaterThan(ONE_ROW_MAX_HEIGHT);
    // Wrapping is what buys the scrubber its width back on a narrow screen.
    expect(narrow.scrubberWidth).toBeGreaterThan(100);
  });
});
