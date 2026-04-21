/**
 * overlay.cjs — Visual overlay helpers for RaceForThePrize runner.
 *
 * Pure presentation functions that inject CSS/HTML into browser pages
 * for visual cues, recording indicators, finish times, and medals.
 *
 * Extracted from runner.cjs runMarkerMode() to improve readability.
 * CommonJS to match runner.cjs.
 */

const CUE_DURATION_MS = 200; // Long enough to be captured even at ~5fps
const CUE_SIZE = 4;          // Smallest size that survives VP8 compression


/**
 * Flash a colored cue square in the top-left corner for frame-accurate trimming.
 * A tiny colored square displayed briefly, used by the HTML player's Canvas API
 * to calibrate clip start/end positions client-side.
 *
 * @param {Page} page - Playwright page
 * @param {string} color - CSS color for the cue (e.g. '#00FF00')
 * @param {number} [durationMs] - How long to display (defaults to CUE_DURATION_MS)
 */
async function flashCue(page, color, durationMs) {
  const dur = typeof durationMs === 'number' ? durationMs : CUE_DURATION_MS;
  await page.evaluate(({ c, size, ms }) => {
    const el = document.createElement('div');
    el.id = '__race_cue';
    // CSS animation forces compositor updates → guarantees screencast frame capture
    el.style.cssText = 'position:fixed;top:0;left:0;width:' + size + 'px;height:' + size + 'px;z-index:2147483647;background:' + c + ';animation:__rcue 16ms steps(2) infinite';
    const sheet = document.createElement('style');
    sheet.textContent = '@keyframes __rcue{50%{opacity:.999}}';
    document.head.appendChild(sheet);
    document.documentElement.appendChild(el);
    void el.offsetHeight; // Force reflow to ensure the cue is painted before setTimeout
    return new Promise(resolve => setTimeout(() => {
      el.remove(); sheet.remove(); resolve();
    }, ms));
  }, { c: color, size: CUE_SIZE, ms: dur });
}

/**
 * Set or remove overlay indicators in one evaluate call.
 *
 * @param {Page} page - Playwright page
 * @param {boolean} dot - Show recording dot (left)
 * @param {string|null} right - Right indicator emoji (e.g. stopwatch/flag) or null to hide
 */
async function setOverlay(page, dot, right) {
  await page.evaluate(({ d, r }) => {
    let el = document.getElementById('__race_ol');
    if (d) {
      if (!el) {
        el = document.createElement('div');
        el.id = '__race_ol';
        el.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;width:10px;height:10px;border-radius:50%;background:#e00;pointer-events:none';
        document.body.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
    el = document.getElementById('__race_or');
    if (r) {
      if (!el) {
        el = document.createElement('div');
        el.id = '__race_or';
        el.style.cssText = 'position:fixed;top:8px;right:12px;z-index:2147483647;font:32px/1 sans-serif;pointer-events:none';
        document.body.appendChild(el);
      }
      el.textContent = r;
    } else if (el) {
      el.remove();
    }
  }, { d: dot, r: right });
}

/**
 * Show the placement medal (parallel mode) or finish flag (sequential mode).
 * Pure presentation — caller handles finish order tracking and placement calculation.
 *
 * @param {Page} page - Playwright page
 * @param {number|null} place - 1-based placement (null → sequential mode, shows finish flag)
 */
async function showMedal(page, place) {
  const style = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
    + 'pointer-events:none;background:rgba(0,0,0,0.6);color:#fff;padding:24px 48px;border-radius:16px;';

  if (place) {
    const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}', '4\uFE0F\u20E3', '5\uFE0F\u20E3'];
    const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
    const medal = medals[place - 1] || `${place}`;
    const ordinal = ordinals[place - 1] || `${place}th`;
    await page.evaluate(({ medal, ordinal, style }) => {
      const existing = document.getElementById('__race_medal');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = '__race_medal';
      el.textContent = medal + ' ' + ordinal;
      el.style.cssText = style + 'font:bold 64px/1 system-ui,sans-serif';
      document.body.appendChild(el);
    }, { medal, ordinal, style });
  } else {
    await page.evaluate((style) => {
      const existing = document.getElementById('__race_medal');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.id = '__race_medal';
      el.textContent = '\u{1F3C1}';
      el.style.cssText = style + 'font:bold 80px/1 system-ui,sans-serif';
      document.body.appendChild(el);
    }, style);
  }
}

/**
 * Stateful overlay controller — manages recording dot, stopwatch/flag,
 * and re-injection after navigations. Keeps all overlay state and DOM
 * interaction out of runner.cjs.
 */
class OverlayController {
  constructor(page, { noOverlay = false, noRecording = false } = {}) {
    this._page = page;
    this._disabled = noOverlay || noRecording;
    this.dot = false;
    this.right = null;

    if (!this._disabled) {
      page.on('load', () => {
        if (this.dot || this.right) {
          setOverlay(page, this.dot, this.right).catch(() => {});
        }
      });
    }
  }

  async onStartRecording() {
    if (this._disabled) return;
    this.dot = true;
    await setOverlay(this._page, true, this.right);
  }

  async onMeasureStart() {
    if (this._disabled) return;
    this.right = '\u23F1\uFE0F';
    await setOverlay(this._page, this.dot, this.right);
  }

  onMeasureEnd() {
    if (this._disabled) return;
    this.right = '\u{1F3C1}';
    setOverlay(this._page, this.dot, this.right).catch(() => {});
  }

  async onStopRecording() {
    if (this._disabled) return;
    this.dot = false;
    await setOverlay(this._page, false, this.right);
  }

  async onFinish(place) {
    if (this._disabled) return;
    await showMedal(this._page, place);
  }
}

module.exports = {
  flashCue,
  setOverlay,
  showMedal,
  OverlayController,
  CUE_DURATION_MS,
  CUE_SIZE,

};
