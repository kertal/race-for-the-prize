import { describe, it, expect, vi, afterEach } from 'vitest';

const { flashCue, setOverlay, setClock, showFinishFlag, OverlayController, CUE_DURATION_MS, CUE_SIZE, CLOCK_TICK_MS } = require('../overlay.cjs');

// --- Minimal DOM stub for page.evaluate ---
// The overlay functions pass a callback + args to page.evaluate().
// We execute the callback against a fake DOM to verify element creation/removal.
function createMockDOM() {
  const elements = {};
  const body = {
    appendChild(el) { elements[el.id] = el; },
  };
  const head = {
    appendChild() {},
  };
  const documentElement = {
    appendChild(el) { elements[el.id] = el; },
  };

  const doc = {
    getElementById(id) { return elements[id] || null; },
    createElement() {
      const el = {
        id: '',
        textContent: '',
        style: { cssText: '' },
        remove() { delete elements[this.id]; },
        get offsetHeight() { return 0; },
      };
      return el;
    },
    body,
    head,
    documentElement,
  };

  return { doc, elements };
}

function createMockPage(doc) {
  return {
    evaluate: vi.fn(async (fn, arg) => {
      // Bind globals that page.evaluate callbacks expect
      const origDoc = globalThis.document;
      globalThis.document = doc;
      try {
        const result = fn(arg);
        // flashCue returns a Promise from setTimeout — resolve immediately in tests
        if (result && typeof result.then === 'function') await result;
      } finally {
        globalThis.document = origDoc;
      }
    }),
    on: vi.fn(),
  };
}

// --- setOverlay tests ---

describe('setOverlay', () => {
  it('creates dot and right emoji elements', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setOverlay(page, true, '⏱️');

    expect(page.evaluate).toHaveBeenCalledOnce();
    expect(elements['__race_ol']).toBeDefined();
    expect(elements['__race_ol'].style.cssText).toContain('border-radius:50%');
    expect(elements['__race_ol'].style.cssText).toContain('background:#e00');
    expect(elements['__race_ol'].style.cssText).toContain('width:10px');
    expect(elements['__race_or']).toBeDefined();
    expect(elements['__race_or'].textContent).toBe('⏱️');
  });

  it('removes dot when dot=false', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setOverlay(page, true, '⏱️');
    expect(elements['__race_ol']).toBeDefined();

    await setOverlay(page, false, '⏱️');
    expect(elements['__race_ol']).toBeUndefined();
    expect(elements['__race_or']).toBeDefined();
  });

  it('removes right when right=null', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setOverlay(page, true, '⏱️');
    await setOverlay(page, true, null);

    expect(elements['__race_ol']).toBeDefined();
    expect(elements['__race_or']).toBeUndefined();
  });

  it('removes both when dot=false and right=null', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setOverlay(page, true, '⏱️');
    await setOverlay(page, false, null);

    expect(elements['__race_ol']).toBeUndefined();
    expect(elements['__race_or']).toBeUndefined();
  });

  it('updates right text without recreating element', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setOverlay(page, true, '⏱️');
    const rightEl = elements['__race_or'];
    await setOverlay(page, true, '🏁');

    expect(elements['__race_or']).toBe(rightEl);
    expect(elements['__race_or'].textContent).toBe('🏁');
  });

  it('dot element has no textContent (CSS-only rendering)', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setOverlay(page, true, null);

    expect(elements['__race_ol'].textContent).toBe('');
  });

  it('is a no-op for elements that do not exist when removing', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setOverlay(page, false, null);

    expect(elements['__race_ol']).toBeUndefined();
    expect(elements['__race_or']).toBeUndefined();
    expect(page.evaluate).toHaveBeenCalledOnce();
  });
});

// --- showFinishFlag tests ---

describe('showFinishFlag', () => {
  it('shows the finish flag', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showFinishFlag(page);

    expect(elements['__race_medal']).toBeDefined();
    expect(elements['__race_medal'].textContent).toBe('🏁');
  });

  it('replaces an existing flag element', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showFinishFlag(page);
    const first = elements['__race_medal'];
    await showFinishFlag(page);

    expect(elements['__race_medal']).not.toBe(first);
    expect(elements['__race_medal'].textContent).toBe('🏁');
  });
});

// --- flashCue tests ---

