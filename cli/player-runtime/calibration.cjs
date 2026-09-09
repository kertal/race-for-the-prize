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

// Playwright records at 25fps, so one frame is 40ms. This is the step the
// calibration buttons nudge by and the unit every frame readout counts in.
const FRAME_STEP = 0.04;

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

function applyCalibrationToClip(ct, ptsStart, videoDuration) {
  const segDuration = ct._wcEnd - ct._wcStart;
  ct.calibratedStart = ptsStart;
  ct.calibratedEnd = ptsStart + segDuration;
  ct._ptsScale = null;
  ct.start = ptsStart;
  ct.end = Number.isFinite(videoDuration) ? Math.min(ptsStart + segDuration, videoDuration) : ptsStart + segDuration;
  ct._converted = true;
}

// Frame index of a position in the recording. Frame numbers come from the
// recording's fixed frame step, never from VideoPlaybackQuality.totalVideoFrames
// — that counter reports frames presented since the <video> element was created
// (it grows while you play and is ~0 before the first paint), so it can't stand
// in for the file's frame count.
function timeToFrame(t, frameStep = FRAME_STEP) {
  if (!Number.isFinite(t) || !(frameStep > 0)) return null;
  return Math.max(0, Math.round(t / frameStep));
}

// Frame readout for one racer: the absolute frame in the recording plus, when a
// clip window applies, where that frame sits inside the clip.
function frameReadout(currentTime, clipEntry, frameStep = FRAME_STEP) {
  const frame = timeToFrame(currentTime, frameStep);
  if (frame == null) return null;
  if (!isValidClipEntry(clipEntry)) return { frame, clipFrame: null, clipTotal: null, clipStart: null, clipEnd: null };
  const clipStart = timeToFrame(clipEntry.start, frameStep);
  const clipEnd = timeToFrame(clipEntry.end, frameStep);
  return { frame, clipFrame: frame - clipStart, clipTotal: clipEnd - clipStart, clipStart, clipEnd };
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
    FRAME_STEP,
    isValidClipEntry,
    timeToFrame,
    frameReadout,
    hasTraceCalibration,
    canApplyTraceCalibration,
    traceTsToClipPts,
    applyCalibrationToClip,
    computeSegmentClipTimes,
    resolveClipWindow,
  };
}
