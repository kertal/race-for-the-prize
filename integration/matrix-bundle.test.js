/**
 * Integration test: the condition overview's "Download full report" button,
 * driven in a real browser against a real results directory.
 *
 * The bundler walks a tree it discovers at runtime — the matrix's own cell
 * links, then each condition page's Files section, video elements and race
 * config — fetches every one of them and packs the lot with the player's ZIP
 * builder. None of that can be checked from the generated HTML: it needs a
 * browser, a server to fetch from, and an unzip implementation on the far end.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildConditionIndexHtml } from '../cli/condition-matrix.js';
import { createStaticHandler } from '../cli/serve.js';
import { hasChromiumInstalled } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RACERS = ['lauda', 'hunt'];
const CONDITIONS = [
  { label: 'none-cpu1x', title: 'Network: none · CPU: 1x', network: 'none', cpu: 1, winner: 'lauda' },
  { label: 'slow-3g-cpu4x', title: 'Network: slow-3g · CPU: 4x', network: 'slow-3g', cpu: 4, winner: 'hunt' },
];

const summaryOf = (winner) => ({
  racers: RACERS,
  overallWinner: winner,
  comparisons: [{
    name: 'Race',
    isSyntheticTotal: true,
    winner,
    racers: [{ duration: 1 }, { duration: 2 }],
  }],
  timestamp: new Date().toISOString(),
  settings: {},
  errors: [],
  wins: { lauda: 1, hunt: 0 },
  videos: {},
});

const VIDEO_FILES = RACERS.map(name => `${name}.race.webm`);
const TRACE_FILES = RACERS.map(name => `${name}.trace.json`);
// Listed by every condition page but never written: one unreachable file must
// cost its own entry, not the archive.
const MISSING_HAR = 'lauda.har';

/** Deterministic pseudo-binary, so the unzipped bytes can be compared exactly. */
const fakeVideo = (seed) => Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7 + seed) % 256));

let browser, context, page, server, tmpDir, baseUrl;

const canRun = hasChromiumInstalled(path.resolve(__dirname, '..'));
const describeMaybe = canRun ? describe : describe.skip;

/** Write a results directory: the overview plus one real player page per condition. */
function writeResults(dir) {
  for (const condition of CONDITIONS) {
    const conditionDir = path.join(dir, condition.label);
    fs.mkdirSync(conditionDir, { recursive: true });
    fs.writeFileSync(path.join(conditionDir, 'index.html'), buildPlayerHtml(
      summaryOf(condition.winner), VIDEO_FILES, null, null,
      { traceFiles: TRACE_FILES, harFiles: [MISSING_HAR, null], settingsFileCopied: true }
    ));
    VIDEO_FILES.forEach((file, i) => fs.writeFileSync(path.join(conditionDir, file), fakeVideo(i)));
    TRACE_FILES.forEach(file => fs.writeFileSync(path.join(conditionDir, file), '{"traceEvents":[]}'));
    fs.writeFileSync(path.join(conditionDir, 'settings.json'), '{}');
  }

  fs.writeFileSync(path.join(dir, 'index.html'), buildConditionIndexHtml(
    RACERS.join(' vs '),
    CONDITIONS.map(condition => ({ ...condition, summary: summaryOf(condition.winner) }))
  ));
}

/** Download the bundle from the served overview and unzip it. Returns the extract dir. */
async function downloadBundle() {
  await page.goto(baseUrl);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#download-zip'),
  ]);
  const zipPath = path.join(tmpDir, 'bundle.zip');
  await download.saveAs(zipPath);

  const extractDir = path.join(tmpDir, 'unzipped');
  execFileSync('python3', ['-c',
    'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); z.testzip(); z.extractall(sys.argv[2])',
    zipPath, extractDir]);
  return { extractDir, filename: download.suggestedFilename() };
}

describeMaybe('condition matrix report bundle', () => {
  let bundle;

  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'matrix-bundle-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    writeResults(path.join(tmpDir, 'results'));

    server = http.createServer(createStaticHandler(path.join(tmpDir, 'results')));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/index.html`;

    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    bundle = await downloadBundle();
  });

  afterAll(async () => {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('names the archive after the race', () => {
    expect(bundle.filename).toBe('lauda-vs-hunt-report.zip');
  });

  it('packs the overview and every condition page under its own directory', () => {
    const at = rel => path.join(bundle.extractDir, rel);
    const overview = fs.readFileSync(at('index.html'), 'utf-8');

    for (const condition of CONDITIONS) {
      expect(overview).toContain(condition.title);
      expect(fs.readFileSync(at(`${condition.label}/index.html`), 'utf-8')).toContain('Race: lauda vs hunt');
    }
  });

  it('archives the overview as it was, not as it looked mid-download', () => {
    // The page is snapshotted before the run relabels its button and writes a
    // progress line, so the copy in the ZIP is not frozen saying 'Cancel'.
    const overview = fs.readFileSync(path.join(bundle.extractDir, 'index.html'), 'utf-8');

    expect(overview).toContain('Download full report (ZIP)');
    expect(overview).not.toContain('>Cancel<');
    expect(overview).toMatch(/<span class="status" id="bundle-status" role="status"><\/span>/);
  });

  it('follows each page to the files it links', () => {
    // Videos, traces and the settings copy all reach the archive at the path
    // their page refers to them by, so the unzipped report still resolves them.
    for (const condition of CONDITIONS) {
      for (const file of [...VIDEO_FILES, ...TRACE_FILES, 'settings.json']) {
        expect(fs.existsSync(path.join(bundle.extractDir, condition.label, file)), `${condition.label}/${file}`).toBe(true);
      }
    }
  });

  it('carries binary files through byte for byte', () => {
    VIDEO_FILES.forEach((file, i) => {
      const unzipped = fs.readFileSync(path.join(bundle.extractDir, CONDITIONS[0].label, file));
      expect(Buffer.compare(unzipped, fakeVideo(i))).toBe(0);
    });
  });

  it('skips a file it cannot fetch instead of losing the archive', async () => {
    expect(fs.existsSync(path.join(bundle.extractDir, CONDITIONS[0].label, MISSING_HAR))).toBe(false);
    // One missing HAR per condition page, reported rather than swallowed.
    expect(await page.textContent('#bundle-status')).toContain('Skipped 2 file(s)');
  });

  it('leaves the matrix page in the archive able to open its conditions', () => {
    // The overview links relative to itself, so the unzipped copy navigates
    // exactly like the served one.
    const overview = fs.readFileSync(path.join(bundle.extractDir, 'index.html'), 'utf-8');
    for (const condition of CONDITIONS) {
      expect(overview).toContain(`href="${condition.label}/index.html"`);
    }
  });
});
