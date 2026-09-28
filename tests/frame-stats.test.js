import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  deriveFrameStats,
  summarizeWindow,
  summarizeWindows,
  estimateDisplayPeriodMs,
  collectDrawTimestamps,
} = require('../frame-stats.cjs');
const { deriveTraceTiming } = require('../trace-calibration.cjs');

/** A DrawFrame instant event at `ts` microseconds, shaped like Chrome's. */
function drawFrame(ts, frameSeqId = 0) {
  return {
    name: 'DrawFrame',
    ph: 'I',
    cat: 'disabled-by-default-devtools.timeline.frame',
    ts,
    args: { frameSeqId, layerTreeId: 1 },
  };
}

/**
 * A run of frames starting at `startTs` (µs), each `periodMs` apart.
 * Returns the events plus the timestamp one past the last frame.
 */
function frameRun(startTs, count, periodMs) {
  const events = [];
  let ts = startTs;
  for (let i = 0; i < count; i++) {
    events.push(drawFrame(ts, i));
    ts += periodMs * 1000;
  }
  return { events, endTs: ts };
}

function buildTrace(events) {
  return JSON.stringify({ traceEvents: events });
}

describe('collectDrawTimestamps', () => {
  it('takes instant DrawFrame events in timestamp order', () => {
    const timestamps = collectDrawTimestamps([
      drawFrame(3000),
      drawFrame(1000),
      drawFrame(2000),
    ]);
    expect(timestamps).toEqual([1000, 2000, 3000]);
  });

  it('ignores other events and non-instant phases', () => {
    const timestamps = collectDrawTimestamps([
      drawFrame(1000),
      { name: 'DrawFrame', ph: 'X', ts: 1500, dur: 10 },
      { name: 'AnimationFrame::Presentation', ph: 'n', ts: 1800 },
      { name: 'Screenshot', ts: 1900 },
      drawFrame(2000),
    ]);
    expect(timestamps).toEqual([1000, 2000]);
  });

  it('skips events without a finite timestamp', () => {
    const timestamps = collectDrawTimestamps([
      drawFrame(1000),
      { name: 'DrawFrame', ph: 'I' },
      { name: 'DrawFrame', ph: 'I', ts: NaN },
      drawFrame(2000),
    ]);
    expect(timestamps).toEqual([1000, 2000]);
  });
});

describe('estimateDisplayPeriodMs', () => {
  it('finds 60Hz from a steady run', () => {
    const intervals = Array(50).fill(16.7);
    expect(estimateDisplayPeriodMs(intervals)).toBeCloseTo(16.7, 5);
  });

  it('finds 120Hz even when most frames are janky', () => {
    // 80% of the race drops frames; the display is still capable of 120Hz and
    // a median-based estimate would wrongly report the jank as the baseline.
    const intervals = [...Array(10).fill(8.3), ...Array(40).fill(50)];
    expect(estimateDisplayPeriodMs(intervals)).toBeCloseTo(8.3, 5);
  });

  it('ignores implausibly small gaps', () => {
    const intervals = [0.2, 0.3, ...Array(20).fill(16.7)];
    expect(estimateDisplayPeriodMs(intervals)).toBeCloseTo(16.7, 5);
  });

  it('returns null when nothing is plausible', () => {
    expect(estimateDisplayPeriodMs([0.1, 0.2])).toBeNull();
    expect(estimateDisplayPeriodMs([])).toBeNull();
  });
});

describe('summarizeWindow', () => {
  it('reports fps and the frame time distribution', () => {
    const { events } = frameRun(1_000_000, 61, 16.7);
    const timestamps = events.map(e => e.ts);
    const stats = summarizeWindow(timestamps, 25);
    expect(stats.frames).toBe(61);
    expect(stats.fps).toBeCloseTo(59.9, 1);
    expect(stats.medianFrameMs).toBeCloseTo(16.7, 1);
    expect(stats.worstFrameMs).toBeCloseTo(16.7, 1);
    expect(stats.droppedFrames).toBe(0);
  });

  it('counts frames over the budget as dropped', () => {
    // Nine 16.7ms frames and three 50ms stalls.
    const timestamps = [0];
    for (const ms of [...Array(9).fill(16.7), 50, 50, 50]) {
      timestamps.push(timestamps[timestamps.length - 1] + ms * 1000);
    }
    const stats = summarizeWindow(timestamps, 25);
    expect(stats.droppedFrames).toBe(3);
    expect(stats.worstFrameMs).toBeCloseTo(50, 1);
    expect(stats.medianFrameMs).toBeCloseTo(16.7, 1);
  });

  it('returns null below three frames', () => {
    expect(summarizeWindow([], 25)).toBeNull();
    expect(summarizeWindow([1000], 25)).toBeNull();
    expect(summarizeWindow([1000, 2000], 25)).toBeNull();
  });

  it('returns null when every frame shares one timestamp', () => {
    expect(summarizeWindow([1000, 1000, 1000], 25)).toBeNull();
  });

  it('reports a null dropped count when the budget is unknown', () => {
    const { events } = frameRun(0, 10, 16.7);
    expect(summarizeWindow(events.map(e => e.ts), null).droppedFrames).toBeNull();
  });
});

