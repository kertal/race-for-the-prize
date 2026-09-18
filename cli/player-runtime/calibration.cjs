/* eslint-env browser */
/**
 * calibration.cjs — Pure clip-calibration math for the player runtime.
 *
 * Every function here is side-effect free and independent of DOM/module
 * state, so Node can require() this file directly for unit tests. In the
 * browser build the file is concatenated into the player IIFE like any
 * other fragment and the guarded module.exports below is a no-op.
 */

const US_PER_SECOND = 1e6; // trace timestamps are in microseconds

function traceTsToClipPts(ct, traceTs) {
  if (!hasTraceCalibration(ct) || !Number.isFinite(traceTs)) return null;
  // Video PTS is measured from firstFrameTs (the first captured frame = PTS 0).
  // Using recordingStartTs as the base would give time-since-recording-started,
  // which is ct.start seconds too early once applyCalibrationToClip has set
  // ct.start = (recordingStartTs - firstFrameTs) / US_PER_SECOND.
  return (traceTs - ct.traceCalibration.firstFrameTs) / US_PER_SECOND;
}

function isValidClipEntry(c) {
  return c != null && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start <= c.end;
}

function hasTraceCalibration(ct) {
  return !!(ct?.traceCalibration && Number.isFinite(ct.traceCalibration.recordingStartTs));
}

function canApplyTraceCalibration(ct) {
  return hasTraceCalibration(ct) && Number.isFinite(ct.traceCalibration.firstFrameTs);
}

// True while the element's duration is too short to hold the whole segment —
// the mark of a duration Chrome has not finished resolving yet (a WebM whose
// duration grows as clusters are parsed reports 0 at first). Clamping against
// such a value freezes a clip that ends before it starts, so callers wait for
// the real duration instead. A genuinely truncated recording keeps failing
// this, hence durationSettled()'s probed escape hatch in playback.js.
// A clip may legitimately end a frame or two past the last decoded frame — the
// recording-end mark lands after it — so allow that much slack rather than
// scanning the file over a rounding difference.
const CLIP_FIT_TOLERANCE = 0.05;

function durationHoldsClip(ct, ptsStart, videoDuration) {
  if (!Number.isFinite(videoDuration)) return false;
  return videoDuration + CLIP_FIT_TOLERANCE >= ptsStart + (ct._wcEnd - ct._wcStart);
}

function applyCalibrationToClip(ct, ptsStart, videoDuration) {
  const segDuration = ct._wcEnd - ct._wcStart;
  ct.calibratedStart = ptsStart;
  ct.calibratedEnd = ptsStart + segDuration;
  ct._ptsScale = null;
  ct.start = ptsStart;
  const end = Number.isFinite(videoDuration) ? Math.min(ptsStart + segDuration, videoDuration) : ptsStart + segDuration;
  // Never clamp below the start: an inverted entry fails isValidClipEntry, and
  // calibrateClipTimes skips invalid entries, so it could never be repaired.
  ct.end = Math.max(ptsStart, end);
  ct._converted = true;
}

// Pure core of getSegmentClipTimes(name): maps each clip entry to the PTS
// window of the named measurement segment, or null when it cannot be derived.
function computeSegmentClipTimes(entries, name) {
  if (!entries) return null;
  return entries.map(ct => {
    if (ct?._wcStart == null || ct._wcEnd == null) return null;
    const m = ct.measurements?.find(m => m.name === name);
    if (!m || !Number.isFinite(m.startTraceTs) || !Number.isFinite(m.endTraceTs)) return null;
    const startPts = traceTsToClipPts(ct, m.startTraceTs);
    const endPts = traceTsToClipPts(ct, m.endTraceTs);
    if (!Number.isFinite(startPts) || !Number.isFinite(endPts) || endPts <= startPts) return null;
    return { start: startPts, end: endPts };
  });
}

// Pure core of resolveClip()/resolveAdjustedClip(): computes the shared
// playback window { start, end } over a set of clip entries, skipping
// hidden racer indices. Uses maxDuration (not maxEnd) so every racer plays
// its full clip from the common start.
function resolveClipWindow(entries, hidden) {
  if (!entries) return null;
  let minStart = Infinity, maxDuration = 0, found = false;
  for (let i = 0; i < entries.length; i++) {
    if (hidden?.has(i)) continue;
    if (isValidClipEntry(entries[i])) {
      minStart = Math.min(minStart, entries[i].start);
      maxDuration = Math.max(maxDuration, entries[i].end - entries[i].start);
      found = true;
    }
  }
  return found ? { start: minStart, end: minStart + maxDuration } : null;
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    US_PER_SECOND,
    CLIP_FIT_TOLERANCE,
    isValidClipEntry,
    hasTraceCalibration,
    canApplyTraceCalibration,
    durationHoldsClip,
    traceTsToClipPts,
    applyCalibrationToClip,
    computeSegmentClipTimes,
    resolveClipWindow,
  };
}
