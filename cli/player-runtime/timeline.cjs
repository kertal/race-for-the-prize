/* eslint-env browser */
/**
 * timeline.cjs — Pure layout math for the segment timeline.
 *
 * Side-effect free and DOM-free, so Node can require() this file directly for
 * unit tests. In the browser build it is concatenated into the player IIFE
 * like any other fragment and the guarded module.exports below is a no-op.
 */

// The racer that won a section, by the summary's rule: the fastest of those
// with a time, and only when the field is not a dead heat (fastest equal to
// slowest). A section nobody won, or that only one racer ran, has none.
function sectionWinner(durations) {
  const timed = (durations || []).map((d, i) => ({ d, i })).filter(({ d }) => Number.isFinite(d));
  if (timed.length < 2) return null;
  const fastest = Math.min(...timed.map(t => t.d));
  const slowest = Math.max(...timed.map(t => t.d));
  if (!(slowest > fastest)) return null;
  return timed.find(t => t.d === fastest).i;
}

// Where each named measurement sits on the shared timeline, given the window
// computeSegmentClipTimes resolved for it per racer: the mean of those
// windows, since the bar is one strip for all racers and they start within a
// few frames of each other. A name no racer can place (no trace marks and no
// marker seconds) is left out rather than drawn at 0. Each segment carries
// the colour of the racer that won it, or none for a dead heat.
function timelineSegments(namedWindows, finishResults, racerColors) {
  const segments = [];
  for (const { name, windows } of namedWindows) {
    const placed = (windows || []).filter(Boolean);
    if (placed.length === 0) continue;
    const mean = key => placed.reduce((sum, w) => sum + w[key], 0) / placed.length;
    const result = finishResults?.find(r => r.name === name && !r.isSyntheticTotal);
    const winner = sectionWinner(result?.durations);
    const color = winner == null ? null : (racerColors?.[winner] ?? null);
    segments.push({ name, start: mean('start'), end: mean('end'), winner, color });
  }
  return segments;
}

// A moment's position along a bar that spans `extent` seconds, as a percentage
// held inside the bar. Anything unplaceable sits at the left edge.
function timelinePercent(seconds, extent) {
  if (!(extent > 0) || !Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(100, (seconds / extent) * 100));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sectionWinner, timelineSegments, timelinePercent };
}