describe('deriveFrameStats', () => {
  it('separates a smooth section from a janky one', () => {
    // 120Hz display: a clean section, then one blocked by a 40ms handler.
    const smooth = frameRun(1_000_000, 60, 8.3);
    const janky = frameRun(smooth.endTs + 100_000, 20, 40);
    const events = [
      { name: 'race:recording:start', ts: 900_000 },
      { name: 'race:measure:start:smooth', ts: 999_000 },
      ...smooth.events,
      { name: 'race:measure:end:smooth', ts: smooth.endTs },
      { name: 'race:measure:start:janky', ts: smooth.endTs + 99_000 },
      ...janky.events,
      { name: 'race:measure:end:janky', ts: janky.endTs },
      { name: 'race:recording:end', ts: janky.endTs + 1000 },
    ];
    const trace = buildTrace(events);
    const { measurements } = deriveTraceTiming(trace);
    const stats = deriveFrameStats(trace, measurements);

    // The display period is derived from the whole race, so the janky section
    // is judged against 120Hz rather than against its own sluggish median.
    expect(stats.displayFrameMs).toBeCloseTo(8.3, 1);
    expect(stats.budgetFrameMs).toBeCloseTo(12.5, 1);

    expect(stats.sections.smooth.fps).toBeCloseTo(120.5, 0);
    expect(stats.sections.smooth.droppedFrames).toBe(0);

    expect(stats.sections.janky.fps).toBeCloseTo(25, 0);
    expect(stats.sections.janky.medianFrameMs).toBeCloseTo(40, 1);
    // Every frame in the section missed the 12.5ms budget.
    expect(stats.sections.janky.droppedFrames).toBe(19);
  });

  it('pools the frames of a section that ran more than once', () => {
    const first = frameRun(1_000_000, 10, 16.7);
    const second = frameRun(first.endTs + 500_000, 10, 16.7);
    const events = [
      { name: 'race:recording:start', ts: 900_000 },
      { name: 'race:measure:start:Scroll', ts: 999_000 },
      ...first.events,
      { name: 'race:measure:end:Scroll', ts: first.endTs },
      { name: 'race:measure:start:Scroll', ts: second.events[0].ts - 1000 },
      ...second.events,
      { name: 'race:measure:end:Scroll', ts: second.endTs },
      { name: 'race:recording:end', ts: second.endTs + 1000 },
    ];
    const trace = buildTrace(events);
    const { measurements } = deriveTraceTiming(trace);
    expect(measurements).toHaveLength(2);

    const stats = deriveFrameStats(trace, measurements);
    expect(stats.sections.Scroll.frames).toBe(20);
  });

  it('decodes section names with spaces', () => {
    const run = frameRun(1_000_000, 10, 16.7);
    const encoded = encodeURIComponent('Scroll to Bottom');
    const trace = buildTrace([
      { name: 'race:recording:start', ts: 900_000 },
      { name: `race:measure:start:${encoded}`, ts: 999_000 },
      ...run.events,
      { name: `race:measure:end:${encoded}`, ts: run.endTs },
      { name: 'race:recording:end', ts: run.endTs + 1000 },
    ]);
    const { measurements } = deriveTraceTiming(trace);
    const stats = deriveFrameStats(trace, measurements);
    expect(stats.sections['Scroll to Bottom'].frames).toBe(10);
  });

  it('still reports the total when no sections were measured', () => {
    const run = frameRun(1_000_000, 30, 16.7);
    const stats = deriveFrameStats(buildTrace(run.events), []);
    expect(stats.total.frames).toBe(30);
    expect(stats.sections).toEqual({});
  });

  it('reports a null section when too few frames fall inside it', () => {
    const run = frameRun(1_000_000, 30, 16.7);
    const trace = buildTrace([
      { name: 'race:recording:start', ts: 900_000 },
      // A window that closes before the second frame is drawn.
      { name: 'race:measure:start:blink', ts: 999_000 },
      ...run.events,
      { name: 'race:measure:end:blink', ts: 1_005_000 },
      { name: 'race:recording:end', ts: run.endTs },
    ]);
    const { measurements } = deriveTraceTiming(trace);
    const stats = deriveFrameStats(trace, measurements);
    expect(stats.sections.blink).toBeNull();
    expect(stats.total.frames).toBe(30);
  });

  it('returns null for a trace with no DrawFrame events', () => {
    // What a race traced without the frame category looks like.
    const trace = buildTrace([
      { name: 'race:recording:start', ts: 900_000 },
      { name: 'AnimationFrame::Presentation', ph: 'n', ts: 1_000_000 },
      { name: 'race:recording:end', ts: 2_000_000 },
    ]);
    expect(deriveFrameStats(trace, [])).toBeNull();
  });

  it('returns null for unusable input', () => {
    expect(deriveFrameStats(null)).toBeNull();
    expect(deriveFrameStats('not json')).toBeNull();
    expect(deriveFrameStats(buildTrace([]))).toBeNull();
  });

  it('accepts an already-parsed trace object', () => {
    const run = frameRun(1_000_000, 30, 16.7);
    const stats = deriveFrameStats({ traceEvents: run.events }, []);
    expect(stats.total.frames).toBe(30);
  });

  it('ignores measurements whose timestamps are missing or inverted', () => {
    const run = frameRun(1_000_000, 30, 16.7);
    const stats = deriveFrameStats(buildTrace(run.events), [
      { name: 'noStart', endTraceTs: 2_000_000 },
      { name: 'inverted', startTraceTs: 2_000_000, endTraceTs: 1_000_000 },
      { name: 'ok', startTraceTs: 1_000_000, endTraceTs: run.endTs },
    ]);
    expect(Object.keys(stats.sections)).toEqual(['ok']);
  });
});

