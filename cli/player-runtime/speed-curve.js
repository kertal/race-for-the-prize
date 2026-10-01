/* eslint-env browser */
/**
 * speed-curve.js — The <speed-curve-editor> web component and its wiring into
 * the transport. The math lives in speed-curve.cjs; the markup and styles in
 * player.html (#tmpl-speed-curve), themed through the shared tokens, which
 * inherit into the shadow root.
 *
 * The curve owns playbackRate whenever it has keyframes: watchClipEnd()
 * calls applySpeedCurve() on every frame of playback (panel open or not),
 * and export samples the same curve on its own clock.
 */

const CURVE_POINT_RADIUS = 6;
const CURVE_HIT_RADIUS = CURVE_POINT_RADIUS * 2 + 4;
const CURVE_SNAP_PX = 14;
const CURVE_KEY_TIME_STEP = 0.01;
const CURVE_KEY_TIME_STEP_LARGE = 0.1;

class SpeedCurveEditor extends HTMLElement {
  constructor() {
    super();
    this._pts = [];
    this._uid = 0;
    this._dur = 0;
    this._now = 0;
    this._baseSpeed = 1;
    this._clips = [];
    this._dragId = -1;
    this._hoverId = -1;
    this._selId = -1;
    this._raf = 0;

    const root = this.attachShadow({ mode: 'open' });
    root.appendChild(document.getElementById('tmpl-speed-curve').content.cloneNode(true));
    this._canvas = root.querySelector('canvas');
    this._status = root.querySelector('.status');
    root.querySelector('.reset').addEventListener('click', () => this.reset());

    const c = this._canvas;
    c.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    c.addEventListener('pointermove', (e) => this._onPointerMove(e));
    c.addEventListener('pointerup', () => this._endDrag());
    c.addEventListener('pointercancel', () => this._endDrag());
    c.addEventListener('pointerleave', () => { if (this._dragId < 0) this._setHover(-1); });
    c.addEventListener('contextmenu', (e) => this._onContextMenu(e));
    c.addEventListener('keydown', (e) => this._onKeyDown(e));
    this._ro = new ResizeObserver(() => this._invalidate());
  }

  connectedCallback() { this._ro.observe(this._canvas); }
  disconnectedCallback() { this._ro.disconnect(); }

  get hasPoints() { return this._pts.length > 0; }

  speedAt(t) { return curveSpeedAt(this._pts, t, this._baseSpeed); }

  // One call per sync so a playback tick redraws at most once.
  update({ duration, currentTime, baseSpeed, clips }) {
    if (duration !== undefined) this._dur = Math.max(0, +duration || 0);
    if (currentTime !== undefined) this._now = Math.max(0, +currentTime || 0);
    if (baseSpeed !== undefined) this._baseSpeed = +baseSpeed || 1;
    if (clips !== undefined) this._clips = clips;
    this._invalidate();
  }

  reset() {
    if (!this._pts.length) return;
    this._pts = [];
    this._dragId = this._hoverId = this._selId = -1;
    this._announce('Speed curve cleared');
    this._changed();
  }

  // --- geometry ---

  _geom() {
    const W = this._canvas.clientWidth, H = this._canvas.clientHeight;
    return { W, H, plotH: curvePlotHeight(H, this._clips.length) };
  }

  _tx(t, W) { return this._dur > 0 ? (t / this._dur) * W : 0; }
  _xt(x, W) { return this._dur > 0 ? Math.max(0, Math.min(this._dur, (x / W) * this._dur)) : 0; }
  _sy(s, plotH) { return plotH - speedToFrac(s) * plotH; }

  _pointAt(x, y) {
    const { W, plotH } = this._geom();
    let best = null, bestD = Infinity;
    for (const p of this._pts) {
      const d = Math.hypot(x - this._tx(p.t, W), y - this._sy(p.s, plotH));
      if (d < bestD) { bestD = d; best = p; }
    }
    return bestD < CURVE_HIT_RADIUS ? best : null;
  }

  _pointFromPointer(x, y) {
    const { W, plotH } = this._geom();
    const frac = 1 - Math.max(0, Math.min(plotH, y)) / plotH;
    return { t: this._xt(x, W), s: snapCurveSpeed(frac, plotH, CURVE_SNAP_PX) };
  }

