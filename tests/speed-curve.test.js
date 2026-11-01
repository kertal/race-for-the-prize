import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildPlayerHtml } from '../cli/videoplayer.js';

const require = createRequire(import.meta.url);
const {
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
  normalizeKeyframes,
} = require('../cli/player-runtime/speed-curve.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('speed axis', () => {
  it('maps the speed range onto 0..1 and back', () => {
    expect(speedToFrac(SPEED_CURVE_MIN)).toBe(0);
    expect(speedToFrac(SPEED_CURVE_MAX)).toBeCloseTo(1);
    for (const s of SPEED_CURVE_GRID) expect(fracToSpeed(speedToFrac(s))).toBeCloseTo(s);
  });

  it('is logarithmic: halving and doubling are the same distance', () => {
    expect(speedToFrac(1) - speedToFrac(0.5)).toBeCloseTo(speedToFrac(2) - speedToFrac(1));
  });

  it('clamps speeds and fractions outside the axis', () => {
    expect(speedToFrac(100)).toBeCloseTo(1);
    expect(speedToFrac(0)).toBe(0);
    expect(fracToSpeed(-1)).toBeCloseTo(SPEED_CURVE_MIN);
    expect(fracToSpeed(2)).toBeCloseTo(SPEED_CURVE_MAX);
  });
});

describe('curveSpeedAt', () => {
  const pts = [{ t: 2, s: 2 }, { t: 6, s: 0.5 }];

  it('falls back to the speed menu with no keyframes', () => {
    expect(curveSpeedAt([], 3, 1.5)).toBe(1.5);
  });

  it('holds the first and last keyframe speeds outside the keyframes', () => {
    expect(curveSpeedAt(pts, 0, 1)).toBe(2);
    expect(curveSpeedAt(pts, 99, 1)).toBe(0.5);
  });

  it('interpolates in log space, so 2x → 0.5x passes 1x at the midpoint', () => {
    expect(curveSpeedAt(pts, 4, 1)).toBeCloseTo(1);
  });

  it('never divides by a zero span when two keyframes share a time', () => {
    const stacked = [{ t: 1, s: 0.25 }, { t: 3, s: 1 }, { t: 3, s: 4 }, { t: 5, s: 2 }];
    for (const t of [0, 1, 2, 2.999, 3, 3.001, 4, 5, 6]) {
      expect(Number.isFinite(curveSpeedAt(stacked, t, 1))).toBe(true);
    }
    expect(curveSpeedAt(stacked, 3, 1)).toBe(1);
  });
});

describe('snapCurveSpeed', () => {
  it('lands on a grid speed when the pointer is within the snap distance', () => {
    const plotH = 100;
    const nearOne = speedToFrac(1) + 5 / plotH;
    expect(snapCurveSpeed(nearOne, plotH, 14)).toBe(1);
  });

  it('keeps the free speed when no grid line is close', () => {
    const between = (speedToFrac(1) + speedToFrac(2)) / 2;
    expect(snapCurveSpeed(between, 100, 2)).toBeCloseTo(fracToSpeed(between));
  });
});

describe('stepCurveSpeed', () => {
  it('moves to the neighbouring grid speed', () => {
    expect(stepCurveSpeed(1, 1)).toBe(2);
    expect(stepCurveSpeed(1, -1)).toBe(0.5);
    expect(stepCurveSpeed(0.7, 1)).toBe(1);
    expect(stepCurveSpeed(0.7, -1)).toBe(0.5);
  });

  it('holds at the ends of the axis', () => {
    expect(stepCurveSpeed(SPEED_CURVE_MAX, 1)).toBe(SPEED_CURVE_MAX);
    expect(stepCurveSpeed(SPEED_CURVE_MIN, -1)).toBe(SPEED_CURVE_MIN);
  });
});

