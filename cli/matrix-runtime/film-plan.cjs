/* eslint-env browser */
/**
 * film-plan.cjs — Pure planning math for the condition-matrix film.
 *
 * The film is one video of every condition in the matrix: an info card with
 * that condition's result, then its racers playing side by side, over and over
 * until the matrix is done. This file turns the film config embedded in the
 * page into the ordered plan the browser records, and works out which slice of
 * each recording is the race.
 *
 * Side-effect free and DOM independent so Node can require() it for unit
 * tests; in the browser build the guarded module.exports below is a no-op.
 */

/**
 * Seconds each info card holds the frame before its race starts. Long enough
 * to read a full field of racers — times, deltas and all — not just to notice
 * that a card went by.
 */
const CARD_SECONDS = 4;

const US_PER_SECOND = 1e6; // trace timestamps are in microseconds

/**
 * The playable window of one recording, in video time.
 *
 * Mirrors the player's convertClipEntry (player-runtime/playback.js) without
 * mutating anything: trace calibration moves the start onto the video's own
 * PTS timeline, and the segment's wall-clock length sets the end. A recording
 * with no clip entry (physically trimmed by --ffmpeg) plays whole.
 */
function filmClipWindow(clip, videoDuration) {
  const whole = Number.isFinite(videoDuration) ? { start: 0, end: videoDuration } : null;
  if (!clip || !Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.end < clip.start) return whole;

  const cal = clip.traceCalibration;
  const segDuration = clip.end - clip.start;
  let start = clip.start;
  if (cal && Number.isFinite(cal.recordingStartTs) && Number.isFinite(cal.firstFrameTs)) {
    const ptsStart = (cal.recordingStartTs - cal.firstFrameTs) / US_PER_SECOND;
    // A negative offset means the trace and the video disagree about which
    // came first; the raw times are the safer read.
    if (ptsStart >= 0) start = ptsStart;
  }
  let end = start + segDuration;
  if (Number.isFinite(videoDuration)) end = Math.min(end, videoDuration);
  return { start, end: Math.max(start, end) };
}

/**
 * One condition's series for the chosen metric, falling back to the first
 * metric the condition carries so a picker value the film config never saw
 * still shows a card with numbers on it.
 */
function pickSeries(condition, metricKey) {
  const metrics = condition.metrics || {};
  if (metrics[metricKey]) return metrics[metricKey];
  const first = Object.keys(metrics)[0];
  return first ? metrics[first] : null;
}

/** The info card shown before one condition's race. */
function buildFilmCard(condition, metricKey, position, total) {
  const series = pickSeries(condition, metricKey);
  const metricName = series?.name || '';
  const verdict = series?.verdict || '';
  return {
    title: condition.title || '',
    metricName,
    verdict,
    // One line under the title: what is being compared, and who took it.
    subtitle: [metricName, verdict].filter(Boolean).join(' · '),
    rows: (series?.rows || []).map(row => ({
      medal: row.medal || '',
      name: row.name,
      color: row.color,
      value: row.value || '—',
      delta: row.delta ? `+${row.delta}` : '',
      // How long this racer's bar runs, against the worst value in the matrix —
      // the same scale the overview's own bars use.
      fraction: Number.isFinite(row.fraction) ? Math.max(0, Math.min(1, row.fraction)) : null,
      win: !!row.win,
    })),
    footer: `${position} / ${total}`,
  };
}

/**
 * Turn the embedded film config into the plan the recorder walks: conditions
 * in matrix order, each with its card and the racers that actually have a
 * recording. Conditions with no recording at all are dropped — a card with
 * nothing behind it is not worth a slot in the film.
 *
 * @param {object|null} config - the page's film config
 * @param {string} metricKey - the metric the cards report (the picker's value)
 * @returns {{conditions: Array<object>, maxRacers: number}}
 */
function buildFilmPlan(config, metricKey) {
  const usable = (config?.conditions || [])
    .map(condition => ({ condition, racers: (condition.racers || []).filter(racer => racer?.src) }))
    .filter(entry => entry.racers.length > 0);

  const conditions = usable.map((entry, i) => ({
    label: entry.condition.label,
    title: entry.condition.title || '',
    card: buildFilmCard(entry.condition, metricKey, i + 1, usable.length),
    racers: entry.racers,
  }));

  return {
    conditions,
    maxRacers: conditions.reduce((most, condition) => Math.max(most, condition.racers.length), 0),
  };
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CARD_SECONDS, US_PER_SECOND, filmClipWindow, pickSeries, buildFilmCard, buildFilmPlan };
}