  _local(e) {
    const r = this._canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // --- editing ---

  _byId(id) { return this._pts.find(p => p.id === id) || null; }

  _sort() { this._pts.sort((a, b) => a.t - b.t); }

  _changed() {
    this._invalidate();
    this.dispatchEvent(new CustomEvent('speedchange', { bubbles: true, composed: true }));
  }

  _select(p) {
    this._selId = p ? p.id : -1;
    if (p) this._announce(this._describe(p));
  }

  _describe(p) {
    const n = this._pts.indexOf(p) + 1;
    return 'Keyframe ' + n + ' of ' + this._pts.length + ': ' + p.t.toFixed(1) + 's at ' + p.s.toFixed(2) + 'x';
  }

  _announce(text) { this._status.textContent = text; }

  _remove(p) {
    this._pts = this._pts.filter(q => q !== p);
    if (this._selId === p.id) this._selId = -1;
    this._dragId = this._hoverId = -1;
    this._announce('Keyframe removed');
    this._changed();
  }

  _setHover(id) {
    if (this._hoverId === id) return;
    this._hoverId = id;
    this._invalidate();
  }

  _onPointerDown(e) {
    if (e.button !== 0 || this._dur <= 0) return;
    const { x, y } = this._local(e);
    let p = this._pointAt(x, y);
    if (!p) {
      p = { ...this._pointFromPointer(x, y), id: ++this._uid };
      this._pts.push(p);
      this._sort();
      this._changed();
    }
    this._dragId = p.id;
    this._select(p);
    this._canvas.setPointerCapture(e.pointerId);
    this._invalidate();
  }

  _onPointerMove(e) {
    const { x, y } = this._local(e);
    const dragged = this._byId(this._dragId);
    if (dragged) {
      Object.assign(dragged, this._pointFromPointer(x, y));
      this._sort();
      this._canvas.style.cursor = 'grabbing';
      this._changed();
      return;
    }
    const over = this._pointAt(x, y);
    this._canvas.style.cursor = over ? 'grab' : 'crosshair';
    this._setHover(over ? over.id : -1);
  }

  _endDrag() {
    const dragged = this._byId(this._dragId);
    this._dragId = -1;
    if (dragged) this._announce(this._describe(dragged));
    this._invalidate();
  }

  _onContextMenu(e) {
    const { x, y } = this._local(e);
    const p = this._pointAt(x, y);
    if (!p) return;
    e.preventDefault();
    this._remove(p);
  }

  // Enter adds a keyframe at the playhead, PageUp/PageDown pick one, arrows
  // move it (Shift for larger steps), Delete removes it. Handled keys stop
  // here so the player's frame-step and play shortcuts don't fire as well.
  _onKeyDown(e) {
    const sel = this._byId(this._selId);
    const idx = sel ? this._pts.indexOf(sel) : -1;
    const timeStep = (e.shiftKey ? CURVE_KEY_TIME_STEP_LARGE : CURVE_KEY_TIME_STEP) * this._dur;
    let handled = true;
    if (e.key === 'Enter' && this._dur > 0) {
      const p = { t: Math.min(this._now, this._dur), s: this.speedAt(this._now), id: ++this._uid };
      this._pts.push(p);
      this._sort();
      this._select(p);
      this._changed();
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      if (this._pts.length) {
        const dir = e.key === 'PageDown' ? 1 : -1;
        const next = idx < 0 ? (dir > 0 ? 0 : this._pts.length - 1) : Math.max(0, Math.min(this._pts.length - 1, idx + dir));
        this._select(this._pts[next]);
        this._invalidate();
      }
    } else if (sel && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      sel.t = Math.max(0, Math.min(this._dur, sel.t + (e.key === 'ArrowRight' ? timeStep : -timeStep)));
      this._sort();
      this._announce(this._describe(sel));
      this._changed();
    } else if (sel && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      sel.s = stepCurveSpeed(sel.s, e.key === 'ArrowUp' ? 1 : -1);
      this._announce(this._describe(sel));
      this._changed();
    } else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) {
      this._remove(sel);
    } else {
      handled = e.key.startsWith('Arrow');
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // --- drawing ---

  _invalidate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }

  _draw() {
    const canvas = this._canvas;
    const { W, H, plotH } = this._geom();
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this);
    const token = (name) => css.getPropertyValue(name).trim();
    const accent = token('--accent');
    const font = token('--font-ui');
    const tx = (t) => this._tx(t, W);
    const sy = (s) => this._sy(s, plotH);

    ctx.fillStyle = token('--bg');
    ctx.fillRect(0, 0, W, H);

    this._clips.forEach((clip, i) => {
      const y = plotH + CURVE_STRIP_PAD + i * (CURVE_STRIP_HEIGHT + CURVE_STRIP_GAP);
      const x1 = tx(clip.start), x2 = tx(clip.end);
      ctx.fillStyle = token('--surface');
      ctx.fillRect(0, y, W, CURVE_STRIP_HEIGHT);
      ctx.fillStyle = clip.color;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x1, y, Math.max(1, x2 - x1), CURVE_STRIP_HEIGHT);
      ctx.globalAlpha = 1;
    });