describe('normalizeKeyframes', () => {
  it('sorts, clamps speeds to the axis, and drops malformed entries', () => {
    expect(normalizeKeyframes([
      { t: 3, s: 0.5 }, { t: 1, s: 99 }, { t: -1, s: 1 }, { t: 2, s: NaN }, null, { t: '4', s: 1 }, { t: 0, s: 0.01 },
    ])).toEqual([{ t: 0, s: SPEED_CURVE_MIN }, { t: 1, s: SPEED_CURVE_MAX }, { t: 3, s: 0.5 }]);
  });

  it('treats anything but an array as no curve', () => {
    expect(normalizeKeyframes(undefined)).toEqual([]);
    expect(normalizeKeyframes({ t: 1, s: 1 })).toEqual([]);
  });
});

describe('curvePlotHeight', () => {
  it('is the whole canvas without racer strips', () => {
    expect(curvePlotHeight(90, 0)).toBe(90);
  });

  it('leaves room for one strip per racer under the plot', () => {
    expect(curvePlotHeight(90, 4)).toBe(90 - (4 * (CURVE_STRIP_HEIGHT + CURVE_STRIP_GAP) + CURVE_STRIP_PAD));
  });
});

describe('speed curve in the generated player', () => {
  const html = buildPlayerHtml({
    racers: ['lauda', 'hunt'],
    comparisons: [],
    overallWinner: null,
    timestamp: '2025-01-15T12:00:00.000Z',
    settings: {},
    errors: [],
    wins: {},
    videos: {},
  }, ['lauda/lauda.race.webm', 'hunt/hunt.race.webm']);

  it('ships the toggle, a collapsed panel, and the editor template', () => {
    expect(html).toContain('id="speedCurveToggle"');
    expect(html).toMatch(/id="speedCurveToggle"[^>]*aria-controls="speedCurvePanel"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/id="speedCurvePanel" hidden/);
    expect(html).toContain('<template id="tmpl-speed-curve">');
  });

  // The editor is cloned from the template when the custom element upgrades,
  // and updateTimeDisplay() calls into speed-curve.js during main.js startup.
  it('loads the template before the script, and the editor before main.js', () => {
    expect(html.indexOf('id="tmpl-speed-curve"')).toBeLessThan(html.indexOf('<script>\n(function()'));
    const define = html.indexOf("customElements.define('speed-curve-editor'");
    const startup = html.indexOf('buildRacerFilter();');
    expect(define).toBeGreaterThan(-1);
    expect(define).toBeLessThan(startup);
  });

  it('styles the shadow root with tokens only, so skins reach it', () => {
    const tmpl = html.slice(html.indexOf('<template id="tmpl-speed-curve">'));
    const style = tmpl.slice(tmpl.indexOf('<style>'), tmpl.indexOf('</style>'));
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('builds the shadow DOM without innerHTML', () => {
    const src = fs.readFileSync(path.join(__dirname, '../cli/player-runtime/speed-curve.js'), 'utf-8');
    expect(src).not.toContain('innerHTML');
  });
});

// The editor ships in every player, so until someone draws a curve it must
// leave playback exactly as it was: the speed menu keeps sole control.
describe('speed curve without keyframes (no regression)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../cli/player-runtime/speed-curve.js'), 'utf-8');
  const wiring = src.slice(src.indexOf('// --- Transport wiring'));

  function harness({ hasPoints = false, panelHidden = true, raceConfig = {} } = {}) {
    const videos = [{ playbackRate: 2 }, { playbackRate: 2 }];
    const editor = { hasPoints, speedAt: () => 0.25, update: vi.fn(), addEventListener() {} };
    const panel = { hidden: panelHidden };
    const toggle = { addEventListener() {}, setAttribute() {}, classList: { toggle() {} } };
    const byId = { speedCurveEditor: editor, speedCurvePanel: panel, speedCurveToggle: toggle };
    const ctx = {
      document: { getElementById: id => byId[id] },
      videos, raceVideos: videos, clipTimes: null, activeClip: null, hiddenRacers: new Set(),
      racerColors: [], speedSelect: { value: '2' }, scrubber: { value: 0 }, raceConfig,
      clipDuration: () => 10, getAdjustedClipTimes: () => null, isValidClipEntry: () => false,
    };
    vm.createContext(ctx);
    vm.runInContext(wiring, ctx);
    return { ctx, videos, editor };
  }

  it('a page without a baked curve loads with no keyframes', () => {
    expect(harness().editor.keyframes).toBeUndefined();
  });

  it('an exported page loads the curve baked into #race-config', () => {
    const curve = [{ t: 1, s: 4 }, { t: 3, s: 0.25 }];
    expect(harness({ raceConfig: { speedCurve: curve } }).editor.keyframes).toEqual(curve);
  });

  it('never touches playbackRate during playback', () => {
    const { ctx, videos } = harness();
    for (const t of [0, 1, 5, 10]) ctx.applySpeedCurve(t);
    expect(videos.map(v => v.playbackRate)).toEqual([2, 2]);
  });

  it('is not considered active, so export keeps the speed menu rate', () => {
    expect(harness().ctx.speedCurveActive()).toBe(false);
  });

  it('does no editor work while the panel is closed', () => {
    const { ctx, editor } = harness();
    ctx.syncSpeedCurveEditor(3);
    ctx.applySpeedCurve(3);
    expect(editor.update).not.toHaveBeenCalled();
  });

  it('takes over playbackRate only once a curve is drawn', () => {
    const { ctx, videos } = harness({ hasPoints: true });
    ctx.applySpeedCurve(3);
    expect(videos.map(v => v.playbackRate)).toEqual([0.25, 0.25]);
  });
});

