/**
 * Behavioral tests for the pure logic of the browser player runtime
 * (cli/player-runtime/*.cjs). These files are concatenated into the
 * generated player's IIFE for the browser, and expose a guarded
 * module.exports so Node can require() them directly.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  US_PER_SECOND,
  isValidClipEntry,
  hasTraceCalibration,
  canApplyTraceCalibration,
  traceTsToClipPts,
  applyCalibrationToClip,
  durationHoldsClip,
  computeSegmentClipTimes,
  resolveClipWindow,
  FRAME_STEP,
  timeToFrame,
  frameReadout,
  displayedFrameTime,
  offsetRoom,
  planOffsetNudge,
  stepFrameTime,
  holdTransportPosition,
  SCRUBBER_MAX,
} = require('../cli/player-runtime/calibration.cjs');
const { computeExportLayout } = require('../cli/player-runtime/export-layout.cjs');
const { crc32, createZipBuilder } = require('../cli/player-runtime/zip.cjs');

// --- Calibration math -------------------------------------------------------

describe('calibration isValidClipEntry', () => {
  it('accepts finite start <= end', () => {
    expect(isValidClipEntry({ start: 1, end: 3 })).toBe(true);
    expect(isValidClipEntry({ start: 0, end: 0 })).toBe(true); // zero-length clip is valid
  });

  it('rejects null/undefined entries', () => {
    expect(isValidClipEntry(null)).toBe(false);
    expect(isValidClipEntry(undefined)).toBe(false);
  });

  it('rejects non-finite or missing bounds', () => {
    expect(isValidClipEntry({ start: NaN, end: 3 })).toBe(false);
    expect(isValidClipEntry({ start: 1, end: Infinity })).toBe(false);
    expect(isValidClipEntry({ start: 1 })).toBe(false);
    expect(isValidClipEntry({ start: '1', end: 3 })).toBe(false); // Number.isFinite, no coercion
  });

  it('rejects inverted ranges', () => {
    expect(isValidClipEntry({ start: 3, end: 1 })).toBe(false);
  });
});

describe('calibration trace metadata predicates', () => {
  it('hasTraceCalibration requires a finite recordingStartTs', () => {
    expect(hasTraceCalibration({ traceCalibration: { recordingStartTs: 1_100_000 } })).toBe(true);
    expect(hasTraceCalibration({ traceCalibration: { recordingStartTs: NaN } })).toBe(false);
    expect(hasTraceCalibration({ traceCalibration: {} })).toBe(false);
    expect(hasTraceCalibration({})).toBe(false);
    expect(hasTraceCalibration(null)).toBe(false);
  });

  it('canApplyTraceCalibration additionally requires a finite firstFrameTs', () => {
    const both = { traceCalibration: { recordingStartTs: 1_100_000, firstFrameTs: 1_000_000 } };
    const noFirst = { traceCalibration: { recordingStartTs: 1_100_000 } };
    expect(canApplyTraceCalibration(both)).toBe(true);
    expect(canApplyTraceCalibration(noFirst)).toBe(false);
    expect(canApplyTraceCalibration(null)).toBe(false);
  });
});

describe('calibration traceTsToClipPts', () => {
  // Trace timestamps are microseconds; video PTS 0 is the first captured frame.
  const ct = { traceCalibration: { firstFrameTs: 2_000_000, recordingStartTs: 2_500_000 } };

  it('measures PTS from firstFrameTs, not recordingStartTs', () => {
    expect(traceTsToClipPts(ct, 3_000_000)).toBeCloseTo(1.0, 9);
    expect(traceTsToClipPts(ct, 2_000_000)).toBe(0); // first frame = PTS 0
    // recordingStartTs maps to +0.5s of video time, NOT 0
    expect(traceTsToClipPts(ct, 2_500_000)).toBeCloseTo(0.5, 9);
  });

  it('uses microsecond units', () => {
    expect(US_PER_SECOND).toBe(1e6);
    expect(traceTsToClipPts(ct, 2_000_001)).toBeCloseTo(1e-6, 12);
  });

  it('returns null without trace calibration or with a non-finite timestamp', () => {
    expect(traceTsToClipPts({}, 3_000_000)).toBe(null);
    expect(traceTsToClipPts(ct, NaN)).toBe(null);
    expect(traceTsToClipPts(ct, undefined)).toBe(null);
  });
});

describe('calibration applyCalibrationToClip', () => {
  const makeCt = () => ({ start: 10, end: 14, _wcStart: 10, _wcEnd: 14 });

  it('rebases start/end onto the PTS start, preserving wall-clock duration', () => {
    const ct = makeCt();
    applyCalibrationToClip(ct, 0.5, 100);
    expect(ct.calibratedStart).toBe(0.5);
    expect(ct.calibratedEnd).toBe(4.5); // 0.5 + (14 - 10)
    expect(ct.start).toBe(0.5);
    expect(ct.end).toBe(4.5);
    expect(ct._ptsScale).toBe(null);
    expect(ct._converted).toBe(true);
  });

  it('clamps end (but not calibratedEnd) to a finite video duration', () => {
    const ct = makeCt();
    applyCalibrationToClip(ct, 0.5, 3);
    expect(ct.end).toBe(3);
    expect(ct.calibratedEnd).toBe(4.5);
  });

  it('does not clamp when the video duration is not finite', () => {
    const ct = makeCt();
    applyCalibrationToClip(ct, 0.5, Infinity);
    expect(ct.end).toBe(4.5);
  });

  it('never clamps end below start when the duration is shorter than the PTS start', () => {
    // Regression: a WebM whose duration Chrome has not resolved yet reports 0.
    // Clamping to it produced end < start, which isValidClipEntry rejects and
    // calibrateClipTimes then skips — the racer was dropped from the shared
    // window for the life of the page: it started at the winner's start and
    // kept rolling past its own clip end, even once the real duration arrived.
    const ct = { start: 0, end: 2.794, _wcStart: 0, _wcEnd: 2.794 };
    applyCalibrationToClip(ct, 0.595, 0);
    expect(ct.start).toBeCloseTo(0.595, 9);
    expect(ct.end).toBeCloseTo(0.595, 9);
    expect(isValidClipEntry(ct)).toBe(true);
    expect(ct.calibratedEnd).toBeCloseTo(3.389, 9); // the true end is still recorded
  });

  it('matches the onMeta pipeline: PTS start derived from trace timestamps', () => {
    // recordingStartTs - firstFrameTs = 100ms => recording began 0.1s into the video
    const cal = { recordingStartTs: 1_100_000, firstFrameTs: 1_000_000 };
    const ct = { start: 1, end: 3, _wcStart: 1, _wcEnd: 3, traceCalibration: cal };
    const tracePtsStart = (cal.recordingStartTs - cal.firstFrameTs) / US_PER_SECOND;
    expect(tracePtsStart).toBeCloseTo(0.1, 9);
    applyCalibrationToClip(ct, tracePtsStart, 5);
    expect(ct.calibratedStart).toBeCloseTo(0.1, 9);
    expect(ct.start).toBeCloseTo(0.1, 9);
    expect(ct.end).toBeCloseTo(2.1, 9); // 0.1 + 2s wall-clock segment
  });
});

describe('calibration durationHoldsClip', () => {
  const ct = { _wcStart: 0, _wcEnd: 2.794 }; // 2.794s of recording

  it('accepts a duration that covers the whole clip', () => {
    expect(durationHoldsClip(ct, 0.595, 4.96)).toBe(true);
    // A clip ending a frame past the last decoded frame is still a fit: the
    // recording-end mark lands after it, and seeks clamp to the duration anyway.
    expect(durationHoldsClip(ct, 0.595, 3.389 - 0.02)).toBe(true);
  });

  it('rejects a duration too short to hold the clip', () => {
    expect(durationHoldsClip(ct, 0.595, 0)).toBe(false); // Chrome's unresolved WebM duration
    expect(durationHoldsClip(ct, 0.595, 3.0)).toBe(false);
  });

  it('rejects a non-finite duration — that is the 1e10 scan case', () => {
    expect(durationHoldsClip(ct, 0.595, Infinity)).toBe(false);
    expect(durationHoldsClip(ct, 0.595, NaN)).toBe(false);
  });
});

describe('calibration computeSegmentClipTimes', () => {
  const cal = { firstFrameTs: 1_000_000, recordingStartTs: 1_100_000 };
  const entry = {
    _wcStart: 0.1,
    _wcEnd: 0.9,
    traceCalibration: cal,
    measurements: [
      { name: 'Load', startTraceTs: 1_200_000, endTraceTs: 1_600_000 },
      { name: 'Render', startTraceTs: 1_600_000, endTraceTs: 1_900_000 },
    ],
  };

  it('maps a named measurement to its PTS window per entry', () => {
    const out = computeSegmentClipTimes([entry], 'Load');
    expect(out).toHaveLength(1);
    expect(out[0].start).toBeCloseTo(0.2, 9);
    expect(out[0].end).toBeCloseTo(0.6, 9);
    const render = computeSegmentClipTimes([entry], 'Render');
    expect(render[0].start).toBeCloseTo(0.6, 9);
    expect(render[0].end).toBeCloseTo(0.9, 9);
  });

  it('returns null for entries that cannot be derived', () => {
    expect(computeSegmentClipTimes([entry], 'Nope')).toEqual([null]); // unknown segment
    expect(computeSegmentClipTimes([null], 'Load')).toEqual([null]); // missing entry
    const noWc = { ...entry, _wcStart: null };
    expect(computeSegmentClipTimes([noWc], 'Load')).toEqual([null]); // not yet converted
    const noTrace = { ...entry, traceCalibration: undefined };
    expect(computeSegmentClipTimes([noTrace], 'Load')).toEqual([null]); // no calibration
    const noTs = { ...entry, measurements: [{ name: 'Load', startTraceTs: NaN, endTraceTs: 1_600_000 }] };
    expect(computeSegmentClipTimes([noTs], 'Load')).toEqual([null]); // non-finite trace ts
  });

  describe('without trace calibration', () => {
    // A race whose trace was unusable: the runner keeps the measurements on
    // the same clock as the segments, and the segment was placed by that
    // clock, so the measurement's offset into it carries straight over.
    const markerEntry = {
      start: 0.1,
      end: 0.9,
      _wcStart: 0.1,
      _wcEnd: 0.9,
      measurements: [{ name: 'Load', startTime: 0.3, endTime: 0.7 }],
    };

    it('places a section by the marker clock', () => {
      const out = computeSegmentClipTimes([markerEntry], 'Load');
      expect(out[0].start).toBeCloseTo(0.3, 9);
      expect(out[0].end).toBeCloseTo(0.7, 9);
    });

    it('moves the section with a shifted clip start', () => {
      // An exported page bakes each racer's frame offset into ct.start.
      const shifted = { ...markerEntry, start: 1.1, end: 1.9 };
      const out = computeSegmentClipTimes([shifted], 'Load');
      expect(out[0].start).toBeCloseTo(1.3, 9);
      expect(out[0].end).toBeCloseTo(1.7, 9);
    });

    it('returns null when the measurement carries no times at all', () => {
      const noTimes = { ...markerEntry, measurements: [{ name: 'Load' }] };
      expect(computeSegmentClipTimes([noTimes], 'Load')).toEqual([null]);
    });
  });

  it('rejects empty or inverted segments (endPts <= startPts)', () => {
    const zero = { ...entry, measurements: [{ name: 'Load', startTraceTs: 1_500_000, endTraceTs: 1_500_000 }] };
    expect(computeSegmentClipTimes([zero], 'Load')).toEqual([null]);
    const inverted = { ...entry, measurements: [{ name: 'Load', startTraceTs: 1_600_000, endTraceTs: 1_200_000 }] };
    expect(computeSegmentClipTimes([inverted], 'Load')).toEqual([null]);
  });

  it('returns null for null clip times and keeps per-entry independence', () => {
    expect(computeSegmentClipTimes(null, 'Load')).toBe(null);
    const out = computeSegmentClipTimes([entry, null], 'Load');
    expect(out[0]).not.toBe(null);
    expect(out[1]).toBe(null);
  });
});

describe('calibration resolveClipWindow', () => {
  it('uses the earliest start plus the longest duration (not the latest end)', () => {
    // Durations: 2s and 1.5s; window = [1, 1 + 2] even though max end is 3.5
    const win = resolveClipWindow([{ start: 1, end: 3 }, { start: 2, end: 3.5 }], new Set());
    expect(win).toEqual({ start: 1, end: 3 });
  });

  it('skips hidden racer indices', () => {
    const entries = [{ start: 1, end: 3 }, { start: 2, end: 3.5 }];
    expect(resolveClipWindow(entries, new Set([0]))).toEqual({ start: 2, end: 3.5 });
    expect(resolveClipWindow(entries, new Set([0, 1]))).toBe(null);
  });

  it('ignores null and invalid entries', () => {
    const win = resolveClipWindow([null, { start: 0.5, end: 2 }, { start: 3, end: 1 }], new Set());
    expect(win).toEqual({ start: 0.5, end: 2 });
  });

  it('returns null when nothing is resolvable', () => {
    expect(resolveClipWindow(null, new Set())).toBe(null);
    expect(resolveClipWindow([], new Set())).toBe(null);
    expect(resolveClipWindow([null, { start: NaN, end: 1 }], new Set())).toBe(null);
  });
});

// --- Frame readouts ---------------------------------------------------------

describe('calibration timeToFrame', () => {
  it('counts frames in 40ms steps (25fps recordings)', () => {
    expect(FRAME_STEP).toBe(0.04);
    expect(timeToFrame(0)).toBe(0);
    expect(timeToFrame(0.04)).toBe(1);
    expect(timeToFrame(1)).toBe(25);
    expect(timeToFrame(2.52)).toBe(63);
  });

  it('rounds to the nearest frame', () => {
    expect(timeToFrame(0.049)).toBe(1);
    expect(timeToFrame(0.061)).toBe(2);
  });

  it('never reports a negative frame', () => {
    expect(timeToFrame(-0.5)).toBe(0);
  });

  it('rejects non-finite times and non-positive steps', () => {
    expect(timeToFrame(NaN)).toBe(null);
    expect(timeToFrame(Infinity)).toBe(null);
    expect(timeToFrame(undefined)).toBe(null);
    expect(timeToFrame(1, 0)).toBe(null);
  });

  it('honours a custom frame step', () => {
    expect(timeToFrame(1, 0.1)).toBe(10);
  });
});

describe('calibration displayedFrameTime', () => {
  const playing = (currentTime) => ({ currentTime, paused: false, seeking: false });
  const paused = (currentTime) => ({ currentTime, paused: true, seeking: false });

  it('names the painted frame while playing, however far currentTime has run on', () => {
    // Regression: the readout used to prefer currentTime as soon as it drifted
    // more than one FRAME_STEP from the painted frame, which on any recording
    // whose frame step is not exactly 0.04s made the badge flip between two
    // frame numbers several times a second.
    expect(displayedFrameTime(1.0, playing(1.02))).toBe(1.0);
    expect(displayedFrameTime(1.0, playing(1.09))).toBe(1.0);
  });

  it('does not flip between two readings as the media clock runs between paints', () => {
    // One painted frame, currentTime creeping past it: every sample must agree.
    const painted = 2.0;
    const seen = new Set(
      [2.0, 2.01, 2.03, 2.05, 2.08].map(t => displayedFrameTime(painted, playing(t)))
    );
    expect([...seen]).toEqual([painted]);
  });

  it('follows a seek while paused, where nothing is painting', () => {
    // Within the same frame, the painted picture is still the truth.
    expect(displayedFrameTime(1.0, paused(1.01))).toBe(1.0);
    // A single frame step names the next frame straight away, rather than
    // showing the old number until the new picture lands.
    expect(displayedFrameTime(1.0, paused(1.04))).toBe(1.04);
    // A real jump is the viewer's intent, so report where they went.
    expect(displayedFrameTime(1.0, paused(5.0))).toBe(5.0);
    // …and a seek in flight counts as paused, not as playback.
    expect(displayedFrameTime(1.0, { currentTime: 5.0, paused: false, seeking: true })).toBe(5.0);
  });

  it('falls back to currentTime before the first frame has painted', () => {
    expect(displayedFrameTime(null, playing(0.4))).toBe(0.4);
    expect(displayedFrameTime(undefined, paused(0.4))).toBe(0.4);
  });
});

describe('calibration frameReadout', () => {
  const clip = { start: 1.2, end: 2.8 }; // frames 30..70

  it('reports the absolute frame and its position inside the clip', () => {
    expect(frameReadout(1.6, clip)).toEqual({
      frame: 40, clipFrame: 10, clipTotal: 40, clipStart: 30, clipEnd: 70,
    });
  });

  it('starts the clip count at zero on the clip start', () => {
    expect(frameReadout(clip.start, clip).clipFrame).toBe(0);
    expect(frameReadout(clip.end, clip).clipFrame).toBe(40);
  });

  it('reports a negative clip frame before the clip start', () => {
    // Nudging a racer's start backwards is exactly what calibration does, so
    // positions ahead of the clip must stay readable rather than clamp to 0.
    expect(frameReadout(1.0, clip).clipFrame).toBe(-5);
  });

  it('omits clip figures when no usable clip window applies', () => {
    expect(frameReadout(1.6, null)).toEqual({
      frame: 40, clipFrame: null, clipTotal: null, clipStart: null, clipEnd: null,
    });
    expect(frameReadout(1.6, { start: NaN, end: 2 }).clipFrame).toBe(null);
  });

  it('returns null when the position is unknown', () => {
    expect(frameReadout(NaN, clip)).toBe(null);
  });

  it('is independent of how many frames the element has presented', () => {
    // The old readout scaled currentTime by VideoPlaybackQuality.totalVideoFrames,
    // a counter that grows during playback — the same position reported a
    // different frame each time. Frame numbers now come from time alone.
    expect(frameReadout(1.6, clip).frame).toBe(frameReadout(1.6, clip).frame);
  });
});

// --- Export layout ----------------------------------------------------------

describe('calibration offsetRoom', () => {
  it('measures room in both directions from the adjusted start', () => {
    // start 1.0, end 3.0 → 1.0s of footage before, 3.0 - 0.04 - 1.0 after.
    expect(offsetRoom({ start: 1, end: 3 }, 0)).toEqual({ earlier: 1, later: 1.96 });
  });

  it('counts the current offset as already spent', () => {
    const room = offsetRoom({ start: 1, end: 3 }, 0.5);
    expect(room.earlier).toBeCloseTo(1.5, 10);
    expect(room.later).toBeCloseTo(1.46, 10);
  });

  it('never reports negative room', () => {
    expect(offsetRoom({ start: 0, end: 0.02 }, 0).later).toBe(0);
    expect(offsetRoom({ start: 0, end: 5 }, 0).earlier).toBe(0);
  });

  it('treats a racer without a window as unconstrained', () => {
    expect(offsetRoom(null, 0)).toEqual({ earlier: Infinity, later: Infinity });
  });
});

describe('calibration planOffsetNudge', () => {
  // The shape a real race produces: trace calibration puts every clip at (or a
  // hair after) its first captured frame, so nobody has room to move earlier.
  const windows = [{ start: 0, end: 4.8 }, { start: 0, end: 4.6 }, { start: 0.0105, end: 5.35 }];

  it('moves the clicked racer later out of its own room', () => {
    expect(planOffsetNudge(windows, [0, 0, 0], 2, 1)).toEqual([0, 0, 0.04]);
  });

  it('moves every other racer later when the clicked one cannot go earlier', () => {
    // Regression: "-" was dead on a racer whose clip starts at its first frame.
    // Racer 2 gives back the 0.0105s it has, the other two make up the rest —
    // a full frame of relative movement either way.
    const next = planOffsetNudge(windows, [0, 0, 0], 2, -1);
    expect(next[2]).toBeCloseTo(-0.0105, 10);
    expect(next[0]).toBeCloseTo(0.0295, 10);
    expect(next[1]).toBeCloseTo(0.0295, 10);
    expect(next[0] - next[2]).toBeCloseTo(FRAME_STEP, 10);
  });

  it('shifts the others by the whole nudge when the clicked racer has no room at all', () => {
    const flat = [{ start: 0, end: 4.8 }, { start: 0, end: 4.6 }];
    expect(planOffsetNudge(flat, [0, 0], 0, -2)).toEqual([0, 0.08]);
  });

  it('spends the clicked racer first and only then the others', () => {
    // Racer 0 sits 0.2s in, so a 10-frame (0.4s) move earlier takes 0.2s from
    // it and 0.2s from everyone else.
    const next = planOffsetNudge(windows, [0.2, 0, 0], 0, -10);
    expect(next[0]).toBeCloseTo(0, 10);
    expect(next[1]).toBeCloseTo(0.2, 10);
    expect(next[2]).toBeCloseTo(0.2, 10);
  });

  it('clamps an oversized nudge to the room that is left instead of refusing it', () => {
    // Regression: a 4-frame segment used to ignore +5/+10 entirely rather than
    // moving as far as it could. Racer 0 absorbs the 3 frames it has left and
    // racer 1 gives up the other 2 by moving earlier, so the requested 5 frames
    // of *relative* shift still happen — which is all alignment cares about.
    const shortSeg = [{ start: 3.2, end: 3.36 }, { start: 2.5, end: 2.66 }];
    const next = planOffsetNudge(shortSeg, [0, 0], 0, 5);
    expect(next[0]).toBeCloseTo(0.12, 10); // 3 frames: end - one frame - start
    expect(next[1]).toBeCloseTo(-0.08, 10);
    expect(next[0] - next[1]).toBeCloseTo(5 * FRAME_STEP, 10);
  });

  it('returns null when no racer has any room left', () => {
    const pinned = [{ start: 0, end: 0.04 }, { start: 0, end: 0.04 }];
    expect(planOffsetNudge(pinned, [0, 0], 0, 1)).toBe(null);
    expect(planOffsetNudge(pinned, [0, 0], 0, -1)).toBe(null);
  });

  it('rejects a nudge on a racer without a valid window, and a zero delta', () => {
    expect(planOffsetNudge([null, { start: 0, end: 5 }], [0, 0], 0, 1)).toBe(null);
    expect(planOffsetNudge(windows, [0, 0, 0], 1, 0)).toBe(null);
    expect(planOffsetNudge(null, [0], 0, 1)).toBe(null);
  });

  it('leaves the caller\'s offsets untouched', () => {
    const offsets = [0, 0, 0];
    planOffsetNudge(windows, offsets, 2, -1);
    expect(offsets).toEqual([0, 0, 0]);
  });

  it('keeps a lone racer inside its own window', () => {
    expect(planOffsetNudge([{ start: 0, end: 5 }], [0], 0, -1)).toBe(null);
    expect(planOffsetNudge([{ start: 0, end: 5 }], [0], 0, 1)).toEqual([0.04]);
  });
});


describe('calibration stepFrameTime', () => {
  it('advances exactly one frame from an on-grid position', () => {
    expect(stepFrameTime(0.08, FRAME_STEP, 0, 5)).toBeCloseTo(0.12, 10);
    expect(stepFrameTime(0.08, -FRAME_STEP, 0, 5)).toBeCloseTo(0.04, 10);
  });

  it('lands on the frame boundary even when the position comes back short', () => {
    // Regression: the scrubber round-trips through a DOM string and returns
    // 0.079999 for 0.080. The old code added the step to that, so the seek
    // landed a microsecond before the boundary and the video showed the
    // PREVIOUS frame — permanently one frame behind any racer whose clip
    // starts mid-frame.
    expect(stepFrameTime(0.079999, FRAME_STEP, 0, 5)).toBeCloseTo(0.12, 10);
    expect(stepFrameTime(0.039999, FRAME_STEP, 0, 5)).toBeCloseTo(0.08, 10);
  });

  it('does not accumulate drift over many steps', () => {
    let t = 0;
    for (let i = 0; i < 250; i++) {
      // Feed each result back through the scrubber's precision loss.
      t = stepFrameTime(t - 1e-6, FRAME_STEP, 0, 60);
    }
    expect(t).toBeCloseTo(250 * FRAME_STEP, 9);
  });

  it('snaps an off-grid scrub onto the frame grid', () => {
    expect(stepFrameTime(0.1234, FRAME_STEP, 0, 5)).toBeCloseTo(0.16, 10);
  });

  it('anchors the grid at the clip start, not at zero', () => {
    // A clip starting mid-frame keeps its own offset; steps stay whole frames
    // from it, which is what keeps racers on matching frames.
    expect(stepFrameTime(1.0105, FRAME_STEP, 1.0105, 5)).toBeCloseTo(1.0505, 10);
    expect(stepFrameTime(1.0505, FRAME_STEP, 1.0105, 5)).toBeCloseTo(1.0905, 10);
  });

  it('clamps to the window at both ends', () => {
    expect(stepFrameTime(0, -FRAME_STEP, 0, 5)).toBe(0);
    expect(stepFrameTime(1.2, -FRAME_STEP, 1.2, 5)).toBe(1.2);
    expect(stepFrameTime(5, FRAME_STEP, 0, 5)).toBe(5);
  });

  it('steps back onto the grid after a clamp at the end', () => {
    // maxT need not sit on the grid; stepping away from it re-quantizes.
    const end = 5.017;
    expect(stepFrameTime(end, -FRAME_STEP, 0, end)).toBeCloseTo(4.96, 10);
  });
});

describe('computeExportLayout', () => {
  const ASPECT = 9 / 16; // 640x360 / 480x270 cells

  it('lays out 2 videos in a single 640px-wide row', () => {
    const l = computeExportLayout(2, ASPECT);
    expect(l.targetW).toBe(640);
    expect(l.cellH).toBe(360);
    expect(l.labelH).toBe(30);
    expect(l.positions).toEqual([{ x: 0, y: 0 }, { x: 640, y: 0 }]);
    expect(l.canvasW).toBe(1280);
    expect(l.canvasH).toBe(390); // 360 + 30, already even
  });

  it('never lets a row overflow the canvas (bottom row centred by its own count)', () => {
    // The CLI caps racers at 5, but the layout must stay self-consistent: a
    // fixed half-cell indent pushed a 3-cell bottom row past the canvas.
    for (const count of [2, 3, 4, 5, 6]) {
      const l = computeExportLayout(count, ASPECT);
      for (const pos of l.positions) {
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.x + l.targetW, `count=${count} overflows canvasW`).toBeLessThanOrEqual(l.canvasW);
      }
    }
  });

  it('lays out 3 videos in a single row', () => {
    const l = computeExportLayout(3, ASPECT);
    expect(l.targetW).toBe(640);
    expect(l.positions).toEqual([{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 1280, y: 0 }]);
    expect(l.canvasW).toBe(1920);
    expect(l.canvasH).toBe(390);
  });

  it('lays out 4 videos in a 2x2 grid at 480px', () => {
    const l = computeExportLayout(4, ASPECT);
    expect(l.targetW).toBe(480);
    expect(l.cellH).toBe(270);
    expect(l.positions).toEqual([
      { x: 0, y: 0 }, { x: 480, y: 0 },
      { x: 0, y: 300 }, { x: 480, y: 300 },
    ]);
    expect(l.canvasW).toBe(960);
    expect(l.canvasH).toBe(600); // 2 * (270 + 30)
  });

  it('lays out 5 videos as 3 on top, 2 centered below, on a 3-column canvas', () => {
    const l = computeExportLayout(5, ASPECT);
    expect(l.targetW).toBe(480);
    expect(l.positions).toEqual([
      { x: 0, y: 0 }, { x: 480, y: 0 }, { x: 960, y: 0 },
      { x: 240, y: 300 }, { x: 720, y: 300 },
    ]);
    expect(l.canvasW).toBe(1440);
    expect(l.canvasH).toBe(600);
  });

  it('bumps odd canvas heights to even for libx264', () => {
    // aspect chosen so cellH = 321 -> rawH = 351 (odd) -> canvasH = 352
    const l = computeExportLayout(2, 321 / 640);
    expect(l.cellH).toBe(321);
    expect(l.canvasH).toBe(352);
    expect(l.canvasH % 2).toBe(0);
  });
});

// --- CRC32 / ZIP builder ----------------------------------------------------

const enc = (s) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches known CRC-32 (IEEE) answer vectors', () => {
    expect(crc32(enc(''))).toBe(0x00000000);
    expect(crc32(enc('a'))).toBe(0xE8B7BE43);
    expect(crc32(enc('abc'))).toBe(0x352441C2);
    expect(crc32(enc('123456789'))).toBe(0xCBF43926);
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414FA339);
  });

  it('handles binary data and returns an unsigned 32-bit value', () => {
    const val = crc32(new Uint8Array([0x00, 0xFF, 0x10, 0x80]));
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(0xFFFFFFFF);
    expect(Number.isInteger(val)).toBe(true);
  });
});

describe('createZipBuilder', () => {
  async function buildZip(files) {
    const b = createZipBuilder();
    for (const [name, data] of files) b.addFile(name, data);
    const blob = b.toBlob();
    expect(blob.type).toBe('application/zip');
    return new DataView(await blob.arrayBuffer());
  }

  const SIG_LOCAL = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD = 0x06054b50;

  it('writes a correct local file header for a single stored file', async () => {
    const data = enc('hello');
    const dv = await buildZip([['index.html', data]]);
    expect(dv.getUint32(0, true)).toBe(SIG_LOCAL);
    expect(dv.getUint16(4, true)).toBe(20); // version needed
    expect(dv.getUint16(6, true)).toBe(0x0800); // UTF-8 flag
    expect(dv.getUint16(8, true)).toBe(0); // method: stored (no compression)
    expect(dv.getUint32(14, true)).toBe(crc32(data)); // CRC-32
    expect(dv.getUint32(18, true)).toBe(data.length); // compressed size
    expect(dv.getUint32(22, true)).toBe(data.length); // uncompressed size
    expect(dv.getUint16(26, true)).toBe('index.html'.length); // name length
    expect(dv.getUint16(28, true)).toBe(0); // extra length
    const name = new TextDecoder().decode(new Uint8Array(dv.buffer, 30, 10));
    expect(name).toBe('index.html');
    // File data immediately follows the header
    const body = new TextDecoder().decode(new Uint8Array(dv.buffer, 40, data.length));
    expect(body).toBe('hello');
  });

  it('ends with an EOCD record whose counts and offsets are consistent', async () => {
    const a = enc('hello');
    const b = new Uint8Array([0, 1, 2, 255]);
    const dv = await buildZip([['index.html', a], ['dir/data.bin', b]]);
    const eocdPos = dv.byteLength - 22;
    expect(dv.getUint32(eocdPos, true)).toBe(SIG_EOCD);
    expect(dv.getUint16(eocdPos + 8, true)).toBe(2); // entries on this disk
    expect(dv.getUint16(eocdPos + 10, true)).toBe(2); // total entries
    const localBytes =
      (30 + 'index.html'.length + a.length) + (30 + 'dir/data.bin'.length + b.length);
    const cdSize = (46 + 'index.html'.length) + (46 + 'dir/data.bin'.length);
    expect(dv.getUint32(eocdPos + 12, true)).toBe(cdSize); // central dir size
    expect(dv.getUint32(eocdPos + 16, true)).toBe(localBytes); // central dir offset
    expect(dv.byteLength).toBe(localBytes + cdSize + 22); // nothing else in the file
  });

  it('writes central directory entries pointing back at each local header', async () => {
    const a = enc('hello');
    const b = new Uint8Array([0, 1, 2, 255]);
    const dv = await buildZip([['index.html', a], ['dir/data.bin', b]]);
    const cdOffset = dv.getUint32(dv.byteLength - 22 + 16, true);

    // First central entry
    let pos = cdOffset;
    expect(dv.getUint32(pos, true)).toBe(SIG_CENTRAL);
    expect(dv.getUint32(pos + 16, true)).toBe(crc32(a));
    expect(dv.getUint16(pos + 28, true)).toBe('index.html'.length);
    expect(dv.getUint32(pos + 42, true)).toBe(0); // local header offset of first file
    let name = new TextDecoder().decode(new Uint8Array(dv.buffer, pos + 46, 10));
    expect(name).toBe('index.html');

    // Second central entry
    pos += 46 + 'index.html'.length;
    expect(dv.getUint32(pos, true)).toBe(SIG_CENTRAL);
    expect(dv.getUint16(pos + 28, true)).toBe('dir/data.bin'.length);
    const secondLocal = dv.getUint32(pos + 42, true);
    expect(secondLocal).toBe(30 + 'index.html'.length + a.length);
    expect(dv.getUint32(secondLocal, true)).toBe(SIG_LOCAL); // offset resolves to a local header
    name = new TextDecoder().decode(new Uint8Array(dv.buffer, pos + 46, 12));
    expect(name).toBe('dir/data.bin');
  });

  it('stores every file when no compressor is supplied — the browser build', async () => {
    const data = enc('x'.repeat(200));
    const dv = await buildZip([['padding.txt', data]]);
    expect(dv.getUint16(8, true)).toBe(0); // method: stored
    expect(dv.getUint32(18, true)).toBe(data.length); // compressed size == the input
  });

  it('deflates a file when the compressor shrinks it, keeping the original CRC and size', async () => {
    const zlib = await import('node:zlib');
    const data = enc('x'.repeat(200));
    const b = createZipBuilder({ compress: bytes => zlib.deflateRawSync(bytes) });
    b.addFile('padding.txt', data);
    const dv = new DataView(await b.toBlob().arrayBuffer());
    expect(dv.getUint16(8, true)).toBe(8); // method: deflated
    expect(dv.getUint32(14, true)).toBe(crc32(data)); // CRC is of the original bytes
    expect(dv.getUint32(18, true)).toBeLessThan(data.length); // compressed size
    expect(dv.getUint32(22, true)).toBe(data.length); // uncompressed size
  });

  it('keeps a file stored when compressing it would not make it smaller', async () => {
    // Random bytes: deflate adds framing rather than saving anything.
    const data = new Uint8Array(64);
    for (let i = 0; i < data.length; i++) data[i] = (i * 97 + 13) % 256;
    const zlib = await import('node:zlib');
    const b = createZipBuilder({ compress: bytes => zlib.deflateRawSync(bytes) });
    b.addFile('noise.bin', data);
    const dv = new DataView(await b.toBlob().arrayBuffer());
    expect(dv.getUint16(8, true)).toBe(0);
    expect(dv.getUint32(18, true)).toBe(data.length);
  });

  it('lets the compressor opt a file out by name', async () => {
    const seen = [];
    const b = createZipBuilder({ compress: (bytes, name) => { seen.push(name); return null; } });
    b.addFile('clip.webm', enc('y'.repeat(200)));
    const dv = new DataView(await b.toBlob().arrayBuffer());
    expect(seen).toEqual(['clip.webm']);
    expect(dv.getUint16(8, true)).toBe(0); // stored, as the hook asked
  });

  it('produces an archive that a real unzip implementation accepts', async () => {
    const dv = await buildZip([['index.html', enc('<html></html>')], ['notes.txt', enc('ok')]]);
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
    try {
      const zipPath = path.join(tmp, 'out.zip');
      fs.writeFileSync(zipPath, Buffer.from(dv.buffer));
      const listing = execFileSync('python3', ['-c',
        `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); z.testzip(); print(','.join(sorted(z.namelist())))`,
        zipPath], { encoding: 'utf-8' });
      expect(listing.trim()).toBe('index.html,notes.txt');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('calibration holdTransportPosition', () => {
  it('keeps the transport where it was when the window is unchanged', () => {
    const held = holdTransportPosition(SCRUBBER_MAX / 2, 10, 10);
    expect(held.elapsed).toBeCloseTo(5, 10);
    expect(held.scrubber).toBeCloseTo(SCRUBBER_MAX / 2, 10);
  });

  it('holds the same moment, not the same fraction, when a nudge resizes the window', () => {
    // Half of a 10s clip is 5s in. After the window grows to 20s the user must
    // still be looking at 5s — the scrubber moves instead.
    const held = holdTransportPosition(SCRUBBER_MAX / 2, 10, 20);
    expect(held.elapsed).toBeCloseTo(5, 10);
    expect(held.scrubber).toBeCloseTo(SCRUBBER_MAX / 4, 10);
  });

  it('clamps into a window that a nudge shrank past the held position', () => {
    const held = holdTransportPosition(SCRUBBER_MAX, 10, 4);
    expect(held.elapsed).toBeCloseTo(4, 10);
    expect(held.scrubber).toBeCloseTo(SCRUBBER_MAX, 10);
  });

  it('stays at the clip start when it was already there', () => {
    expect(holdTransportPosition(0, 10, 10)).toEqual({ elapsed: 0, scrubber: 0 });
  });

  it('falls back to the start for a window with no duration either side', () => {
    expect(holdTransportPosition(500, 0, 10)).toEqual({ elapsed: 0, scrubber: 0 });
    expect(holdTransportPosition(500, 10, 0)).toEqual({ elapsed: 0, scrubber: 0 });
    expect(holdTransportPosition(500, -1, -1)).toEqual({ elapsed: 0, scrubber: 0 });
  });

  it('reads the scrubber value as a number even when the DOM hands back a string', () => {
    // scrubber.value is a string off a range input.
    expect(holdTransportPosition('500', 10, 10).elapsed).toBeCloseTo(5, 10);
  });
});
