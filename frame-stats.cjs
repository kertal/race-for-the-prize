/**
 * frame-stats.cjs — Frame rate and smoothness derived from the Playwright trace.
 *
 * Reads the `DrawFrame` instant events Chrome emits under the
 * `disabled-by-default-devtools.timeline.frame` category: one per frame the
 * compositor actually drew. The gaps between consecutive draws are the frame
 * times, so a slice of that timeline describes how smooth any window of the
 * race was — the whole journey, or one raceStart/raceEnd section.
 *
 * `DrawFrame` is the right source rather than the `AnimationFrame::*` events
 * that `devtools.timeline` already carries: those track main-thread animation
 * frame lifecycles, so they miss compositor-driven animation entirely and
 * report a janky scroll as smooth. See docs/results.md.
 *
 * Pure and Playwright-free, like trace-calibration.cjs — it takes trace JSON
 * (plus the measurements that module already paired up) and returns numbers.
 */

'use strict';

const DRAW_FRAME = 'DrawFrame';

// A frame slower than the display's period times this counts as dropped: at
// 60Hz a 25ms frame, at 120Hz a 12.5ms one. Chrome's own smoothness metrics
// use the same "missed the next vsync" idea.
const DROP_FACTOR = 1.5;

// Percentile used to find the fast end of the observed gaps. The median would
// be dragged upwards by a race that janks more often than not, and the minimum
// is noise; a low percentile lands near the refresh rate the machine was
// actually capable of.
const DISPLAY_PERIOD_PERCENTILE = 0.1;

// Gaps within this much of that percentile form the "ran at full speed"
// cluster. Taking the middle of the cluster rather than the percentile itself
// keeps a few slightly-early frames from implying a faster display than the
// hardware has — a 120Hz screen should estimate 8.3ms, not 7.5ms.
const DISPLAY_CLUSTER_TOLERANCE = 1.25;

// Two draws closer together than this are treated as one frame's worth of
// jitter rather than evidence of an absurd refresh rate.
const MIN_PLAUSIBLE_PERIOD_MS = 2;

// Frame times only mean something once there are a few of them; below this a
// window reports null rather than a figure built from one or two gaps.
const MIN_FRAMES = 3;

function toTraceObject(traceText) {
  if (!traceText) return null;
  if (typeof traceText === 'string') {
    try {
      return JSON.parse(traceText);
    } catch {
      return null;
    }
  }
  if (typeof traceText === 'object') return traceText;
  return null;
}

/** Ascending-percentile pick from an already-sorted array. */
function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * fraction))
  );
  return sortedValues[index];
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Collect the timestamps (microseconds) of every drawn frame, in order. */
function collectDrawTimestamps(traceEvents) {
  const timestamps = [];
  for (const ev of traceEvents) {
    if (!ev || ev.name !== DRAW_FRAME) continue;
    // Instant events only; a future Chrome adding a duration phase under the
    // same name must not count each frame twice.
    if (ev.ph !== 'I') continue;
    if (typeof ev.ts !== 'number' || !Number.isFinite(ev.ts)) continue;
    timestamps.push(ev.ts);
  }
  return timestamps.sort((a, b) => a - b);
}

/** Gaps between consecutive draws, in milliseconds. */
function frameIntervalsMs(timestamps) {
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push((timestamps[i] - timestamps[i - 1]) / 1000);
  }
  return intervals;
}

/**
 * Estimate the display's frame period (ms) from every gap in the race.
 * Derived rather than assumed: a 120Hz laptop must not be judged against 60.
 */
function estimateDisplayPeriodMs(allIntervals) {
  const plausible = allIntervals
    .filter(ms => ms >= MIN_PLAUSIBLE_PERIOD_MS)
    .sort((a, b) => a - b);
  if (plausible.length === 0) return null;
  const fastEnd = percentile(plausible, DISPLAY_PERIOD_PERCENTILE);
  const cluster = plausible.filter(ms => ms <= fastEnd * DISPLAY_CLUSTER_TOLERANCE);
  return percentile(cluster, 0.5) ?? fastEnd;
}

/**
 * Summarize one or more windows of the frame timeline as a single scope.
 *
 * Frame times are gathered per window and then combined, never by flattening
 * the windows into one list: the wait between two sections is not a 400ms
 * frame, and counting it as one would dominate every statistic here.
 *
 * `budgetMs` comes from the whole race, never from one window alone: a section
 * that is uniformly janky has a janky median, and measured against its own
 * median nothing in it would ever look dropped.
 *
 * @param {number[][]} windows - draw timestamps (microseconds) per window
 * @param {number|null} budgetMs - frame time above which a frame counts as dropped
 */
