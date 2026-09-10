import { describe, it, expect, vi, afterEach } from 'vitest';

const { flashCue, setOverlay, setClock, showMedal, OverlayController, CUE_DURATION_MS, CUE_SIZE, CLOCK_TICK_MS } = require('../overlay.cjs');

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

// --- showMedal tests ---

describe('showMedal', () => {
  it('shows 1st place medal', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showMedal(page, 1);

    expect(elements['__race_medal']).toBeDefined();
    expect(elements['__race_medal'].textContent).toBe('🥇 1st');
  });

  it('shows 2nd place medal', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showMedal(page, 2);
    expect(elements['__race_medal'].textContent).toBe('🥈 2nd');
  });

  it('shows 3rd place medal', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showMedal(page, 3);
    expect(elements['__race_medal'].textContent).toBe('🥉 3rd');
  });

  it('shows finish flag for sequential mode (place=null)', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showMedal(page, null);
    expect(elements['__race_medal'].textContent).toBe('🏁');
  });

  it('replaces existing medal element', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showMedal(page, 1);
    const first = elements['__race_medal'];
    await showMedal(page, 2);

    expect(elements['__race_medal']).not.toBe(first);
    expect(elements['__race_medal'].textContent).toBe('🥈 2nd');
  });

  it('falls back to number for places > 5', async () => {
    const { doc, elements } = createMockDOM();
    const page = createMockPage(doc);

    await showMedal(page, 7);
    expect(elements['__race_medal'].textContent).toBe('7 7th');
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

  it('onMeasureEnd updates state to flag without calling setOverlay', async () => {
    const { ctrl, page } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    const callCount = page.evaluate.mock.calls.length;

    ctrl.onMeasureEnd();

    expect(ctrl.right).toBe('🏁');
    expect(page.evaluate.mock.calls.length).toBe(callCount);
  });

  it('onStopRecording removes dot and keeps flag', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    ctrl.onMeasureEnd();
    await ctrl.onStopRecording();

    expect(ctrl.dot).toBe(false);
    expect(elements['__race_ol']).toBeUndefined();
    expect(elements['__race_or'].textContent).toBe('🏁');
  });

  it('full lifecycle: 3 setOverlay calls (start, measure, stop)', async () => {
    const { ctrl, page } = createCtrl();

    await ctrl.onStartRecording();
    await ctrl.onMeasureStart();
    ctrl.onMeasureEnd();
    await ctrl.onStopRecording();

    // onStartRecording → 1, onMeasureStart → 1, onStopRecording → 1
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('dot stays true between onMeasureEnd and onStopRecording', async () => {
    const { ctrl } = createCtrl();

    await ctrl.onStartRecording();
    ctrl.onMeasureEnd();

    expect(ctrl.dot).toBe(true);
    expect(ctrl.right).toBe('🏁');
  });

  it('navigation re-inject restores both dot and flag', async () => {
    const { ctrl, page } = createCtrl();

    await ctrl.onStartRecording();
    ctrl.onMeasureEnd();

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
    ctrl.onMeasureEnd();
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
    ctrl.onMeasureEnd();
    await ctrl.onStopRecording();

    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('onFinish calls showMedal with placement', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onFinish(1);

    expect(elements['__race_medal']).toBeDefined();
    expect(elements['__race_medal'].textContent).toBe('🥇 1st');
  });

  it('onFinish is a no-op when disabled', async () => {
    const { ctrl, page } = createCtrl({ noOverlay: true });

    await ctrl.onFinish(1);

    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('does not show a clock unless wallClock is enabled', async () => {
    const { ctrl, elements } = createCtrl();

    await ctrl.onStartRecording();

    expect(elements['__race_clock']).toBeUndefined();
    expect(ctrl.clockRunning).toBe(false);
  });

  it('starts the clock at the recording start epoch', async () => {
    const { ctrl, elements } = createCtrl({ wallClock: true, clockStart: 1000, now: () => 3500 });

    await ctrl.onStartRecording();

    expect(ctrl.clockRunning).toBe(true);
    expect(elements['__race_clock']).toBeDefined();
    // Rendered from the real clock inside the page, so only its presence is
    // asserted here — the formatting is covered by the setClock tests.
    clearInterval(globalThis.__raceClockTimer);
    globalThis.__raceClockTimer = null;
  });

  it('freezes the clock on the finish time when recording stops', async () => {
    const { ctrl, elements } = createCtrl({ wallClock: true, clockStart: 1000, now: () => 3500 });

    await ctrl.onStartRecording();
    await ctrl.onStopRecording();

    expect(ctrl.clockRunning).toBe(false);
    expect(ctrl.clockFrozenAt).toBe(3500);
    expect(elements['__race_clock'].textContent).toBe('0:02.5');
    expect(globalThis.__raceClockTimer).toBeFalsy();
  });

  it('does not run the clock when overlays are disabled', async () => {
    const { ctrl, page } = createCtrl({ wallClock: true, clockStart: 1000, noOverlay: true });

    await ctrl.onStartRecording();
    await ctrl.onStopRecording();

    expect(ctrl.clockRunning).toBe(false);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('does not run the clock without a start epoch', async () => {
    const { ctrl, elements } = createCtrl({ wallClock: true });

    await ctrl.onStartRecording();

    expect(ctrl.clockRunning).toBe(false);
    expect(elements['__race_clock']).toBeUndefined();
  });

  it('re-injects the clock after a navigation', async () => {
    const { ctrl, page, elements } = createCtrl({ wallClock: true, clockStart: 1000, now: () => 3500 });

    await ctrl.onStartRecording();
    await ctrl.onStopRecording();
    elements['__race_clock'].remove(); // navigation wipes the overlay elements

    const onLoad = page.on.mock.calls.find(([event]) => event === 'load')[1];
    await onLoad();

    expect(elements['__race_clock'].textContent).toBe('0:02.5');
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
