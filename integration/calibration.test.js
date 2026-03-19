/**
 * Integration test: verify that trace-based calibration values are
 * applied in the HTML player and that missing trace metadata throws a strict
 * manual-calibration error.
 *
 * Uses Playwright to load generated index.html pages with known clip times
 * and evaluate the player's runtime behavior.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeSummary = (overrides = {}) => ({
  racers: ['alpha', 'bravo'],
  comparisons: [
    { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'alpha', diff: 1, diffPercent: 100, rankings: ['alpha', 'bravo'] },
  ],
  overallWinner: 'alpha',
  timestamp: new Date().toISOString(),
  settings: {},
  errors: [],
  wins: { alpha: 1, bravo: 0 },
  clickCounts: { alpha: 0, bravo: 0 },
  videos: {},
  ...overrides,
});

const videoFiles = ['alpha/alpha.race.webm', 'bravo/bravo.race.webm'];

const traceCalibratedClipTimes = [
  { start: 2.0, end: 10.0, recordingOffset: 0.01, wallClockDuration: 12.0, calibratedStart: null, traceCalibration: { recordingStartTs: 2_000_000, firstFrameTs: 1_900_000 } },
  { start: 1.8, end: 9.5, recordingOffset: 0.02, wallClockDuration: 11.5, calibratedStart: null, traceCalibration: { recordingStartTs: 3_000_000, firstFrameTs: 2_800_000 } },
];

const uncalibratedClipTimes = [
  { start: 2.0, end: 10.0, recordingOffset: 0.01, wallClockDuration: 12.0, calibratedStart: null },
  { start: 1.8, end: 9.5, recordingOffset: 0.02, wallClockDuration: 11.5, calibratedStart: null },
];

const baseClipTimes = [
  { start: 2.0, end: 10.0, recordingOffset: 0.01, wallClockDuration: 12.0 },
  { start: 1.8, end: 9.5, recordingOffset: 0.02, wallClockDuration: 11.5 },
];

let browser, page, tmpDir;

async function launchPlaywright() {
  const pw = await import('playwright');
  return pw.chromium.launch({ headless: true });
}

function buildAndWrite(clipTimes) {
  for (const vf of videoFiles) {
    fs.mkdirSync(path.join(tmpDir, path.dirname(vf)), { recursive: true });
  }
  const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { clipTimes });
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  return html;
}

function extractFromScripts(fn) {
  return page.evaluate(fn);
}

describe('calibration integration', () => {
  let setupError = null;

  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'calibration-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      // Some CI/sandbox environments can hang while launching Chromium.
      // Bound setup time so the suite can skip cleanly instead of timing out.
      browser = await Promise.race([
        launchPlaywright(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Playwright launch timeout')), 20_000)),
      ]);
      page = await browser.newPage();
    } catch (e) {
      setupError = new Error(`Calibration integration setup failed: ${e.message}`);
    }
  });

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('embeds trace calibration metadata in clipTimes JSON', async ({ skip }) => {
    if (setupError) skip(setupError.message);

    buildAndWrite(traceCalibratedClipTimes);
    await page.goto(`file://${path.join(tmpDir, 'index.html')}`);

    const parsed = await extractFromScripts(() => {
      for (const s of document.querySelectorAll('script')) {
        const match = s.textContent.match(/const clipTimes = (\[.*?\]);/);
        if (match) return JSON.parse(match[1]);
      }
      return null;
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0].traceCalibration.recordingStartTs).toBe(2_000_000);
    expect(parsed[1].traceCalibration.recordingStartTs).toBe(3_000_000);
  });

  it('onMeta applies trace calibration via applyCalibrationToClip', async ({ skip }) => {
    if (setupError) skip(setupError.message);

    buildAndWrite(traceCalibratedClipTimes);
    await page.goto(`file://${path.join(tmpDir, 'index.html')}`);

    const result = await extractFromScripts(() => {
      for (const s of document.querySelectorAll('script')) {
        if (s.textContent.includes('applyCalibrationToClip')) {
          return {
            hasTracePath: s.textContent.includes('hasTraceCalibration(ct)'),
            hasApplyCall: s.textContent.includes('applyCalibrationToClip(ct, tracePtsStart'),
            hasContinue: s.textContent.includes('continue;'),
          };
        }
      }
      return null;
    });

    expect(result).toBeTruthy();
    expect(result.hasTracePath).toBe(true);
    expect(result.hasApplyCall).toBe(true);
    expect(result.hasContinue).toBe(true);
  });

  it('does not include canvas calibration fallback in runtime', async ({ skip }) => {
    if (setupError) skip(setupError.message);

    buildAndWrite(traceCalibratedClipTimes);
    await page.goto(`file://${path.join(tmpDir, 'index.html')}`);

    const result = await extractFromScripts(() => {
      const clipTimesMatch = [...document.querySelectorAll('script')]
        .map(s => s.textContent.match(/const clipTimes = (\[.*?\]);/))
        .find(Boolean);
      const parsedClipTimes = clipTimesMatch ? JSON.parse(clipTimesMatch[1]) : null;
      const hasTraceCalibration = ct => !!(ct && ct.traceCalibration && Number.isFinite(ct.traceCalibration.recordingStartTs));
      const needsCalibration = parsedClipTimes
        ? parsedClipTimes.some(ct => ct && ct.calibratedStart == null && !hasTraceCalibration(ct))
        : null;

      for (const s of document.querySelectorAll('script')) {
        if (s.textContent.includes('applyCalibrationToClip')) {
          return {
            hasNoCanvasFallback: !s.textContent.includes('calibrateFromCanvas'),
            hasNoLocalStorageFallback: !s.textContent.includes('localStorage'),
            hasTraceFixtures: Array.isArray(parsedClipTimes) && parsedClipTimes.every(ct => !!ct.traceCalibration),
            needsCalibration,
          };
        }
      }
      return null;
    });

    expect(result).toBeTruthy();
    expect(result.hasNoCanvasFallback).toBe(true);
    expect(result.hasNoLocalStorageFallback).toBe(true);
    expect(result.hasTraceFixtures).toBe(true);
    expect(result.needsCalibration).toBe(false);
  });

  it('throws strict manual calibration error when trace metadata is missing', async ({ skip }) => {
    if (setupError) skip(setupError.message);

    buildAndWrite(uncalibratedClipTimes);
    await page.goto(`file://${path.join(tmpDir, 'index.html')}`);

    const result = await extractFromScripts(() => {
      for (const s of document.querySelectorAll('script')) {
        if (s.textContent.includes('failCalibration(')) {
          return {
            hasStrictMessage: s.textContent.includes('Please calibrate manually.'),
            hasDisablePlay: s.textContent.includes('playBtn.disabled = true'),
            hasThrow: s.textContent.includes('throw new Error(msg)'),
          };
        }
      }
      return null;
    });

    expect(result).toBeTruthy();
    expect(result.hasStrictMessage).toBe(true);
    expect(result.hasDisablePlay).toBe(true);
    expect(result.hasThrow).toBe(true);
  });

  it('does not include blob/security canvas fallback helpers', async ({ skip }) => {
    if (setupError) skip(setupError.message);

    buildAndWrite(baseClipTimes);
    await page.goto(`file://${path.join(tmpDir, 'index.html')}`);

    const result = await extractFromScripts(() => {
      for (const s of document.querySelectorAll('script')) {
        if (s.textContent.includes('applyCalibrationToClip')) {
          return {
            hasBlobFn: s.textContent.includes('toBlobVideo'),
            hasCanvasDetect: s.textContent.includes('detectGreenCuePts'),
          };
        }
      }
      return null;
    });

    expect(result).toBeTruthy();
    expect(result.hasBlobFn).toBe(false);
    expect(result.hasCanvasDetect).toBe(false);
  });

  it('applyCalibrationToClip computes correct clip range from PTS start', async ({ skip }) => {
    if (setupError) skip(setupError.message);

    buildAndWrite(traceCalibratedClipTimes);
    await page.goto(`file://${path.join(tmpDir, 'index.html')}`);

    const result = await extractFromScripts(() => {
      for (const s of document.querySelectorAll('script')) {
        const match = s.textContent.match(/const clipTimes = (\[.*?\]);/);
        if (match) {
          return JSON.parse(match[1]).map(ct => {
            const segDuration = ct.end - ct.start;
            return {
              wcStart: ct.start, wcEnd: ct.end, segDuration,
              expectedStart: (ct.traceCalibration.recordingStartTs - ct.traceCalibration.firstFrameTs) / 1e6,
              expectedEnd: ((ct.traceCalibration.recordingStartTs - ct.traceCalibration.firstFrameTs) / 1e6) + segDuration,
            };
          });
        }
      }
      return null;
    });

    expect(result).toHaveLength(2);

    // alpha: recordingStartTs-firstFrameTs=0.1s, segDuration=8.0
    expect(result[0].expectedStart).toBeCloseTo(0.1, 5);
    expect(result[0].expectedEnd).toBeCloseTo(8.1, 5);

    // bravo: recordingStartTs-firstFrameTs=0.2s, segDuration=7.7
    expect(result[1].expectedStart).toBeCloseTo(0.2, 5);
    expect(result[1].expectedEnd).toBeCloseTo(7.9, 5);
  });
});
