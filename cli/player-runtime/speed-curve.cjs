/* eslint-env browser */
/**
 * speed-curve.cjs — Pure math behind the speed curve editor: the log-scale
 * speed axis, interpolation between keyframes, grid snapping, and the plot
 * geometry shared by drawing and hit testing.
 *
 * Side-effect free and DOM independent so Node can require() it for unit
 * tests; in the browser build the guarded module.exports is a no-op.
 */

const SPEED_CURVE_MIN = 0.1;
const SPEED_CURVE_MAX = 4;
const SPEED_CURVE_GRID = [0.1, 0.25, 0.5, 1, 2, 4];

// Racer clip strips sit under the plot; the editable area is what is left.
const CURVE_STRIP_HEIGHT = 4;
const CURVE_STRIP_GAP = 1;
const CURVE_STRIP_PAD = 4;

// Speeds live on a log axis so halving and doubling are the same distance
// (0.5x → 1x looks like 1x → 2x), which is also how the curve interpolates.
function speedToFrac(s) {
  const lo = Math.log(SPEED_CURVE_MIN), hi = Math.log(SPEED_CURVE_MAX);
  const clamped = Math.max(SPEED_CURVE_MIN, Math.min(SPEED_CURVE_MAX, s));
  return (Math.log(clamped) - lo) / (hi - lo);
}

function fracToSpeed(f) {
  const lo = Math.log(SPEED_CURVE_MIN), hi = Math.log(SPEED_CURVE_MAX);
  return Math.exp(lo + Math.max(0, Math.min(1, f)) * (hi - lo));
}

// points: [{ t, s }] sorted by t. Flat before the first and after the last
// keyframe; with no keyframes, the fallback (the speed menu) applies.
function curveSpeedAt(points, t, fallback) {
  if (!points.length) return fallback;
  if (t <= points[0].t) return points[0].s;
  const last = points[points.length - 1];
  if (t >= last.t) return last.s;
  // t > a.t is guaranteed by the previous iteration, so two keyframes sharing
  // a time can never reach the division with a zero span.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b.t) {
      const frac = (t - a.t) / (b.t - a.t);
      return fracToSpeed(speedToFrac(a.s) + frac * (speedToFrac(b.s) - speedToFrac(a.s)));
    }
  }
  return last.s;
}

// frac is the pointer's height on the plot (0 = bottom). A pointer within
// snapPx of a grid line lands exactly on that speed.
function snapCurveSpeed(frac, plotHeight, snapPx) {
  let best = fracToSpeed(frac);
  let bestD = Infinity;
  for (const gs of SPEED_CURVE_GRID) {
    const d = Math.abs(frac - speedToFrac(gs)) * plotHeight;
    if (d < snapPx && d < bestD) { bestD = d; best = gs; }
  }
  return best;
}

// The next grid speed above (dir > 0) or below (dir < 0) s, held at the ends.
function stepCurveSpeed(s, dir) {
  const EPS = 1e-9;
  if (dir > 0) return SPEED_CURVE_GRID.find(g => g > s + EPS) ?? SPEED_CURVE_MAX;
  return [...SPEED_CURVE_GRID].reverse().find(g => g < s - EPS) ?? SPEED_CURVE_MIN;
}

function curvePlotHeight(canvasHeight, stripCount) {
  if (stripCount <= 0) return canvasHeight;
  return canvasHeight - (stripCount * (CURVE_STRIP_HEIGHT + CURVE_STRIP_GAP) + CURVE_STRIP_PAD);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPEED_CURVE_MIN,
    SPEED_CURVE_MAX,
    SPEED_CURVE_GRID,
    CURVE_STRIP_HEIGHT,
    CURVE_STRIP_GAP,
    CURVE_STRIP_PAD,
    speedToFrac,
    fracToSpeed,
    curveSpeedAt,
    snapCurveSpeed,
    stepCurveSpeed,
    curvePlotHeight,
  };
}