    ctx.font = '9px ' + font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const gs of SPEED_CURVE_GRID) {
      const y = sy(gs);
      const isOne = gs === 1;
      ctx.strokeStyle = token(isOne ? '--border-strong' : '--border-subtle');
      ctx.lineWidth = isOne ? 1.5 : 1;
      ctx.setLineDash(isOne ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = token(isOne ? '--text-faint' : '--text-ghost');
      ctx.fillText(gs + 'x', 3, Math.max(6, Math.min(plotH - 6, y)));
    }
    ctx.textBaseline = 'alphabetic';

    const cx = tx(this._now);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const pts = this._pts;
    if (!pts.length) {
      const y = sy(this._baseSpeed);
      ctx.strokeStyle = token('--border');
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = token('--text-faint');
      ctx.font = '10px ' + font;
      ctx.textAlign = 'center';
      ctx.fillText('Click to add speed keyframes', W / 2, plotH / 2 + 4);
      return;
    }

    const firstY = sy(pts[0].s), lastY = sy(pts[pts.length - 1].s);
    const tracePath = () => {
      ctx.moveTo(0, firstY);
      for (const p of pts) ctx.lineTo(tx(p.t), sy(p.s));
      ctx.lineTo(W, lastY);
    };

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.08;
    ctx.beginPath();
    ctx.moveTo(0, plotH);
    tracePath();
    ctx.lineTo(W, plotH);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    tracePath();
    ctx.stroke();

    for (const p of pts) {
      const px = tx(p.t), py = sy(p.s);
      const hot = p.id === this._hoverId || p.id === this._dragId || p.id === this._selId;
      ctx.fillStyle = token(hot ? '--accent-bright' : '--accent');
      ctx.strokeStyle = token('--bg');
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, CURVE_POINT_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (!hot) continue;
      const label = p.t.toFixed(1) + 's · ' + p.s.toFixed(2) + 'x';
      ctx.font = 'bold 10px ' + font;
      const lw = ctx.measureText(label).width;
      ctx.fillStyle = token('--text');
      ctx.textAlign = 'left';
      const ly = py > plotH / 2 ? py - CURVE_POINT_RADIUS - 4 : py + CURVE_POINT_RADIUS + 12;
      ctx.fillText(label, Math.max(2, Math.min(W - lw - 4, px - lw / 2)), ly);
    }
  }
}

customElements.define('speed-curve-editor', SpeedCurveEditor);

// --- Transport wiring ---

const speedCurveEditor = document.getElementById('speedCurveEditor');
const speedCurvePanel = document.getElementById('speedCurvePanel');
const speedCurveToggle = document.getElementById('speedCurveToggle');

function speedCurveActive() {
  return !!speedCurveEditor && speedCurveEditor.hasPoints;
}

function setPlaybackRate(rate) {
  videos.forEach(v => { if (v && v.playbackRate !== rate) v.playbackRate = rate; });
}

function speedCurveRacerClips() {
  if (!clipTimes || !activeClip) return [];
  const ct = getAdjustedClipTimes() || clipTimes;
  const clips = [];
  for (let i = 0; i < raceVideos.length; i++) {
    if (hiddenRacers.has(i) || !isValidClipEntry(ct[i])) continue;
    clips.push({
      start: Math.max(0, ct[i].start - activeClip.start),
      end: ct[i].end - activeClip.start,
      color: racerColors[i] || racerColors[0],
    });
  }
  return clips;
}

// Called from updateTimeDisplay(), so the editor follows every seek, step,
// segment switch and racer-filter change without a loop of its own.
function syncSpeedCurveEditor(elapsed) {
  if (!speedCurveEditor || speedCurvePanel.hidden) return;
  speedCurveEditor.update({
    duration: clipDuration(),
    currentTime: elapsed,
    baseSpeed: Number.parseFloat(speedSelect.value) || 1,
    clips: speedCurveRacerClips(),
  });
}

// Called by watchClipEnd() on every frame while the transport plays.
function applySpeedCurve(elapsed) {
  if (!speedCurveActive()) return;
  setPlaybackRate(speedCurveEditor.speedAt(elapsed));
  if (!speedCurvePanel.hidden) speedCurveEditor.update({ currentTime: elapsed });
}

// While a curve is drawn it is the only source of playback speed, so the
// fixed-speed menu is disabled rather than silently overridden.
function refreshSpeedCurveState() {
  const active = speedCurveActive();
  speedCurveToggle.classList.toggle('active', active);
  speedSelect.disabled = active;
  if (active) speedSelect.title = 'Playback speed follows the speed curve';
  else speedSelect.removeAttribute('title');
  if (!active) setPlaybackRate(Number.parseFloat(speedSelect.value) || 1);
}

if (speedCurveEditor) {
  speedCurveEditor.addEventListener('speedchange', refreshSpeedCurveState);
  speedCurveToggle.addEventListener('click', () => {
    const open = speedCurvePanel.hidden;
    speedCurvePanel.hidden = !open;
    speedCurveToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      const d = clipDuration();
      syncSpeedCurveEditor(d > 0 ? (scrubber.value / 1000) * d : 0);
    }
  });
}
