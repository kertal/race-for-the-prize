/* eslint-env browser */
/**
 * timeline.cjs — Pure layout math for the segment timeline.
 *
 * Side-effect free and DOM-free, so Node can require() this file directly for
 * unit tests. In the browser build it is concatenated into the player IIFE
 * like any other fragment and the guarded module.exports below is a no-op.
 */

// One swatch per measurement, in first-seen order; wraps past the end. Set on
// each segment as `--segment-color`, the way racers carry `--racer-color`.
const SEGMENT_COLORS = ['#e67e22', '#3498db', '#2ecc71', '#e74c3c', '#9b59b6', '#1abc9c', '#f1c40f', '#e91e63'];

// Where each named measurement sits on the shared timeline, given the window
// computeSegmentClipTimes resolved for it per racer: the mean of those
// windows, since the bar is one strip for all racers and they start within a
// few frames of each other. A name no racer can place (no trace marks and no
// marker seconds) is left out rather than drawn at 0.
function timelineSegments(namedWindows) {
  const segments = [];
  namedWindows.forEach(({ name, windows }, idx) => {
    const placed = (windows || []).filter(Boolean);
    if (placed.length === 0) return;
    const mean = key => placed.reduce((sum, w) => sum + w[key], 0) / placed.length;
    segments.push({ name, start: mean('start'), end: mean('end'), color: SEGMENT_COLORS[idx % SEGMENT_COLORS.length] });
  });
  return segments;
}

// A moment's position along a bar that spans `extent` seconds, as a percentage
// held inside the bar. Anything unplaceable sits at the left edge.
function timelinePercent(seconds, extent) {
  if (!(extent > 0) || !Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(100, (seconds / extent) * 100));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SEGMENT_COLORS, timelineSegments, timelinePercent };
}