describe('estimateDisplayPeriodMs cluster behaviour', () => {
  it('reports the hardware period, not a few early frames', () => {
    // A 120Hz run where vsync jitter lands some gaps slightly under 8.3ms.
    // The percentile alone would call this a ~7.5ms (133Hz) display and then
    // judge honest 8.3ms frames against too tight a budget.
    const intervals = [7.4, 7.5, 7.6, ...Array(40).fill(8.3), ...Array(10).fill(9.0)];
    expect(estimateDisplayPeriodMs(intervals)).toBeCloseTo(8.3, 1);
  });
});

describe('the measured scope', () => {
  it('combines sections without treating the gap between them as a frame', () => {
    // Two 60Hz sections a full second apart. Flattening them into one list
    // would invent a ~1000ms frame and halve the reported fps.
    const first = frameRun(1_000_000, 30, 16.7);
    const second = frameRun(first.endTs + 1_000_000, 30, 16.7);
    const trace = buildTrace([
      { name: 'race:recording:start', ts: 900_000 },
      { name: 'race:measure:start:one', ts: 999_000 },
      ...first.events,
      { name: 'race:measure:end:one', ts: first.endTs },
      { name: 'race:measure:start:two', ts: second.events[0].ts - 1000 },
      ...second.events,
      { name: 'race:measure:end:two', ts: second.endTs },
      { name: 'race:recording:end', ts: second.endTs + 1000 },
    ]);
    const { measurements } = deriveTraceTiming(trace);
    const stats = deriveFrameStats(trace, measurements);

    expect(stats.measured.frames).toBe(60);
    expect(stats.measured.fps).toBeCloseTo(59.9, 0);
    expect(stats.measured.worstFrameMs).toBeCloseTo(16.7, 1);
    expect(stats.measured.droppedFrames).toBe(0);

    // The total scope spans the idle second, so it does see the stall.
    expect(stats.total.worstFrameMs).toBeGreaterThan(900);
  });

  it('is null when nothing was measured', () => {
    const run = frameRun(1_000_000, 30, 16.7);
    expect(deriveFrameStats(buildTrace(run.events), []).measured).toBeNull();
  });
});

describe('summarizeWindows', () => {
  it('skips windows too thin to contribute', () => {
    const good = frameRun(1_000_000, 20, 16.7).events.map(e => e.ts);
    const stats = summarizeWindows([good, [5_000_000, 5_001_000]], 25);
    expect(stats.frames).toBe(20);
  });

  it('returns null when no window qualifies', () => {
    expect(summarizeWindows([[1000, 2000], []], 25)).toBeNull();
    expect(summarizeWindows([], 25)).toBeNull();
  });
});
