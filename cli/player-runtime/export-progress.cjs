/* eslint-env browser */
/**
 * export-progress.cjs — Pure export-conversion progress math.
 *
 * ffmpeg.wasm's own `progress` ratio is always 0 for MediaRecorder output (the
 * webm has no Duration header), so the player derives the percentage from the
 * `time` field — microseconds of output encoded so far — against a duration it
 * does know: the trimmed clip range, or the wall-clock length measured while
 * the export recorded. Side-effect free and DOM independent so Node can
 * require() it for unit tests; in the browser build the guarded
 * module.exports is a no-op.
 */

/** Microseconds ffmpeg will encode, or null when neither source is usable. */
function encodeDurationUs(clipRange, durationS) {
  const seconds = clipRange ? clipRange.end - clipRange.start : durationS;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1e6 : null;
}

/** Fraction encoded so far, clamped to 0–1, or null when it cannot be known. */
function conversionProgress(timeUs, totalUs) {
  if (!Number.isFinite(timeUs) || !(totalUs > 0)) return null;
  return Math.min(1, Math.max(0, timeUs / totalUs));
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { encodeDurationUs, conversionProgress };
}
