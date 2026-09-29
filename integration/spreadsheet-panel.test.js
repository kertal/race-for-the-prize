/**
 * Integration test: the Spreadsheet Export panel, driven in a real browser.
 *
 * The unit tests cover the model, the markup and the pure TSV/CSV core, and
 * assert that the runtime's source is on the page — but not that its selectors
 * still find the markup, or that a click ends with the right text on the
 * clipboard. This opens generated reports and works the controls: ticking
 * groups, the decimal-comma option, Copy (with the clipboard stubbed so the
 * text can be read back), the selection-based fallback, and Download CSV.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildConditionIndexHtml } from '../cli/condition-matrix.js';
import { hasChromiumInstalled } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const racers = ['lauda', 'hunt'];
const runSummaries = [1, 2].map(k => ({
  racers,
  comparisons: [
    { name: 'Load', racers: [{ duration: 1.0 * k }, { duration: 3.0 }], winner: 'lauda', rankings: racers },
    { name: 'Render', racers: [{ duration: 0.5 }, { duration: 0.7 * k }], winner: 'lauda', rankings: racers },
    { name: 'Race', isSyntheticTotal: true, racers: [{ duration: 1.5 * k }, { duration: 3.7 }], winner: 'lauda', rankings: racers },
  ],
  errors: [],
  profileMetrics: [
    { measured: { scriptDuration: 100 * k }, total: { lcp: 900 } },
    { measured: { scriptDuration: 200 }, total: { lcp: 1800 } },
  ],
}));
const medianSummary = {
  ...runSummaries[0],
  runs: 2,
  overallWinner: 'lauda',
  timestamp: '2026-01-01T00:00:00.000Z',
  settings: {},
  wins: { lauda: 3, hunt: 0 },
  videos: {},
};

const conditionEntries = [['none', 1], ['none', 4], ['slow-3g', 1], ['slow-3g', 4]].map(([network, cpu]) => ({
  label: `${network}-cpu${cpu}x`,
  title: `Network: ${network} · CPU: ${cpu}x`,
  network,
  cpu,
  summary: {
    racers,
    overallWinner: 'lauda',
    comparisons: [{ name: 'Race', isSyntheticTotal: true, winner: 'lauda', racers: [{ duration: cpu }, { duration: cpu * 2 }] }],
    profileMetrics: [{ total: { lcp: 900 * cpu } }, { total: { lcp: 1000 * cpu } }],
  },
}));

let browser, tmpDir;

const canRun = hasChromiumInstalled(path.resolve(__dirname, '..'));
const describeMaybe = canRun ? describe : describe.skip;

/** Write a page into the temp dir and return its file:// URL. */
function writePage(name, html) {
  const file = path.join(tmpDir, name, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return `file://${file}`;
}

/**
 * Open a page with the clipboard stubbed (headless Chromium has no real one),
 * expand the collapsed export section, and return the page plus a reader for
 * whatever was last "copied".
 */
async function openPanel(url) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => { window.__copied = text; } },
      configurable: true,
    });
  });
  await page.goto(url);
  // The section is collapsed, so the panel is attached but not visible yet.
  await page.waitForSelector('#spreadsheetPanel', { state: 'attached' });
  await page.$eval('#spreadsheetPanel', el => { el.closest('details').open = true; });
  const copied = () => page.evaluate(() => window.__copied);
  const status = () => page.textContent('#spreadsheetStatus');
  const visibleRows = () => page.$$eval('#spreadsheetPanel tbody tr', trs => trs.filter(tr => !tr.hidden).length);
  return { context, page, errors, copied, status, visibleRows };
}

