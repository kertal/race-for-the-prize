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
// The scrubber input's max, as declared in player.html.
const SCRUBBER_MAX = 1000;

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

// Which media time the frame readouts should name for one video.
//
// requestVideoFrameCallback hands us the mediaTime of the frame the compositor
// actually painted, so while a video is running that value is never stale — it
// is refreshed on every paint. currentTime, by contrast, is the media clock and
// sits somewhere between the last painted frame and the next one. Preferring
// whichever was closer made the readout flip back and forth between two frame
// numbers on any recording whose frame step is not exactly FRAME_STEP, which
// reads as flicker.
//
// Paused is the other way round: nothing is painting, so a seek moves
// currentTime while the presented frame stays behind until the new one lands.
// There the answer is whichever frame the two times name — comparing frame
// numbers rather than a distance in seconds, because one frame step lands
// exactly on a seconds tolerance and floating point decides it either way.
function displayedFrameTime(presented, video, frameStep = FRAME_STEP) {
  const currentTime = video?.currentTime;
  if (presented == null) return currentTime;
  if (!Number.isFinite(currentTime)) return presented;
  if (!video.paused && !video.seeking) return presented;
  const samePicture = timeToFrame(presented, frameStep) === timeToFrame(currentTime, frameStep);
  return samePicture ? presented : currentTime;
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

// How far one racer can still slide inside its own window, in seconds.
// `later` stops a frame short of the window end so a clip always keeps at
// least one frame; `earlier` stops at the racer's first recorded frame, since
// there is no footage before it. A racer without a valid window is not
// constrained by one and never limits a nudge.
function offsetRoom(win, offset, frameStep = FRAME_STEP) {
  if (!isValidClipEntry(win)) return { earlier: Infinity, later: Infinity };
  const start = win.start + offset;
  return { earlier: Math.max(0, start), later: Math.max(0, win.end - frameStep - start) };
}

// Pure core of adjustDebugOffset(): plan a calibration nudge of `frameDelta`
// frames on racer `idx` over `windows` (the race clips, or the selected
// segment) and the current `offsets`.
//
// Aligning racers is a *relative* act, so a nudge has two ways to spend
// itself. The clicked racer slides inside its own window first; whatever is
// left over is made up by sliding every other racer the opposite way, which
// looks exactly the same on screen. The fallback is what makes "earlier" work
// at all: a recording's clip begins at its first captured frame, so almost
// every racer starts with zero room to move earlier and used to sit there with
// dead "-" buttons.
//
// Returns the new offsets array, or null when nothing can move.
function planOffsetNudge(windows, offsets, idx, frameDelta, frameStep = FRAME_STEP) {
  if (!windows || !offsets || !isValidClipEntry(windows[idx]) || !frameDelta) return null;
  const sign = frameDelta < 0 ? -1 : 1;
  const own = Math.min(
    Math.abs(frameDelta) * frameStep,
    offsetRoom(windows[idx], offsets[idx], frameStep)[sign < 0 ? 'earlier' : 'later']
  );
  // What the clicked racer could not absorb, the others move the other way —
  // limited by whichever of them has the least room left.
  let shared = Infinity, others = 0;
  for (let i = 0; i < offsets.length; i++) {
    if (i === idx) continue;
    others++;
    shared = Math.min(shared, offsetRoom(windows[i], offsets[i], frameStep)[sign < 0 ? 'later' : 'earlier']);
  }
  const rest = others ? Math.min(Math.abs(frameDelta) * frameStep - own, shared) : 0;
  if (own <= 0 && rest <= 0) return null;

  const next = offsets.slice();
  next[idx] += sign * own;
  if (rest > 0) {
    for (let i = 0; i < next.length; i++) {
      if (i !== idx) next[i] -= sign * rest;
    }
  }
  return next;
}

// Pure core of stepFrame(): where a step of `frameDelta` frames lands, given the
// transport's current position `cur` and the active window [minT, maxT].
//
// The result is quantized to the recording's frame grid anchored at minT rather
// than derived by adding to `cur`. stepFrame() reads `cur` back off the
// scrubber, whose value round-trips through a DOM string and returns a
// microsecond short (0.080s comes back as 0.079999) — and a seek that lands a
// hair before a frame boundary presents the frame BEFORE it. Racers whose clip
// starts exactly on a boundary then displayed one frame behind racers whose
// clip starts mid-frame, so a single instant looked like two different frames
// across the videos. Re-quantizing keeps every racer on the same frame.
function stepFrameTime(cur, frameDelta, minT, maxT, frameStep = FRAME_STEP) {
  const frames = Math.round((cur - minT) / frameStep) + Math.round(frameDelta / frameStep);
  return Math.max(minT, Math.min(maxT, minT + frames * frameStep));
}

// Where the transport lands after a calibration change: the position the user
// was already watching, not the clip start. Calibration is judged on one frame
// at one moment of the race, so snapping back to the start on every nudge threw
// away the very frame being compared.
//
// Offsets move the clip window, so the elapsed time is read against the window
// it was taken in (prevDuration) and then clamped into the new one — a nudge
// that shrinks the window would otherwise leave the scrubber past the end.
// Returns the seconds to seek to and the scrubber value that matches it.
function holdTransportPosition(scrubberValue, prevDuration, nextDuration, scrubberMax = SCRUBBER_MAX) {
  const prev = prevDuration > 0 ? prevDuration : 0;
  const next = nextDuration > 0 ? nextDuration : 0;
  const elapsed = prev > 0 ? (scrubberValue / scrubberMax) * prev : 0;
  const held = Math.max(0, Math.min(next, elapsed));
  return { elapsed: held, scrubber: next > 0 ? (held / next) * scrubberMax : 0 };
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    US_PER_SECOND,
    FRAME_STEP,
    CLIP_FIT_TOLERANCE,
    isValidClipEntry,
    timeToFrame,
    frameReadout,
    displayedFrameTime,
    hasTraceCalibration,
    canApplyTraceCalibration,
    durationHoldsClip,
    traceTsToClipPts,
    applyCalibrationToClip,
    computeSegmentClipTimes,
    resolveClipWindow,
    offsetRoom,
    planOffsetNudge,
    stepFrameTime,
    holdTransportPosition,
    SCRUBBER_MAX,
  };
}
