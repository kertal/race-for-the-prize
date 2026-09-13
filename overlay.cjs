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
const CLOCK_TICK_MS = 100;   // 10 Hz: tenths tick visibly without hammering the main thread


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
 * Show, freeze, or remove the wall clock burned into the recording.
 *
 * The clock counts wall-clock time from `startEpochMs` — the runner's
 * recording start, the same origin the segment and measurement times use, so
 * the digits track the reported times (which are calibrated from the trace
 * afterwards) closely, and all racers in a parallel race read the same time in
 * the same frame.
 *
 * Opt-in (`--wall-clock`): the ticking text costs a style recalc and a paint
 * ten times a second, which shows up in the profile metrics and keeps
 * raceWaitForVisualStability from ever seeing the page settle.
 *
 * @param {Page} page - Playwright page
 * @param {number|null} startEpochMs - Epoch ms the clock counts from (null → remove the clock)
 * @param {number|null} [frozenAtEpochMs] - Epoch ms to freeze on (null → keep ticking)
 */
async function setClock(page, startEpochMs, frozenAtEpochMs = null) {
  await page.evaluate(({ start, frozen, tick }) => {
    if (globalThis.__raceClockTimer) {
      clearInterval(globalThis.__raceClockTimer);
      globalThis.__raceClockTimer = null;
    }
    let el = document.getElementById('__race_clock');
    if (start === null) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = '__race_clock';
      // Sits to the right of the recording dot; tabular numerals stop the
      // digits from jittering as they change.
      el.style.cssText = 'position:fixed;top:6px;left:30px;z-index:2147483647;'
        + 'font:bold 20px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;'
        + 'color:#fff;background:rgba(0,0,0,0.6);padding:5px 8px;border-radius:6px;pointer-events:none';
      document.body.appendChild(el);
    }
    // Integer tenths, so 59.97s reads "0:59.9" instead of rounding to "0:60.0".
    const render = (nowMs) => {
      const tenths = Math.max(0, Math.floor((nowMs - start) / 100));
      const mins = Math.floor(tenths / 600);
      const secs = Math.floor(tenths / 10) % 60;
      el.textContent = `${mins}:${String(secs).padStart(2, '0')}.${tenths % 10}`;
    };
    render(frozen === null ? Date.now() : frozen);
    if (frozen === null) {
      globalThis.__raceClockTimer = setInterval(() => render(Date.now()), tick);
    }
  }, { start: startEpochMs ?? null, frozen: frozenAtEpochMs ?? null, tick: CLOCK_TICK_MS });
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
  constructor(page, { noOverlay = false, noRecording = false, wallClock = false, timeBase = null, now = Date.now } = {}) {
    this._page = page;
    this._disabled = noOverlay || noRecording;
    this._now = now;
    // Epoch the race API counts its seconds from (context creation). Only used
    // to turn a reported finish time back into an epoch — never as the clock's
    // zero, which is set in onStartRecording().
    this._timeBase = timeBase;
    // The clock's zero, captured when recording actually starts. See
    // onStartRecording() for why it cannot be the context-creation epoch.
    this._clockStart = null;
    this._wallClock = wallClock && !this._disabled && timeBase !== null;
    this.dot = false;
    this.right = null;
    this.clockRunning = false;
    this.clockFrozenAt = null;

    if (!this._disabled) {
      page.on('load', () => {
        if (this.dot || this.right) {
          setOverlay(page, this.dot, this.right).catch(() => {});
        }
        // A navigation wipes the clock element and its timer — put them back.
        if (this.clockRunning || this.clockFrozenAt !== null) {
          setClock(page, this._clockStart, this.clockFrozenAt).catch(() => {});
        }
      });
    }
  }

  /**
   * @param {number} [startEpochMs] Epoch ms the clock counts from. Pass the
   *   recording-start moment whenever page work (the trace mark) sits between
   *   it and this call; defaults to now.
   */
  async onStartRecording(startEpochMs = this._now()) {
    if (this._disabled) return;
    await this._clearFinish();
    // Zero the clock on the moment recording starts, before any awaited page
    // work can push it later. This is the moment the player aligns every
    // racer's video on, so a clock counting from anything else reads a
    // different value on each racer at the same playback position. It used to
    // count from context creation, which sits a variable distance earlier —
    // page creation, navigation and whatever the spec does before
    // raceRecordingStart() all land in that gap.
    if (this._wallClock) this._clockStart = startEpochMs;
    this.dot = true;
    await setOverlay(this._page, true, this.right);
    if (this._wallClock) {
      this.clockRunning = true;
      this.clockFrozenAt = null;
      await setClock(this._page, this._clockStart, null);
    }
  }

  async onMeasureStart() {
    if (this._disabled) return;
    await this._clearFinish();
    // A later section resumes the same recording clock, retaining its zero.
    if (this._wallClock && this.dot && this.clockFrozenAt !== null) {
      this.clockRunning = true;
      this.clockFrozenAt = null;
      await setClock(this._page, this._clockStart, null);
    }
    this.right = '\u23F1\uFE0F';
    await setOverlay(this._page, this.dot, this.right);
  }

  async onMeasureEnd(finishSeconds = null, activeCount = 0) {
    if (this._disabled) return;
    if (activeCount > 0) return;
    this.right = '\u{1F3C1}';
    const updates = [];
    if (this._wallClock && this.clockRunning) {
      this.clockRunning = false;
      this.clockFrozenAt = this._freezeTime(finishSeconds);
      updates.push(setClock(this._page, this._clockStart, this.clockFrozenAt));
    }
    // Publish both flags at the measured finish, while the recording dot
    // remains visible through any post-race footage. Placement comes later.
    updates.push(setOverlay(this._page, this.dot, this.right));
    updates.push(showMedal(this._page, null));
    await Promise.all(updates);
  }

  async _clearFinish() {
    if (this.right !== '\u{1F3C1}') return;
    this.right = null;
    await this._page.evaluate(() => {
      document.getElementById('__race_medal')?.remove();
    });
  }

  /**
   * @param {number|null} [finishSeconds] The racer's finish time in seconds
   *   since the race API's time base. Falls back to the
   *   current time when the caller has none.
   */
  async onStopRecording(finishSeconds = null) {
    if (this._disabled) return;
    // Resolved before any page work: the medal and the overlay update are both
    // awaited first, so reading the clock afterwards would freeze the video on
    // a time later than the racer's actual finish.
    const frozenAt = this._wallClock ? this._freezeTime(finishSeconds) : null;
    this.dot = false;
    await setOverlay(this._page, false, this.right);
    if (this._wallClock && this.clockRunning) {
      // Fallback for recordings without a measurement. A measured finish has
      // already frozen the clock in onMeasureEnd, before any post-race wait.
      this.clockRunning = false;
      this.clockFrozenAt = frozenAt;
      await setClock(this._page, this._clockStart, frozenAt);
    }
  }

  /**
   * Epoch ms to freeze the clock on, so the burned-in time is the reported
   * finish time. finishSeconds is counted from the race API's own base, so it
   * converts against that — the clock then renders it relative to its own zero.
   */
  _freezeTime(finishSeconds) {
    if (finishSeconds === null || this._timeBase === null) return this._now();
    return this._timeBase + finishSeconds * 1000;
  }

  async onFinish(place) {
    if (this._disabled) return;
    await showMedal(this._page, place);
  }
}

module.exports = {
  flashCue,
  setOverlay,
  setClock,
  showMedal,
  OverlayController,
  CUE_DURATION_MS,
  CUE_SIZE,
  CLOCK_TICK_MS,
};