describeMaybe('spreadsheet export panel integration', () => {
  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'spreadsheet-panel-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('on the results player (multi-run median page)', () => {
    let panel, url;

    beforeAll(async () => {
      // The video files do not exist; the player tolerates that and the panel
      // does not depend on them.
      url = writePage('player', buildPlayerHtml(medianSummary, ['lauda/lauda.race.webm', 'hunt/hunt.race.webm'], null, null, { runSummaries }));
      panel = await openPanel(url);
    });

    afterAll(async () => { await panel.context.close(); });

    it('starts with every group ticked and every row showing', async () => {
      const groups = await panel.page.$$eval('#spreadsheetPanel .spreadsheet-group input', boxes => boxes.map(b => b.checked));
      expect(groups.length).toBeGreaterThan(3);
      expect(groups.every(Boolean)).toBe(true);
      const total = await panel.page.$$eval('#spreadsheetPanel tbody tr', trs => trs.length);
      expect(await panel.visibleRows()).toBe(total);
      expect(await panel.status()).toBe(`${total} rows selected.`);
    });

    it('hides the rows of unticked groups and copies only the ticked ones as TSV', async () => {
      const boxes = await panel.page.$$('#spreadsheetPanel .spreadsheet-group input');
      for (const box of boxes.slice(1)) await box.uncheck();
      expect(await panel.visibleRows()).toBe(3);
      expect(await panel.status()).toBe('3 rows selected.');

      await panel.page.click('#spreadsheetCopy');
      await panel.page.waitForFunction(() => window.__copied !== null);
      expect(await panel.copied()).toBe(
        'Section\tMeasurement\tUnit\tlauda\thunt\n'
        + 'Race Results (median of 2 runs)\tRace\ts\t1.5\t3.7\n'
        + 'Race Results (median of 2 runs)\tLoad\ts\t1\t3\n'
        + 'Race Results (median of 2 runs)\tRender\ts\t0.5\t0.7'
      );
      expect(await panel.status()).toBe('Copied 3 rows — paste into a sheet.');
    });

    it('copies the same selection as a GitHub Markdown table', async () => {
      await panel.page.evaluate(() => { window.__copied = null; });
      await panel.page.click('#spreadsheetMarkdown');
      await panel.page.waitForFunction(() => window.__copied !== null);
      expect(await panel.copied()).toBe(
        '| Section | Measurement | Unit | lauda | hunt |\n'
        + '| --- | --- | --- | ---: | ---: |\n'
        + '| Race Results (median of 2 runs) | Race | s | 1.5 | 3.7 |\n'
        + '| Race Results (median of 2 runs) | Load | s | 1 | 3 |\n'
        + '| Race Results (median of 2 runs) | Render | s | 0.5 | 0.7 |'
      );
      expect(await panel.status()).toBe('Copied 3 rows as Markdown — paste into a GitHub issue, pull request or README.');
    });

    it('re-renders the preview and the copy with a decimal comma', async () => {
      await panel.page.check('#spreadsheetDecimalComma');
      const first = await panel.page.$eval('#spreadsheetPanel tbody tr:not([hidden]) td[data-value]', td => td.textContent);
      expect(first).toBe('1,5');
      await panel.page.click('#spreadsheetCopy');
      await panel.page.waitForFunction(() => window.__copied && window.__copied.includes('1,5'));
      expect((await panel.copied()).split('\n')[1]).toBe('Race Results (median of 2 runs)\tRace\ts\t1,5\t3,7');
      await panel.page.uncheck('#spreadsheetDecimalComma');
    });

    it('refuses to copy nothing, and "all" brings every group back', async () => {
      await panel.page.click('[data-spreadsheet-select="none"]');
      expect(await panel.visibleRows()).toBe(0);
      await panel.page.evaluate(() => { window.__copied = null; });
      await panel.page.click('#spreadsheetCopy');
      expect(await panel.status()).toBe('Nothing selected — tick at least one table.');
      expect(await panel.copied()).toBeNull();

      await panel.page.click('[data-spreadsheet-select="all"]');
      const total = await panel.page.$$eval('#spreadsheetPanel tbody tr', trs => trs.length);
      expect(await panel.visibleRows()).toBe(total);
    });

    it('downloads the selection as a UTF-8 CSV named after the page', async () => {
      const boxes = await panel.page.$$('#spreadsheetPanel .spreadsheet-group input');
      for (const box of boxes.slice(1)) await box.uncheck();
      const [download] = await Promise.all([
        panel.page.waitForEvent('download'),
        panel.page.click('#spreadsheetCsv'),
      ]);
      expect(download.suggestedFilename()).toBe('race_lauda_vs_hunt.csv');
      const csv = fs.readFileSync(await download.path(), 'utf-8');
      expect(csv.startsWith('﻿')).toBe(true);
      expect(csv.slice(1).split('\r\n').slice(0, 2)).toEqual([
        'Section,Measurement,Unit,lauda,hunt',
        'Race Results (median of 2 runs),Race,s,1.5,3.7',
      ]);
      expect(await panel.status()).toBe('Downloaded race_lauda_vs_hunt.csv (3 rows).');
    });

    it('falls back to a selection-based copy when the clipboard API is missing', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        // execCommand('copy') needs a user gesture to reach the real clipboard;
        // record what it was asked to copy instead.
        window.__execCopied = null;
        document.execCommand = (cmd) => {
          if (cmd !== 'copy') return false;
          window.__execCopied = document.activeElement?.value ?? null;
          return true;
        };
      });
      await page.goto(url);
      await page.$eval('#spreadsheetPanel', el => { el.closest('details').open = true; });
      await page.click('#spreadsheetCopy');
      await page.waitForFunction(() => window.__execCopied !== null);
      expect(await page.evaluate(() => window.__execCopied)).toContain('Section\tMeasurement\tUnit\tlauda\thunt\n');
      expect(await page.textContent('#spreadsheetStatus')).toMatch(/^Copied \d+ rows/);
      // The scratch textarea is gone again.
      expect(await page.$('#spreadsheetPanel textarea')).toBeNull();
      await context.close();
    });

    it('raised no page errors', () => {
      expect(panel.errors).toEqual([]);
    });
  });

  describe('on a report without videos', () => {
    it('still copies, since the panel ships its own runtime', async () => {
      const url = writePage('no-videos', buildPlayerHtml(medianSummary, [], null, null, { runSummaries }));
      const panel = await openPanel(url);
      await panel.page.click('[data-spreadsheet-select="none"]');
      await panel.page.$$('#spreadsheetPanel .spreadsheet-group input').then(b => b[0].check());
      await panel.page.click('#spreadsheetCopy');
      await panel.page.waitForFunction(() => window.__copied !== null);
      expect((await panel.copied()).split('\n')).toHaveLength(4);
      expect(panel.errors).toEqual([]);
      await panel.context.close();
    });
  });

  describe('on the condition matrix', () => {
    it('exports one metric per group with the condition coordinates as columns', async () => {
      const url = writePage('matrix', buildConditionIndexHtml('lauda vs hunt', conditionEntries));
      const panel = await openPanel(url);
      expect(await panel.status()).toBe('8 rows selected.');

      // Keep only Total Time.
      await panel.page.uncheck('#spreadsheetPanel .spreadsheet-group input[value="total.lcp"]');
      expect(await panel.visibleRows()).toBe(4);
      await panel.page.click('#spreadsheetCopy');
      await panel.page.waitForFunction(() => window.__copied !== null);
      expect((await panel.copied()).split('\n')).toEqual([
        'Metric\tCondition\tNetwork\tCPU\tUnit\tlauda\thunt',
        'Total Time\tNetwork: none · CPU: 1x\tnone\t1\ts\t1\t2',
        'Total Time\tNetwork: none · CPU: 4x\tnone\t4\ts\t4\t8',
        'Total Time\tNetwork: slow-3g · CPU: 1x\tslow-3g\t1\ts\t1\t2',
        'Total Time\tNetwork: slow-3g · CPU: 4x\tslow-3g\t4\ts\t4\t8',
      ]);

      const [download] = await Promise.all([
        panel.page.waitForEvent('download'),
        panel.page.click('#spreadsheetCsv'),
      ]);
      expect(download.suggestedFilename()).toBe('lauda_vs_hunt_race_conditions.csv');
      expect(panel.errors).toEqual([]);
      await panel.context.close();
    });
  });
});