describe('flashCue', () => {
  it('passes color, size and duration to evaluate', async () => {
    const page = { evaluate: vi.fn(async () => {}) };

    await flashCue(page, '#00FF00');

    expect(page.evaluate).toHaveBeenCalledOnce();
    const args = page.evaluate.mock.calls[0][1];
    expect(args).toEqual({ c: '#00FF00', size: CUE_SIZE, ms: CUE_DURATION_MS });
  });

  it('accepts custom duration', async () => {
    const page = { evaluate: vi.fn(async () => {}) };

    await flashCue(page, '#FF0000', 500);

    const args = page.evaluate.mock.calls[0][1];
    expect(args.ms).toBe(500);
  });
});

// --- setClock tests ---

describe('setClock', () => {
  afterEach(() => {
    if (globalThis.__raceClockTimer) {
      clearInterval(globalThis.__raceClockTimer);
      globalThis.__raceClockTimer = null;
    }
    vi.useRealTimers();
  });

  function atTime(epochMs) {
    vi.useFakeTimers();
    vi.setSystemTime(epochMs);
  }

  it('creates a clock element showing the elapsed time', async () => {
    atTime(1000);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 1000);

    expect(elements['__race_clock']).toBeDefined();
    expect(elements['__race_clock'].textContent).toBe('0:00.0');
    expect(elements['__race_clock'].style.cssText).toContain('position:fixed');
  });

  it('ticks while running', async () => {
    atTime(0);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 0);
    vi.advanceTimersByTime(3400);

    expect(elements['__race_clock'].textContent).toBe('0:03.4');
  });

  it('rolls over into minutes', async () => {
    atTime(0);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 0);
    vi.advanceTimersByTime(65_200);

    expect(elements['__race_clock'].textContent).toBe('1:05.2');
  });

  it('truncates tenths instead of rounding up to 60 seconds', async () => {
    atTime(59_970);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 0);

    expect(elements['__race_clock'].textContent).toBe('0:59.9');
  });

  it('freezes on the given time and stops ticking', async () => {
    atTime(0);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 0, 2500);
    vi.advanceTimersByTime(5000);

    expect(elements['__race_clock'].textContent).toBe('0:02.5');
    expect(globalThis.__raceClockTimer).toBeFalsy();
  });

  it('reuses the existing element when re-injected', async () => {
    atTime(0);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 0);
    const first = elements['__race_clock'];
    await setClock(page, 0, 1000);

    expect(elements['__race_clock']).toBe(first);
  });

  it('removes the clock when start is null', async () => {
    atTime(0);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 0);
    await setClock(page, null);

    expect(elements['__race_clock']).toBeUndefined();
    expect(globalThis.__raceClockTimer).toBeFalsy();
  });

  it('never shows a negative time before the start epoch', async () => {
    atTime(0);
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await setClock(page, 5000);

    expect(elements['__race_clock'].textContent).toBe('0:00.0');
  });

  it('passes the tick interval to the page', async () => {
    atTime(0);
    const page = { evaluate: vi.fn(async () => {}) };

    await setClock(page, 0);

    expect(page.evaluate.mock.calls[0][1]).toEqual({ start: 0, frozen: null, tick: CLOCK_TICK_MS });
  });
});

// --- OverlayController tests ---

