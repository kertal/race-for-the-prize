// Speed Curve Editor — web component + player integration.
// Lets the user draw a piecewise-linear playback-speed curve over the clip
// duration, so sections can be slowed down or sped up on playback and export.

class SpeedCurveEditor extends HTMLElement {
  static get observedAttributes() { return ['duration', 'current-time']; }

  constructor() {
    super();
    this._pts = [];
    this._uid = 0;
    this._dur = 0;
    this._now = 0;
    this._baseSpeed = 1;
    this._racerClips = [];
    this._dragId = -1;
    this._hoverIdx = -1;
    this._MIN = 0.1;
    this._MAX = 4;
    this._GRID = [0.1, 0.25, 0.5, 1, 2, 4];
    this._R = 6;
    this._SNAP = 14;

    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
:host { display: block; }
.hdr { display:flex; align-items:center; gap:0.6rem; padding:0.2rem 0 0.4rem; font-family:ui-monospace,'Courier New',monospace; }
.title { font-size:0.72rem; color:#d4af37; text-transform:uppercase; letter-spacing:0.1em; font-weight:bold; flex-shrink:0; }
.hint { font-size:0.68rem; color:#555; flex:1; }
button { background:#2a2a2a; color:#777; border:1px solid #444; border-radius:4px; padding:0.15rem 0.5rem; font-size:0.72rem; cursor:pointer; font-family:ui-monospace,'Courier New',monospace; transition:border-color 0.2s,color 0.2s; flex-shrink:0; }
button:hover { border-color:#d4af37; color:#e8e0d0; }
canvas { width:100%; height:90px; display:block; border-radius:4px; cursor:crosshair; border:1px solid #222; touch-action:none; }
</style>
<div class="hdr">
  <span class="title">Speed Curve</span>
  <span class="hint">Click to add &middot; Drag to move &middot; Right-click to remove</span>
  <button type="button" part="reset">Reset</button>
</div>
<canvas></canvas>`;

    this._canvas = root.querySelector('canvas');
    root.querySelector('button').addEventListener('click', () => this.reset());
    this._boundWinMove = (e) => this._onWindowMove(e);
    this._boundWinUp = () => { this._dragId = -1; };
    this._ro = new ResizeObserver(() => this._draw());
  }

  connectedCallback() {
    const c = this._canvas;
    c.addEventListener('mousedown', (e) => this._onDown(e));
    c.addEventListener('mousemove', (e) => this._onMove(e));
    c.addEventListener('contextmenu', (e) => this._onCtx(e));
    c.addEventListener('mouseleave', () => { if (this._dragId < 0) { this._hoverIdx = -1; this._draw(); } });
    window.addEventListener('mousemove', this._boundWinMove);
    window.addEventListener('mouseup', this._boundWinUp);
    this._ro.observe(c);
    this._draw();
  }

  disconnectedCallback() {
    window.removeEventListener('mousemove', this._boundWinMove);
    window.removeEventListener('mouseup', this._boundWinUp);
    this._ro.disconnect();
  }

  attributeChangedCallback(name, _, val) {
    if (name === 'duration') this.duration = val;
    if (name === 'current-time') this.currentTime = val;
  }

  get duration() { return this._dur; }
  set duration(v) { this._dur = +v || 0; this._draw(); }

  get currentTime() { return this._now; }
  set currentTime(v) { this._now = +v || 0; this._draw(); }

  get baseSpeed() { return this._baseSpeed; }
  set baseSpeed(v) { this._baseSpeed = +v || 1; this._draw(); }

  get hasPoints() { return this._pts.length > 0; }

  getSpeedAt(t) {
    const pts = this._pts;
    if (!pts.length) return this._baseSpeed;
    if (t <= pts[0].t) return pts[0].s;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].s;
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        const a = pts[i - 1], b = pts[i];
        const frac = (t - a.t) / (b.t - a.t);
        return this._f2s(this._s2f(a.s) + frac * (this._s2f(b.s) - this._s2f(a.s)));
      }
    }
    return this._baseSpeed;
  }

  setRacerClips(clips) {
    this._racerClips = clips || [];
    this._draw();
  }

  reset() {
    this._pts = [];
    this._hoverIdx = -1;
    this._dragId = -1;
    this._draw();
    this._emit();
  }

  _s2f(s) {
    const lo = Math.log(this._MIN), hi = Math.log(this._MAX);
    return (Math.log(Math.max(this._MIN, Math.min(this._MAX, s))) - lo) / (hi - lo);
  }

  _f2s(f) {
    const lo = Math.log(this._MIN), hi = Math.log(this._MAX);
    return Math.exp(lo + Math.max(0, Math.min(1, f)) * (hi - lo));
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('speedchange', { bubbles: true, detail: { hasPoints: this.hasPoints } }));
  }

  _nearestIdx(x, y, W, H) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this._pts.length; i++) {
      const d = Math.hypot(x - this._tx(this._pts[i].t, W), y - this._sy(this._pts[i].s, H));
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD < this._R * 2 + 4 ? best : -1;
  }

  _tx(t, W) { return this._dur > 0 ? (t / this._dur) * W : 0; }
  _sy(s, H) { return H - this._s2f(s) * H; }
  _xt(x, W) { return this._dur > 0 ? Math.max(0, Math.min(this._dur, (x / W) * this._dur)) : 0; }

  _snapSpeed(y, H) {
    let best = this._f2s(Math.max(0, Math.min(1, 1 - y / H))), bestD = Infinity;
    for (const gs of this._GRID) {
      const d = Math.abs(y - (H - this._s2f(gs) * H));
      if (d < this._SNAP && d < bestD) { bestD = d; best = gs; }
    }
    return best;
  }

  _rect(e) {
    const r = this._canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onDown(e) {
    if (e.button !== 0) return;
    const { x, y } = this._rect(e);
    const W = this._canvas.clientWidth, H = this._canvas.clientHeight;
    const near = this._nearestIdx(x, y, W, H);
    if (near >= 0) { this._dragId = this._pts[near].id; return; }
    const pt = { t: this._xt(x, W), s: this._snapSpeed(y, H), id: ++this._uid };
    this._pts.push(pt);
    this._pts.sort((a, b) => a.t - b.t);
    this._dragId = pt.id;
    this._draw();
    this._emit();
  }

  _onMove(e) {
    const { x, y } = this._rect(e);
    const W = this._canvas.clientWidth, H = this._canvas.clientHeight;
    if (this._dragId >= 0) {
      const idx = this._pts.findIndex(p => p.id === this._dragId);
      if (idx >= 0) {
        this._pts[idx] = { t: this._xt(x, W), s: this._snapSpeed(y, H), id: this._dragId };
        this._pts.sort((a, b) => a.t - b.t);
        this._canvas.style.cursor = 'grabbing';
        this._hoverIdx = -1;
      }
    } else {
      this._hoverIdx = this._nearestIdx(x, y, W, H);
      this._canvas.style.cursor = this._hoverIdx >= 0 ? 'grab' : 'crosshair';
    }
    this._draw();
  }

  _onWindowMove(e) {
    if (this._dragId < 0) return;
    const { x, y } = this._rect(e);
    const W = this._canvas.clientWidth, H = this._canvas.clientHeight;
    const idx = this._pts.findIndex(p => p.id === this._dragId);
    if (idx >= 0) {
      this._pts[idx] = { t: this._xt(x, W), s: this._snapSpeed(y, H), id: this._dragId };
      this._pts.sort((a, b) => a.t - b.t);
      this._draw();
      this._emit();
    }
  }

  _onCtx(e) {
    e.preventDefault();
    const { x, y } = this._rect(e);
    const W = this._canvas.clientWidth, H = this._canvas.clientHeight;
    const near = this._nearestIdx(x, y, W, H);
    if (near >= 0) {
      this._pts.splice(near, 1);
      this._hoverIdx = -1;
      this._dragId = -1;
      this._draw();
      this._emit();
    }
  }

  _hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  _draw() {
    const canvas = this._canvas;
    if (!canvas || !this.isConnected) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const clips = this._racerClips;
    const STRIP = 4, GAP = 1;
    const stripsH = clips.length > 0 ? clips.length * (STRIP + GAP) + 4 : 0;
    const cH = H - stripsH;

    const tx = (t) => this._tx(t, W);
    const sy = (s) => this._sy(s, cH);

    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, 0, W, H);

    if (clips.length > 0) {
      const trackY0 = cH + 4;
      clips.forEach((clip, i) => {
        const y = trackY0 + i * (STRIP + GAP);
        const x1 = tx(clip.start), x2 = tx(clip.end);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, y, W, STRIP);
        ctx.fillStyle = this._hexToRgba(clip.color, 0.75);
        ctx.fillRect(x1, y, Math.max(1, x2 - x1), STRIP);
        ctx.fillStyle = clip.color;
        ctx.font = '7px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(clip.name.slice(0, 12), Math.max(2, x1 + 2), y + STRIP - 0.5);
      });
    }

    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (const gs of this._GRID) {
      const y = sy(gs);
      if (y < 0 || y > cH) continue;
      const is1 = gs === 1;
      ctx.strokeStyle = is1 ? '#383838' : '#1e1e1e';
      ctx.lineWidth = is1 ? 1.5 : 1;
      ctx.setLineDash(is1 ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = is1 ? '#666' : '#3a3a3a';
      ctx.fillText(gs + 'x', 3, y - 2);
    }

    const cx = tx(this._now);
    ctx.strokeStyle = 'rgba(212,175,55,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    ctx.setLineDash([]);

    const pts = this._pts;

    if (pts.length === 0) {
      const y = sy(this._baseSpeed);
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      if (cH > 20) {
        ctx.fillStyle = '#3a3a3a';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Click to add speed keyframes', W / 2, cH / 2 + 4);
      }
      return;
    }

    const firstY = sy(pts[0].s), lastY = sy(pts[pts.length - 1].s);

    ctx.fillStyle = 'rgba(212,175,55,0.07)';
    ctx.beginPath();
    ctx.moveTo(0, cH); ctx.lineTo(0, firstY); ctx.lineTo(tx(pts[0].t), firstY);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i].t), sy(pts[i].s));
    ctx.lineTo(W, lastY); ctx.lineTo(W, cH);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, firstY); ctx.lineTo(tx(pts[0].t), firstY);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i].t), sy(pts[i].s));
    ctx.lineTo(W, lastY);
    ctx.stroke();

    const dragIdx = pts.findIndex(p => p.id === this._dragId);
    for (let i = 0; i < pts.length; i++) {
      const px = tx(pts[i].t), py = sy(pts[i].s);
      const hot = i === this._hoverIdx || i === dragIdx;
      ctx.fillStyle = hot ? '#f0d060' : '#d4af37';
      ctx.strokeStyle = '#0e0e0e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, this._R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (hot) {
        const lbl = pts[i].t.toFixed(1) + 's \xb7 ' + pts[i].s.toFixed(2) + 'x';
        ctx.font = 'bold 10px ui-monospace, monospace';
        const lw = ctx.measureText(lbl).width;
        ctx.fillStyle = '#e8c445'; ctx.textAlign = 'left';
        ctx.fillText(lbl, Math.max(2, Math.min(W - lw - 4, px - lw / 2)), py > cH / 2 ? py - this._R - 4 : py + this._R + 12);
      }
    }
  }
}

customElements.define('speed-curve-editor', SpeedCurveEditor);

// --- Speed curve player integration ---

const speedCurvePanel = document.getElementById('speedCurvePanel');
const speedCurveEditor = document.getElementById('speedCurveEditor');
const speedCurveToggle = document.getElementById('speedCurveToggle');
let scPanelOpen = false;
let scRafRunning = false;

function scGetCurrentElapsed() {
  const d = clipDuration();
  return d > 0 ? (scrubber.value / 1000) * d : 0;
}

function scBuildRacerClips() {
  if (!clipTimes || !activeClip) return [];
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  const base = activeClip.start;
  const result = [];
  for (let i = 0; i < raceVideos.length; i++) {
    if (hiddenRacers.has(i)) continue;
    if (!ct || !isValidClipEntry(ct[i])) continue;
    result.push({
      start: Math.max(0, ct[i].start - base),
      end: ct[i].end - base,
      color: racerColors[i] || '#888',
      name: racerNames[i] || ('Racer ' + (i + 1)),
    });
  }
  return result;
}

function scStartRaf() {
  if (scRafRunning) return;
  scRafRunning = true;
  function tick() {
    if (!scPanelOpen) { scRafRunning = false; return; }
    const elapsed = scGetCurrentElapsed();
    speedCurveEditor.currentTime = elapsed;
    speedCurveEditor.duration = clipDuration();
    const anyPlaying = videos.some(v => v && !v.paused);
    if (anyPlaying && speedCurveEditor.hasPoints) {
      const speed = speedCurveEditor.getSpeedAt(elapsed);
      videos.forEach(v => { if (v) v.playbackRate = speed; });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

if (speedCurveEditor) {
  speedCurveEditor.addEventListener('speedchange', ({ detail }) => {
    if (!detail.hasPoints) {
      const rate = Number.parseFloat(speedSelect.value) || 1;
      videos.forEach(v => { if (v) v.playbackRate = rate; });
    }
  });
}

function toggleSpeedCurve() {
  scPanelOpen = !scPanelOpen;
  if (speedCurvePanel) speedCurvePanel.style.display = scPanelOpen ? 'block' : 'none';
  speedCurveToggle.classList.toggle('active', scPanelOpen);
  if (scPanelOpen) {
    speedCurveEditor.duration = clipDuration();
    speedCurveEditor.currentTime = scGetCurrentElapsed();
    speedCurveEditor.baseSpeed = Number.parseFloat(speedSelect.value) || 1;
    speedCurveEditor.setRacerClips(scBuildRacerClips());
    scStartRaf();
  } else if (!speedCurveEditor.hasPoints) {
    const rate = Number.parseFloat(speedSelect.value) || 1;
    videos.forEach(v => { if (v) v.playbackRate = rate; });
  }
}

if (speedCurveToggle) speedCurveToggle.addEventListener('click', toggleSpeedCurve);