function summarizeWindows(windows, budgetMs) {
  const intervals = [];
  let frames = 0;
  let spanMs = 0;
  for (const timestamps of windows) {
    if (timestamps.length < MIN_FRAMES) continue;
    const span = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
    if (!(span > 0)) continue;
    intervals.push(...frameIntervalsMs(timestamps));
    frames += timestamps.length;
    spanMs += span;
  }
  if (intervals.length === 0 || !(spanMs > 0)) return null;
  const sortedIntervals = [...intervals].sort((a, b) => a - b);

  return {
    frames,
    // Frames per second of *drawing*, measured across the observed span rather
    // than the window's wall clock: a window that ends in idle would otherwise
    // be scored for time in which there was nothing to draw.
    fps: round(1000 * intervals.length / spanMs),
    medianFrameMs: round(percentile(sortedIntervals, 0.5)),
    p95FrameMs: round(percentile(sortedIntervals, 0.95)),
    worstFrameMs: round(sortedIntervals[sortedIntervals.length - 1]),
    droppedFrames: budgetMs == null ? null : intervals.filter(ms => ms > budgetMs).length,
  };
}

/** Summarize a single window. */
function summarizeWindow(timestamps, budgetMs) {
  return summarizeWindows([timestamps], budgetMs);
}

/**
 * Merge overlapping or touching ranges into disjoint ones, ordered by start.
 *
 * Sections can overlap — one measured inside another, or two started before
 * either ended — and the measured scope must not count a frame in the overlap
 * twice, nor its interval twice.
 *
 * @param {Array<{startTraceTs: number, endTraceTs: number}>} ranges
 */
function mergeRanges(ranges) {
  const sorted = ranges
    .slice()
    .sort((a, b) => a.startTraceTs - b.startTraceTs);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.startTraceTs <= last.endTraceTs) {
      last.endTraceTs = Math.max(last.endTraceTs, range.endTraceTs);
      continue;
    }
    merged.push({ startTraceTs: range.startTraceTs, endTraceTs: range.endTraceTs });
  }
  return merged;
}

/**
 * Derive frame statistics for the whole trace and for each measured section.
 *
 * @param {string|object} traceText - trace JSON (text or parsed)
 * @param {Array<{name: string, startTraceTs: number, endTraceTs: number}>} [measurements]
 *   The measurements `deriveTraceTiming()` already paired up. A name that was
 *   measured more than once keeps one window per pass, so the wait between
 *   passes never becomes a frame time.
 * @returns {{displayFrameMs: number|null, budgetFrameMs: number|null,
 *            total: object|null, measured: object|null,
 *            sections: Object<string, object>}|null}
 */
function deriveFrameStats(traceText, measurements = []) {
  const traceEvents = toTraceObject(traceText)?.traceEvents;
  if (!Array.isArray(traceEvents) || traceEvents.length === 0) return null;

  const timestamps = collectDrawTimestamps(traceEvents);
  if (timestamps.length === 0) return null;

  const allIntervals = frameIntervalsMs(timestamps);
  const displayFrameMs = estimateDisplayPeriodMs(allIntervals);
  const budgetFrameMs = displayFrameMs == null ? null : displayFrameMs * DROP_FACTOR;

  const framesWithin = ({ startTraceTs, endTraceTs }) =>
    timestamps.filter(ts => ts >= startTraceTs && ts <= endTraceTs);

  // One window per pass, keyed by section name. A section measured twice keeps
  // both passes apart: pooling them would turn the wait in between into a
  // frame time long enough to dominate the section's worst frame and p95.
  const windowsByName = new Map();
  const ranges = [];
  for (const measurement of measurements) {
    const { name, startTraceTs, endTraceTs } = measurement || {};
    if (typeof name !== 'string') continue;
    if (!Number.isFinite(startTraceTs) || !Number.isFinite(endTraceTs)) continue;
    if (endTraceTs < startTraceTs) continue;
    const range = { startTraceTs, endTraceTs };
    if (!windowsByName.has(name)) windowsByName.set(name, []);
    windowsByName.get(name).push(framesWithin(range));
    ranges.push(range);
  }

  const sectionStats = Object.create(null);
  for (const [name, windows] of windowsByName.entries()) {
    sectionStats[name] = summarizeWindows(windows, budgetFrameMs);
  }

  // The measured scope combines every section, the way the network and CPU
  // totals sum their windows: it describes the parts of the race the spec
  // actually timed, leaving out the gaps between them and the tail after the
  // last raceEnd. Overlapping sections are merged first so a frame measured by
  // two of them counts once.
  const measuredWindows = mergeRanges(ranges).map(framesWithin);

  return {
    displayFrameMs: displayFrameMs == null ? null : round(displayFrameMs),
    budgetFrameMs: budgetFrameMs == null ? null : round(budgetFrameMs),
    total: summarizeWindow(timestamps, budgetFrameMs),
    measured: summarizeWindows(measuredWindows, budgetFrameMs),
    sections: sectionStats,
  };
}

module.exports = {
  deriveFrameStats,
  // Exported for tests and for callers that already hold the timestamps.
  summarizeWindow,
  summarizeWindows,
  mergeRanges,
  estimateDisplayPeriodMs,
  collectDrawTimestamps,
  DROP_FACTOR,
};