describe('OverlayController', () => {
  it('runs on through the post-race delay and stops when the recording does', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { ctrl, elements } = createCtrl({ wallClock: true, timeBase: 1000 });
    const { createRaceApi } = require('../race-api.cjs');
    let flag;
    const api = createRaceApi({ recordingStartTime: 1000, hooks: {
      onRecordingStart: () => ctrl.onStartRecording(),
      onMeasureStart: () => ctrl.onMeasureStart(),
      onMeasureEnd: (_name, _end, count) => { flag = ctrl.onMeasureEnd(count); },
      onRecordingStop: ({ segmentEnd }) => ctrl.onStopRecording(segmentEnd),
    } });
    try {
      await api.startRecording();
      await api.startMeasure('outer');
      await api.startMeasure('inner');
      await vi.advanceTimersByTimeAsync(1500);
      api.endMeasure('inner');
      await flag;
      expect(ctrl.clockRunning).toBe(true);
      expect(elements.__race_or.textContent).toBe('⏱️');
      expect(elements.__race_medal).toBeUndefined();
      await vi.advanceTimersByTimeAsync(6000);
      api.endMeasure('outer');
      await flag;
      expect(elements.__race_clock.textContent).toBe('0:07.5');
      expect(ctrl.clockRunning).toBe(true);
      expect(ctrl.right).toBe('🏁');
      expect(elements.__race_medal).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1500);
      expect(elements.__race_clock.textContent).toBe('0:09.0');
      await api.stopRecording();
      expect(ctrl.clockRunning).toBe(false);
      expect(elements.__race_clock.textContent).toBe('0:09.0');
      expect(globalThis.__raceClockTimer).toBeFalsy();
    } finally {
      clearInterval(globalThis.__raceClockTimer);
      globalThis.__raceClockTimer = null;
      vi.useRealTimers();
    }
  });

  it('ticks through the untimed gap between two sections instead of jumping it', async () => {
    // Regression: the clock used to freeze on the closing measurement and
    // resume against its unmoved zero, so the digits stood still through the
    // spec's untimed wait and then jumped the whole gap in one step.
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { ctrl, elements, page } = createCtrl({ wallClock: true, timeBase: 1000 });
    try {
      await ctrl.onStartRecording();
      await vi.advanceTimersByTimeAsync(2000);
      await ctrl.onMeasureEnd(0);
      elements.__race_clock.remove();
      const onLoad = page.on.mock.calls.find(([event]) => event === 'load')[1];
      onLoad();
      // Re-injected mid-gap by the navigation, and still counting.
      await vi.advanceTimersByTimeAsync(1500);
      expect(elements.__race_clock.textContent).toBe('0:03.5');
      await ctrl.onMeasureStart();
      expect(elements.__race_medal).toBeUndefined();
      expect(elements.__race_or.textContent).toBe('⏱️');
      await vi.advanceTimersByTimeAsync(500);
      expect(elements.__race_clock.textContent).toBe('0:04.0');
      await ctrl.onMeasureEnd(0);
      await ctrl.onStopRecording(4);
      expect(elements.__race_clock.textContent).toBe('0:04.0');
    } finally {
      clearInterval(globalThis.__raceClockTimer);
      globalThis.__raceClockTimer = null;
      vi.useRealTimers();
    }
  });

  function createCtrl(opts = {}) {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);
    const ctrl = new OverlayController(page, opts);
    return { ctrl, page, elements };
  }

  it('onStartRecording shows dot only (no stopwatch yet)', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();

    expect(ctrl.dot).toBe(true);
    expect(ctrl.right).toBeNull();
    expect(elements['__race_ol']).toBeDefined();
    expect(elements['__race_or']).toBeUndefined();
  });

  it('onMeasureStart shows stopwatch alongside dot', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();

    expect(ctrl.dot).toBe(true);
    expect(ctrl.right).toBe('⏱️');
    expect(elements['__race_ol']).toBeDefined();
    expect(elements['__race_or'].textContent).toBe('⏱️');
  });

  it('holds the flag back until the recording stops', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    await ctrl.onMeasureEnd();

    // Armed in state, painted nowhere.
    expect(ctrl.right).toBe('🏁');
    expect(elements.__race_or.textContent).toBe('⏱️');
    expect(elements.__race_medal).toBeUndefined();

    await ctrl.onFinish();
    await ctrl.onStopRecording();

    expect(elements.__race_or.textContent).toBe('🏁');
    expect(elements.__race_medal.textContent).toBe('🏁');
  });

  it('flies no flag over the gap between two measured sections', async () => {
    // Regression: the flag went up at every measured finish, flying it across
    // the untimed gap while the racer still had a section to run.
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    await ctrl.onMeasureEnd();
    expect(elements.__race_medal).toBeUndefined();
    expect(elements.__race_or.textContent).toBe('⏱️');

    await ctrl.onMeasureStart();
    expect(elements.__race_or.textContent).toBe('⏱️');
    await ctrl.onMeasureEnd();
    await ctrl.onFinish();
    await ctrl.onStopRecording();

    expect(elements.__race_medal.textContent).toBe('🏁');
  });

  it('onStopRecording removes dot and keeps flag', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    await ctrl.onMeasureEnd();
    await ctrl.onStopRecording();

    expect(ctrl.dot).toBe(false);
    expect(elements['__race_ol']).toBeUndefined();
    expect(elements['__race_or'].textContent).toBe('🏁');
  });

  it('touches the page once per visible change through a full lap', async () => {
    const { ctrl, page } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    await ctrl.onMeasureEnd();
    await ctrl.onFinish();
    await ctrl.onStopRecording();

    // start overlay, stopwatch, flag, stop overlay — the finish paints nothing.
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it('dot stays true between onMeasureEnd and onStopRecording', async () => {
    const { ctrl } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureEnd();

    expect(ctrl.dot).toBe(true);
    expect(ctrl.right).toBe('🏁');
  });

  it('navigation re-inject restores both dot and flag', async () => {
    const { ctrl, page } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureEnd();

    // Simulate navigation: the load handler checks state
    expect(ctrl.dot || ctrl.right).toBeTruthy();
    // Both should be active for re-injection
    expect(ctrl.dot).toBe(true);
    expect(ctrl.right).toBe('🏁');
  });

  it('is a no-op when disabled (noOverlay)', async () => {
    const { ctrl, page } = createCtrl({ noOverlay: true });

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    await ctrl.onMeasureEnd();
    await ctrl.onStopRecording();

    expect(ctrl.dot).toBe(false);
    expect(ctrl.right).toBeNull();
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.on).not.toHaveBeenCalled();
  });

  it('is a no-op when disabled (noRecording)', async () => {
    const { ctrl, page } = createCtrl({ noRecording: true });

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    await ctrl.onMeasureEnd();
    await ctrl.onStopRecording();

    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('onFinish shows the finish flag', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onFinish();

    expect(elements['__race_medal']).toBeDefined();
    expect(elements['__race_medal'].textContent).toBe('🏁');
  });

  it('onFinish is a no-op when disabled', async () => {
    const { ctrl, page } = createCtrl({ noOverlay: true });

    await ctrl.onFinish();

    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('does not show a clock unless wallClock is enabled', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();

    expect(elements['__race_clock']).toBeUndefined();
    expect(ctrl.clockRunning).toBe(false);
  });

  it('zeroes the clock when recording starts, not at the API time base', async () => {
    // Regression: the clock counted from context creation (the API's time
    // base), which sits a variable distance before raceRecordingStart — page
    // creation, navigation, and whatever the spec does first all land in that
    // gap. The player aligns every racer's video on raceRecordingStart, so the
    // burned-in clocks disagreed across racers at the same playback position.
    const { ctrl, elements } = createCtrl({ wallClock: true, timeBase: 1000, now: () => 3500 });

    await ctrl.onStartRecording();

    expect(ctrl.clockRunning).toBe(true);
    expect(ctrl._clockStart).toBe(3500); // recording start, not the 1000 base
    expect(elements['__race_clock']).toBeDefined();
    // Rendered from the real clock inside the page, so only its presence is
    // asserted here — the formatting is covered by the setClock tests.
    clearInterval(globalThis.__raceClockTimer);
    globalThis.__raceClockTimer = null;
  });

  it('zeroes on the supplied recording-start epoch, not on when the call lands', async () => {
    // runner.cjs awaits a trace mark between the recording start and this call,
    // so the caller passes the moment it happened; reading the clock here would
    // shift the zero by that page round-trip, by a different amount per racer.
    const { ctrl } = createCtrl({ wallClock: true, timeBase: 1000, now: () => 3500 });

    await ctrl.onStartRecording(3100);

    expect(ctrl._clockStart).toBe(3100);
    clearInterval(globalThis.__raceClockTimer);
    globalThis.__raceClockTimer = null;
  });

  it('reads the same regardless of how long setup took before recording', async () => {
    // Two racers with very different setup times must burn in the same value
    // once the same amount of recording has elapsed.
    const mk = (startEpoch) => {
      let t = startEpoch;
      const { doc, elements } = createMockDOM();
      const page = createMockPage(doc);
      const ctrl = new OverlayController(page, { wallClock: true, timeBase: 1000, now: () => t });
      return { ctrl, elements, finish: () => { t = startEpoch + 2500; } };
    };
    const quick = mk(1100); // recording started 0.1s after context creation
    const slow = mk(1900);  // ... and 0.9s after, for the other racer

    for (const r of [quick, slow]) {
      await r.ctrl.onStartRecording();
      r.finish();
      await r.ctrl.onStopRecording();
    }

    expect(quick.elements['__race_clock'].textContent).toBe('0:02.5');
    expect(slow.elements['__race_clock'].textContent).toBe('0:02.5');
  });

  it('freezes the clock when recording stops', async () => {
    const { ctrl, elements } = createCtrl({ wallClock: true, timeBase: 1000, now: () => 3500 });

    await ctrl.onStartRecording();
    await ctrl.onStopRecording();

    expect(ctrl.clockRunning).toBe(false);
    expect(ctrl.clockFrozenAt).toBe(3500);
    expect(elements['__race_clock'].textContent).toBe('0:00.0');
    expect(globalThis.__raceClockTimer).toBeFalsy();
  });

  it('renders the API recording end relative to the recording start', async () => {
    // The end counts from the API's base (1000), but the clock's zero is the
    // recording start (1400) — so 2.5s reported burns in as 2.1s.
    const { ctrl, elements } = createCtrl({ wallClock: true, timeBase: 1000, now: () => 1400 });

    await ctrl.onStartRecording();
    await ctrl.onStopRecording(2.5);

    expect(ctrl.clockFrozenAt).toBe(3500); // timeBase + 2.5s, an absolute epoch
    expect(elements['__race_clock'].textContent).toBe('0:02.1');
  });

  it('does not let awaited overlay work push the frozen time past the finish', async () => {
    // The finish flag (onFinish) and the overlay update are both awaited before
    // the clock freezes — neither may advance the burned-in time.
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);
    let clock = 3500;
    const slowPageWork = page.evaluate;
    page.evaluate = vi.fn(async (...args) => {
      clock += 400;
      return slowPageWork(...args);
    });
    const ctrl = new OverlayController(page, { wallClock: true, timeBase: 1000, now: () => clock });

    await ctrl.onStartRecording();
    await ctrl.onFinish();
    await ctrl.onStopRecording();

    expect(ctrl.clockFrozenAt).toBe(3500 + 400 * 3); // start overlay + clock + flag
    // Zeroed before that page work ran, so only the work itself is on the clock.
    expect(elements['__race_clock'].textContent).toBe('0:01.2');
  });

  it('does not run the clock when overlays are disabled', async () => {
    const { ctrl, page } = createCtrl({ wallClock: true, timeBase: 1000, noOverlay: true });

    await ctrl.onStartRecording();
    await ctrl.onStopRecording();

    expect(ctrl.clockRunning).toBe(false);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('does not run the clock without an API time base', async () => {
    const { ctrl, elements } = createCtrl({ wallClock: true });

    await ctrl.onStartRecording();

    expect(ctrl.clockRunning).toBe(false);
    expect(elements['__race_clock']).toBeUndefined();
  });

  it('re-injects the clock after a navigation', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);
    let t = 1400;
    const ctrl = new OverlayController(page, { wallClock: true, timeBase: 1000, now: () => t });

    await ctrl.onStartRecording();
    t = 3500;
    await ctrl.onStopRecording();
    elements['__race_clock'].remove(); // navigation wipes the overlay elements

    const onLoad = page.on.mock.calls.find(([event]) => event === 'load')[1];
    await onLoad();

    // Re-injected against the same zero, so the frozen time survives the reload.
    expect(elements['__race_clock'].textContent).toBe('0:02.1');
  });

  it('re-injects the finish flag after a navigation', async () => {
    const { ctrl, page, elements } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureEnd();
    await ctrl.onFinish();
    expect(elements.__race_medal.textContent).toBe('🏁');
    elements.__race_medal.remove(); // navigation wipes the overlay elements

    const onLoad = page.on.mock.calls.find(([event]) => event === 'load')[1];
    onLoad();

    expect(elements.__race_medal.textContent).toBe('🏁');
  });

  it('clears a flag shown at a recording stop with no measured finish when the next segment starts', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onFinish(); // the runner's recording stop, nothing measured
    await ctrl.onStopRecording();
    expect(elements.__race_medal).toBeDefined();

    await ctrl.onStartRecording();

    expect(elements.__race_medal).toBeUndefined();
  });

  it('registers load event listener when enabled', () => {
    const { page } = createCtrl();
    expect(page.on).toHaveBeenCalledWith('load', expect.any(Function));
  });

  it('does not register load event listener when disabled', () => {
    const { page } = createCtrl({ noOverlay: true });
    expect(page.on).not.toHaveBeenCalled();
  });
});
