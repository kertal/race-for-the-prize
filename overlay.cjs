/**
 * overlay.cjs — Visual overlay helpers for RaceForThePrize runner.
 *
 * Pure presentation functions that inject CSS/HTML into browser pages
 * for visual cues, recording indicators, finish times, and the finish flag.
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
 * Set or remove overlay indicators in one evaluate call: the recording dot,
 * the corner emoji, and — when asked — the centered finish flag. One call
 * means one browser task, so the screencast never catches the corner and the
 * centre disagreeing about whether the racer has finished.
 *
 * @param {Page} page - Playwright page
 * @param {boolean} dot - Show recording dot (left)
 * @param {string|null} right - Right indicator emoji (e.g. stopwatch/flag) or null to hide
 * @param {boolean|null} [flag] - true paints the centered finish flag (replacing
 *   any existing one), false removes it, null leaves it as it is
 */
async function setOverlay(page, dot, right, flag = null) {
  await page.evaluate(({ d, r, f }) => {
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
    if (f === null) return;
    // Placement is not known in the page — the player works it out from the
    // final measurements — so the recording only ever marks the moment a
    // racer finished.
    const existing = document.getElementById('__race_medal');
    if (existing) existing.remove();
    if (!f) return;
    el = document.createElement('div');
    el.id = '__race_medal';
    el.textContent = '\u{1F3C1}';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
      + 'pointer-events:none;background:rgba(0,0,0,0.6);color:#fff;padding:24px 48px;border-radius:16px;'
      + 'font:bold 80px/1 system-ui,sans-serif';
    document.body.appendChild(el);
  }, { d: dot, r: right, f: flag });
}

/**
 * Show, freeze, or remove the wall clock burned into the recording.
 *
 * The clock counts wall-clock time from `startEpochMs` — the runner's
 * recording start, the same origin the segment and measurement times use, so
 * the digits track the reported times (which are calibrated from the trace
 * afterwards) closely, and all racers in a parallel race read the same time in
 * the same frame. It runs for the whole recording and stops only when the
 * recording does: a spec's untimed waits between sections are time the video
 * spends, so the clock spends it too.
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
    this.finishShown = false;

    if (!this._disabled) {
      page.on('load', () => {
        // A navigation wipes the overlay elements — put them back in one go,
        // the finish flag included, so corner and centre reappear together.
        if (this.dot || this.right || this.finishShown) {
          setOverlay(page, this.dot, this.right, this.finishShown ? true : null).catch(() => {});
        }
        // So does the clock element and its timer.
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
    const dropFlag = this._clearFinish();
    // Zero the clock on the moment recording starts, before any awaited page
    // work can push it later. This is the moment the player aligns every
    // racer's video on, so a clock counting from anything else reads a
    // different value on each racer at the same playback position. It used to
    // count from context creation, which sits a variable distance earlier —
    // page creation, navigation and whatever the spec does before
    // raceRecordingStart() all land in that gap.
    if (this._wallClock) this._clockStart = startEpochMs;
    this.dot = true;
    await setOverlay(this._page, true, this.right, dropFlag ? false : null);
    if (this._wallClock) {
      this.clockRunning = true;
      this.clockFrozenAt = null;
      await setClock(this._page, this._clockStart, null);
    }
  }

  async onMeasureStart() {
    if (this._disabled) return;
    const dropFlag = this._clearFinish();
    this.right = '\u23F1\uFE0F';
    await setOverlay(this._page, this.dot, this.right, dropFlag ? false : null);
  }

  /**
   * Arms the flag without painting it: a multi-section spec closes a
   * measurement per section, and a flag raised there would fly over the gap
   * that follows. It goes up at the recording stop instead. The clock keeps
   * running for the same reason — freezing and resuming would make the digits
   * jump that gap in one step.
   *
   * @param {number} [activeCount] Measurements still open; the finish is the
   *   last one to close.
   */
  async onMeasureEnd(activeCount = 0) {
    if (this._disabled) return;
    if (activeCount > 0) return;
    this.right = '\u{1F3C1}';
  }

  /**
   * Disarms the flag. Returns whether a painted flag has to come down, so the
   * caller can fold that into its own overlay update instead of paying a
   * separate page round trip.
   */
  _clearFinish() {
    // `right` is armed at every measured finish; the element exists only if a
    // flag was painted.
    if (this.right === '\u{1F3C1}') this.right = null;
    if (!this.finishShown) return false;
    this.finishShown = false;
    return true;
  }

  /**
   * @param {number|null} [recordingEndSeconds] When the recording segment
   *   closed, in seconds since the race API's time base. Falls back to the
   *   current time when the caller has none.
   */
  async onStopRecording(recordingEndSeconds = null) {
    if (this._disabled) return;
    // Resolved before any page work: the finish flag and the overlay update are
    // both awaited first, so reading the clock afterwards would freeze the
    // video on a time later than the recording's own end.
    const frozenAt = this._wallClock ? this._freezeTime(recordingEndSeconds) : null;
    this.dot = false;
    await setOverlay(this._page, false, this.right);
    if (this._wallClock && this.clockRunning) {
      // The clock's one and only stop: it runs from raceRecordingStart to here.
      this.clockRunning = false;
      this.clockFrozenAt = frozenAt;
      await setClock(this._page, this._clockStart, frozenAt);
    }
  }

  /**
   * Epoch ms to freeze the clock on, so the burned-in time is the recording's
   * own end as the results report it. The seconds are counted from the race
   * API's own base, so they convert against that — the clock then renders the
   * result relative to its own zero.
   */
  _freezeTime(seconds) {
    if (seconds === null || this._timeBase === null) return this._now();
    return this._timeBase + seconds * 1000;
  }

  /**
   * Raises the flag at the recording stop — the one moment a racer is done —
   * but only if a measured finish armed it: a segment recorded without a
   * measurement (b-roll, a bare raceRecordingStart/End pair) has no finish to
   * fly. Corner and centre flip in the same page update, so the screencast
   * never catches a stopwatch beside a finish flag. Placement stays out of the
   * video; the player badges it from the results.
   *
   * @returns {Promise<boolean>} whether a flag was painted
   */
  async onFinish() {
    if (this._disabled || this.right !== '\u{1F3C1}') return false;
    this.finishShown = true;
    await setOverlay(this._page, this.dot, this.right, true);
    return true;
  }
}

module.exports = {
  flashCue,
  setOverlay,
  setClock,
  OverlayController,
  CUE_DURATION_MS,
  CUE_SIZE,
  CLOCK_TICK_MS,
};
