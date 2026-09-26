/**
 * Integration test: open both reports on a phone.
 *
 * A results page gets shared, and the link gets opened on whatever is in the
 * reader's hand. Whether a page scrolls sideways at 320px, or a table column
 * shrinks to a few characters, is a layout question no assertion on the
 * stylesheet text can answer — so we lay the pages out at phone widths, with
 * every collapsible section open, and measure them.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildConditionIndexHtml } from '../cli/condition-matrix.js';
import { buildProfileComparison } from '../cli/profile-analysis.js';
import { hasChromiumInstalled } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// iPhone SE (1st gen), a common Android, and a current iPhone.
const PHONE_WIDTHS = [320, 360, 390];

const racers = ['lauda', 'hunt-the-shunt', 'prost'];
const videoFiles = racers.map(name => `${name}/${name}.race.webm`);
const sectionMetrics = (scale) => ({
  total: {},
  measured: { networkTransferSize: 2000 * scale, scriptDuration: 40 * scale },
  measuredSections: {
    Load: { networkTransferSize: 1200 * scale, networkRequestCount: 4, scriptDuration: 25 * scale, layoutDuration: 5, recalcStyleDuration: 2, taskDuration: 35 * scale },
    Render: { networkTransferSize: 800 * scale, networkRequestCount: 2, scriptDuration: 10 * scale, layoutDuration: 3, recalcStyleDuration: 1, taskDuration: 15 * scale },
  },
});
const profileMetrics = [sectionMetrics(1), sectionMetrics(1.3), sectionMetrics(1.7)];
const summary = {
  racers,
  comparisons: [
    { name: 'Load', racers: [{ duration: 1.1 }, { duration: 1.4 }, { duration: 1.9 }], winner: 'lauda', rankings: racers },
    { name: 'Render', racers: [{ duration: 0.9 }, { duration: 1.2 }, { duration: 1.3 }], winner: 'lauda', rankings: racers },
  ],
  overallWinner: 'lauda',
  timestamp: new Date().toISOString(),
  settings: {},
  errors: [],
  wins: { lauda: 2 },
  videos: {},
  profileMetrics,
  profileComparison: buildProfileComparison(racers, profileMetrics),
};
// The settings table at its worst: long setting names beside a long value.
const raceConfig = {
  command: 'node race.js ./races/monaco --runs=3 --network slow-3g --cpu 4',
  mode: 'directory',
  raceDir: 'races/monaco',
  racers: racers.map(name => ({ name, script: `${name}.spec.js` })),
  settings: {
    runs: 3,
    ignoreHTTPSErrors: false,
    pauseBetweenRuns: false,
    racers: { lauda: { vars: { color: '#e74c3c', label: 'LAUDA', recordingDelayMs: 100 } } },
  },
  sources: { runs: 'cli', racers: 'settings.json' },
};

const summaryOf = (durations, winner) => ({
  racers: Object.keys(durations),
  overallWinner: winner,
  comparisons: [{
    name: 'Race',
    isSyntheticTotal: true,
    winner,
    racers: Object.keys(durations).map(name => ({ duration: durations[name] })),
  }],
});
const matrixEntries = ['none', 'slow-3g', 'fast-3g'].flatMap(network => [1, 4].map(cpu => ({
  label: `${network}-cpu${cpu}x`,
  title: `Network: ${network} · CPU: ${cpu}x`,
  network,
  cpu,
  summary: summaryOf({ 'react-benchmark': 1.2 * cpu, 'angular-benchmark': 1.5 * cpu, svelte: 1.1 * cpu }, 'svelte'),
})));

let browser, tmpDir;

const canRun = hasChromiumInstalled(path.resolve(__dirname, '..'));
const describeMaybe = canRun ? describe : describe.skip;

function writePage(name, html) {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return pathToFileURL(path.join(dir, 'index.html')).href;
}

/** A phone: narrow, touch-driven, and zoomed by its meta viewport. */
async function openOnPhone(url, width) {
  const context = await browser.newContext({
    viewport: { width, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  return { page, context };
}

/** Anything poking out past the right edge, outside a deliberate scroller. */
const measureOverflow = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const offenders = [...document.body.querySelectorAll('*')]
    .filter(el => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= doc.clientWidth + 1) return false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') return false;
      }
      return true;
    })
    .map(el => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
  return { scrolls: doc.scrollWidth > doc.clientWidth, offenders: [...new Set(offenders)] };
});

describeMaybe('reports on a phone', () => {
  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'mobile-layout-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('never scrolls the results player sideways', async () => {
    const url = writePage('player', buildPlayerHtml(summary, videoFiles, null, null, { raceConfig }));
    for (const width of PHONE_WIDTHS) {
      const { page, context } = await openOnPhone(url, width);
      const overflow = await measureOverflow(page);
      expect.soft(overflow.offenders, `@${width}px`).toEqual([]);
      expect.soft(overflow.scrolls, `@${width}px scrolls sideways`).toBe(false);
      await context.close();
    }
  });

  it('never scrolls the condition overview sideways — the matrix scrolls on its own', async () => {
    const url = writePage('matrix', buildConditionIndexHtml('react vs angular vs svelte', matrixEntries));
    for (const width of PHONE_WIDTHS) {
      const { page, context } = await openOnPhone(url, width);
      const overflow = await measureOverflow(page);
      expect.soft(overflow.offenders, `@${width}px`).toEqual([]);
      expect.soft(overflow.scrolls, `@${width}px scrolls sideways`).toBe(false);
      // Every line of a card stays inside that card.
      const spill = await page.evaluate(() => [...document.querySelectorAll('td a')].some(card => {
        const box = card.getBoundingClientRect();
        return [...card.querySelectorAll('.r > *')].some(el => el.getBoundingClientRect().right > box.right + 0.5);
      }));
      expect.soft(spill, `@${width}px a card's row spills out of it`).toBe(false);
      await context.close();
    }
  });

  it('gives a setting value the width of the table, not a sliver of it', async () => {
    const url = writePage('config', buildPlayerHtml(summary, videoFiles, null, null, { raceConfig }));
    const { page, context } = await openOnPhone(url, 360);
    const widths = await page.evaluate(() => ({
      table: document.querySelector('.config-table').getBoundingClientRect().width,
      values: [...document.querySelectorAll('.config-value')].map(td => td.getBoundingClientRect().width),
    }));
    // Squeezed between the name and its badge, "false" wrapped mid-word.
    for (const value of widths.values) expect(value).toBeGreaterThan(widths.table * 0.8);
    await context.close();
  });

  it('keeps the transport on one line, with room enough for a fingertip', async () => {
    const url = writePage('transport', buildPlayerHtml(summary, videoFiles));
    const { page, context } = await openOnPhone(url, 360);
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('.controls-row button, .control-action-btn')]
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => ({ id: el.id, ...JSON.parse(JSON.stringify(el.getBoundingClientRect())) }))
    );
    const transport = buttons.filter(b => ['goStart', 'prevFrame', 'playBtn', 'nextFrame', 'goEnd'].includes(b.id));
    // The last button used to drop onto a line of its own.
    expect(new Set(transport.map(b => Math.round(b.top))).size).toBe(1);
    for (const b of buttons) expect.soft(b.height, `#${b.id} height`).toBeGreaterThanOrEqual(36);
    await context.close();
  });
});