// Export HTML / Export Zip clone the live page: the curve has to travel in
// #race-config and be restored on load, while the cloned editor chrome
// (open panel, lit toggle, disabled speed menu) is reset.
describe('speed curve in the HTML export', () => {
  const zip = fs.readFileSync(path.join(__dirname, '../cli/player-runtime/export-zip.js'), 'utf-8');

  function bake({ active, keyframes = [{ t: 1, s: 4 }, { t: 3, s: 0.25 }], prior = {} }) {
    const configScript = { textContent: JSON.stringify({ videoCount: 2, ...prior }) };
    const ctx = {
      JSON, String, Object, Array,
      getAdjustedClipTimes: () => null, clipTimes: null, debugOffsets: [],
      speedCurveActive: () => active,
      speedCurveEditor: { keyframes },
    };
    vm.createContext(ctx);
    vm.runInContext(zip.slice(zip.indexOf('function bakeRaceConfig('), zip.indexOf('// The segment picker')), ctx);
    ctx.bakeRaceConfig({ querySelector: () => configScript }, {}, false);
    return JSON.parse(configScript.textContent);
  }

  it('bakes the drawn keyframes into #race-config', () => {
    expect(bake({ active: true }).speedCurve).toEqual([{ t: 1, s: 4 }, { t: 3, s: 0.25 }]);
  });

  it('leaves no curve behind when none is drawn, even on a re-export', () => {
    expect(bake({ active: false, prior: { speedCurve: [{ t: 1, s: 2 }] } })).not.toHaveProperty('speedCurve');
  });

  it('resets the cloned editor chrome', () => {
    const el = (attrs = {}) => ({ hidden: false, disabled: true, attrs: { ...attrs }, removed: [],
      classList: { list: new Set(['active']), remove(c) { this.list.delete(c); } },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
    const nodes = { '#speedCurvePanel': el(), '#speedCurveToggle': el({ 'aria-expanded': 'true' }), '#speedSelect': el({ title: 'x' }) };
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(zip.slice(zip.indexOf('function resetSpeedCurveUi('), zip.indexOf('// Point <video> src')), ctx);
    ctx.resetSpeedCurveUi({ querySelector: sel => nodes[sel] || null });
    expect(nodes['#speedCurvePanel'].hidden).toBe(true);
    expect(nodes['#speedCurveToggle'].classList.list.has('active')).toBe(false);
    expect(nodes['#speedCurveToggle'].attrs['aria-expanded']).toBe('false');
    expect(nodes['#speedSelect'].disabled).toBe(false);
    expect(nodes['#speedSelect'].attrs).not.toHaveProperty('title');
  });
});
