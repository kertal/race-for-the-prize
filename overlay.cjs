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
const MEDAL_DISPLAY_MS = 500; // How long to show the placement medal overlay

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
    var sheet = document.createElement('style');
    sheet.textContent = '@keyframes __rcue{50%{opacity:.999}}';
    document.head.appendChild(sheet);
    document.documentElement.appendChild(el);
    el.offsetHeight;
    return new Promise(resolve => setTimeout(() => {
      el.remove(); sheet.remove(); resolve();
    }, ms));
  }, { c: color, size: CUE_SIZE, ms: dur });
}

/**
 * Inject or update the recording overlay indicator element.
 *
 * @param {Page} page - Playwright page
 * @param {string} text - Text to display
 * @param {string} bg - CSS background color
 */
async function injectOverlay(page, text, bg) {
  await page.evaluate(({ text, bg }) => {
    let el = document.getElementById('__race_rec_indicator');
    if (!el) {
      el = document.createElement('div');
      el.id = '__race_rec_indicator';
      el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;'
        + 'color:#fff;padding:4px 10px;border-radius:6px;'
        + 'font:bold 14px/1 system-ui,sans-serif;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.background = bg;
  }, { text, bg });
}

/**
 * Show the recording indicator (red "REC" badge).
 *
 * @param {Page} page - Playwright page
 * @returns {{ text: string, bg: string }} The overlay state for tracking
 */
async function showRecordingIndicator(page) {
  const state = { text: '\u{1F4F9} REC', bg: 'rgba(220,38,38,0.85)' };
  await injectOverlay(page, state.text, state.bg);
  return state;
}

/**
 * Show the finish time overlay (green badge with duration).
 *
 * @param {Page} page - Playwright page
 * @param {number} duration - Race duration in seconds
 * @returns {{ text: string, bg: string }} The overlay state for tracking
 */
function showFinishTime(page, duration) {
  const state = { text: '\u{1F3C1} ' + duration.toFixed(1) + 's', bg: 'rgba(22,163,74,0.85)' };
  injectOverlay(page, state.text, state.bg).catch(() => {});
  return state;
}

/**
 * Hide the recording indicator overlay.
 *
 * @param {Page} page - Playwright page
 */
async function hideRecordingIndicator(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__race_rec_indicator');
    if (el) el.remove();
  });
}

/**
 * Show the placement medal (parallel mode) or finish flag (sequential mode).
 * Pure presentation — caller handles finish order tracking and placement calculation.
 *
 * @param {Page} page - Playwright page
 * @param {number|null} place - 1-based placement (null → sequential mode, shows finish flag)
 */
async function showMedal(page, place) {
  if (place) {
    const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}', '4\uFE0F\u20E3', '5\uFE0F\u20E3'];
    const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
    const medal = medals[place - 1] || `${place}`;
    const ordinal = ordinals[place - 1] || `${place}th`;
    await page.evaluate(({ medal, ordinal }) => {
      const el = document.createElement('div');
      el.id = '__race_medal';
      el.textContent = medal + ' ' + ordinal;
      el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
        + 'font:bold 64px/1 system-ui,sans-serif;pointer-events:none;'
        + 'background:rgba(0,0,0,0.6);color:#fff;padding:24px 48px;border-radius:16px';
      document.body.appendChild(el);
    }, { medal, ordinal });
  } else {
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = '__race_medal';
      el.textContent = '\u{1F3C1}';
      el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
        + 'font:bold 80px/1 system-ui,sans-serif;pointer-events:none;'
        + 'background:rgba(0,0,0,0.6);color:#fff;padding:24px 48px;border-radius:16px';
      document.body.appendChild(el);
    });
  }
  await page.waitForTimeout(MEDAL_DISPLAY_MS);
}

module.exports = {
  flashCue,
  injectOverlay,
  showRecordingIndicator,
  hideRecordingIndicator,
  showFinishTime,
  showMedal,
  CUE_DURATION_MS,
  CUE_SIZE,
  MEDAL_DISPLAY_MS,
};
