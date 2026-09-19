/* eslint-env browser */
/**
 * film-export.js — "Download the film" for the condition matrix.
 *
 * Records one video of the whole matrix: for every condition, an info card
 * with that condition's result, then its racers playing side by side. The
 * frames are composited onto a canvas (layout from computeExportLayout, the
 * same math the per-race player exports with) and captured with MediaRecorder,
 * so the download needs no ffmpeg and no server-side work.
 *
 * Runs in the browser, NOT in Node: condition-matrix.js concatenates this file
 * after export-layout.cjs and film-plan.cjs into the page's film IIFE.
 */

const filmConfig = JSON.parse(document.getElementById('film-config')?.textContent || 'null');
const filmBtn = document.getElementById('filmBtn');
const filmOverlay = document.getElementById('filmOverlay');

const FILM_FPS = 30;
const FILM_FILENAME = 'race-film.webm';
// A racer whose video never advances must not wedge the recording: give every
// race this much slack over its expected length, then move on.
const RACE_GRACE_SECONDS = 10;
const LOAD_TIMEOUT_MS = 20000;
const SEEK_TOLERANCE = 0.02;

/** The metric the cards report — whatever the matrix is currently comparing. */
function filmMetricKey() {
  return document.getElementById('metric')?.value || '';
}

/**
 * Resolve a theme token to a real colour. Custom properties are read through a
 * probe element rather than getComputedStyle(:root), so a token defined as
 * var(--color-gold) arrives as a colour the canvas can paint with — and a skin
 * themes the film exactly as it themes the page.
 */
function themeValue(prop, token, fallback) {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style[prop] = `var(${token}, ${fallback})`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe)[prop];
  probe.remove();
  return value || fallback;
}

function readTheme() {
  return {
    // The page's own background for the cards, so text stays legible under any
    // skin; the video letterbox keeps the player's black.
    bg: themeValue('color', '--bg', '#1a1a1a'),
    videoBg: themeValue('color', '--video-bg', '#000'),
    text: themeValue('color', '--text', '#e8e0d0'),
    dim: themeValue('color', '--text-dim', '#999'),
    accent: themeValue('color', '--accent', '#d4af37'),
    ui: themeValue('fontFamily', '--font-ui', 'monospace'),
    display: themeValue('fontFamily', '--font-display', 'Georgia, serif'),
  };
}

// --- Card and frame painting ------------------------------------------------

/** One line of card text, in the font and colour it belongs in. */
function cardLine(ctx, text, x, y, font, color) {
  if (!text) return;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** The info card: which condition is coming up, and how it went. */
function drawCard(ctx, layout, theme, card) {
  const w = layout.canvasW;
  const h = layout.canvasH;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const titleSize = Math.round(w * 0.032);
  const labelSize = Math.round(w * 0.016);
  const rowSize = Math.round(w * 0.021);
  const blockW = Math.min(w * 0.58, 620);
  const left = (w - blockW) / 2;

  ctx.textAlign = 'center';
  let y = Math.round(h * 0.22);
  cardLine(ctx, card.title, w / 2, y, `bold ${titleSize}px ${theme.display}`, theme.accent);
  y += Math.round(titleSize * 0.95);
  cardLine(ctx, card.metricName, w / 2, y, `${labelSize}px ${theme.ui}`, theme.dim);
  y += titleSize;
  cardLine(ctx, card.verdict, w / 2, y, `bold ${rowSize}px ${theme.ui}`, theme.text);

  // Rows share the card's block: name on the left, value and delta right-aligned
  // in their own columns, so the numbers line up the way the matrix cells do.
  const rows = card.rows;
  const lineH = Math.min(Math.round(rowSize * 1.7), Math.max(1, Math.round((h * 0.86 - y) / Math.max(rows.length, 1))));
  y += Math.round(lineH * 1.2);
  for (const row of rows) {
    ctx.font = `${row.win ? 'bold ' : ''}${rowSize}px ${theme.ui}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = row.color || theme.text;
    ctx.fillText(row.name, left, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = row.win ? theme.text : theme.dim;
    ctx.fillText(row.value, left + blockW * 0.72, y);
    ctx.fillStyle = theme.dim;
    ctx.fillText(row.delta, left + blockW, y);
    y += lineH;
  }

  ctx.textAlign = 'center';
  cardLine(ctx, card.footer, w / 2, Math.round(h * 0.94), `${labelSize}px ${theme.ui}`, theme.dim);
}

/** A boxed line of text — the clock and the condition caption both use it. */
function drawPlate(ctx, theme, text, x, y, align, size) {
  ctx.font = `bold ${size}px ${theme.ui}`;
  ctx.textAlign = align;
  const width = ctx.measureText(text).width;
  const pad = 4;
  const boxX = align === 'center' ? x - width / 2 : x;
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(boxX - pad, y - size, width + pad * 2, size + pad * 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.text;
  ctx.fillText(text, x, y);
}

function formatClock(seconds) {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** One frame of a race: every racer in its slot, plus the caption and clock. */
function drawRaceFrame(ctx, layout, theme, loaded, elapsed) {
  ctx.fillStyle = theme.videoBg;
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

  loaded.videos.forEach((video, i) => {
    const pos = layout.positions[i];
    if (!video || !pos) return;
    const racer = loaded.condition.racers[i];
    ctx.fillStyle = racer.color || theme.text;
    ctx.font = `bold 16px ${theme.display}`;
    ctx.textAlign = 'center';
    ctx.fillText(racer.name || '', pos.x + layout.targetW / 2, pos.y + layout.labelH - 8);
    try {
      ctx.drawImage(video, pos.x, pos.y + layout.labelH, layout.targetW, layout.cellH);
    } catch { /* a frame that is not decodable yet simply stays black */ }
  });

  const plateSize = 18;
  drawPlate(ctx, theme, loaded.condition.title, 12, layout.canvasH - 12, 'left', plateSize);
  drawPlate(ctx, theme, formatClock(elapsed), layout.canvasW / 2, layout.canvasH - 12, 'center', plateSize);
}

// --- Loading one condition's recordings -------------------------------------

/**
 * Wait until `ready()` holds, re-checking it whenever one of `events` fires.
 * Always settles: a recording that never gets there is dropped by the caller
 * rather than hanging the film.
 */
function waitFor(video, events, ready) {
  return new Promise(resolve => {
    if (ready()) return resolve();
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      events.forEach(name => video.removeEventListener(name, check));
      resolve();
    };
    const check = () => { if (ready()) done(); };
    events.forEach(name => video.addEventListener(name, check));
    timer = setTimeout(done, LOAD_TIMEOUT_MS);
  });
}

/**
 * Chrome reports duration = Infinity for a WebM with no Duration element in its
 * header — which is every Playwright recording. Seeking far past the end makes
 * it scan the file and report the real value, the same trick the player runtime
 * uses (forceDurationScan in player-runtime/playback.js). Without it a
 * recording that carries no clip times (they were trimmed by --ffmpeg) has no
 * end to play to.
 */
function ensureFiniteDuration(video) {
  const settled = () => Number.isFinite(video.duration) || !!video.error;
  if (settled()) return Promise.resolve();
  const scanned = waitFor(video, ['durationchange', 'error'], settled);
  video.currentTime = 1e10;
  return scanned;
}

/** A recording is usable once it has data to draw and an end to play to. */
function isPlayable(video) {
  return video.readyState >= 2 && Number.isFinite(video.duration);
}

/**
 * Load one condition's recordings and park each at the start of its race.
 * A recording that fails to load is dropped rather than failing the film.
 */
async function loadCondition(condition) {
  const videos = condition.racers.map(racer => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = racer.src;
    return video;
  });

  await Promise.all(videos.map(v => waitFor(v, ['loadeddata', 'error'], () => v.readyState >= 2 || !!v.error)));
  await Promise.all(videos.filter(v => v.readyState >= 2).map(ensureFiniteDuration));

  const playable = [], windows = [], racers = [];
  videos.forEach((video, i) => {
    if (!isPlayable(video)) {
      video.removeAttribute('src');
      return;
    }
    playable.push(video);
    racers.push(condition.racers[i]);
    windows.push(filmClipWindow(condition.racers[i].clip, video.duration));
  });

  await Promise.all(playable.map((video, i) => {
    const target = windows[i].start;
    if (Math.abs(video.currentTime - target) < SEEK_TOLERANCE) return Promise.resolve();
    const seeked = waitFor(video, ['seeked', 'error'], () => Math.abs(video.currentTime - target) < SEEK_TOLERANCE || !!video.error);
    video.currentTime = target;
    return seeked;
  }));

  return { condition: { ...condition, racers }, videos: playable, windows };
}

function disposeCondition(loaded) {
  if (!loaded) return;
  for (const video of loaded.videos) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

// --- Recording the film -----------------------------------------------------

/**
 * Drive a phase of the film frame by frame. `onFrame(elapsedSeconds)` paints;
 * returning true from `isDone` ends the phase. Every frame is repainted even
 * when nothing moved, so the captured stream keeps ticking during a card.
 */
function runPhase(state, onFrame, isDone) {
  return new Promise(resolve => {
    const started = performance.now();
    const step = () => {
      const elapsed = (performance.now() - started) / 1000;
      if (state.cancelled) return resolve();
      // A frame that cannot be painted (a decoder hiccup, say) must not end the
      // phase: the previous frame simply stands until the next one works.
      try { onFrame(elapsed); } catch (err) { console.warn('film frame:', err.message); }
      if (isDone(elapsed)) return resolve();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function raceElapsed(loaded) {
  let elapsed = 0;
  loaded.videos.forEach((video, i) => {
    elapsed = Math.max(elapsed, (video.currentTime || 0) - loaded.windows[i].start);
  });
  return elapsed;
}

function raceFinished(loaded, elapsed) {
  const longest = loaded.windows.reduce((most, w) => Math.max(most, w.end - w.start), 0);
  if (elapsed > longest + RACE_GRACE_SECONDS) return true; // a stalled recording must not wedge the film
  return loaded.videos.every((video, i) => video.ended || video.currentTime >= loaded.windows[i].end - SEEK_TOLERANCE);
}

async function recordFilm(plan, ui, state) {
  const theme = readTheme();
  ui.status('Loading recordings…');
  let loaded = await loadCondition(plan.conditions[0]);
  if (state.cancelled) return null;

  const sample = loaded.videos.find(v => v.videoWidth);
  const aspect = sample ? sample.videoHeight / sample.videoWidth : 9 / 16;
  const layout = computeExportLayout(plan.maxRacers, aspect);
  ui.canvas.width = layout.canvasW;
  ui.canvas.height = layout.canvasH;
  const ctx = ui.canvas.getContext('2d');

  const stream = ui.canvas.captureStream(FILM_FPS);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  state.recorder = recorder;
  recorder.start();

  try {
    loaded = await recordConditions(plan, ui, state, { ctx, layout, theme, loaded });
  } finally {
    // However this ends — done, cancelled or thrown — the recorder must not be
    // left running against a canvas nobody paints any more.
    if (recorder.state !== 'inactive') recorder.stop();
  }
  await stopped;
  disposeCondition(loaded);
  if (state.cancelled) return null;
  return new Blob(chunks, { type: mimeType });
}

/** Hold one info card on screen for its beat. */
function showCard(state, frame, card) {
  return runPhase(
    state,
    () => drawCard(frame.ctx, frame.layout, frame.theme, card),
    elapsed => elapsed >= CARD_SECONDS
  );
}

/** Play one condition's recordings through to the end of their race. */
async function playRace(state, frame, loaded) {
  loaded.videos.forEach(video => { video.play().catch(() => {}); });
  await runPhase(
    state,
    () => drawRaceFrame(frame.ctx, frame.layout, frame.theme, loaded, raceElapsed(loaded)),
    elapsed => raceFinished(loaded, elapsed)
  );
  loaded.videos.forEach(video => video.pause());
}

/**
 * Walk the plan: card, race, card, race… Returns whatever condition is still
 * loaded at the end so the caller can dispose of it.
 */
async function recordConditions(plan, ui, state, frame) {
  const total = plan.conditions.length;
  let pending = frame.loaded;
  for (let i = 0; i < total && !state.cancelled; i++) {
    const loaded = pending;
    if (!loaded) break; // nothing left to play — the plan and the loads disagree
    const condition = plan.conditions[i];
    // Load the next condition while this one's card is on screen, so the film
    // runs on from race to race instead of freezing between them.
    const nextLoad = i + 1 < total ? loadCondition(plan.conditions[i + 1]) : null;

    ui.status(`Card ${i + 1} of ${total}: ${condition.title}`);
    ui.progress((i + 0.15) / total);
    await showCard(state, frame, condition.card);

    ui.status(`Race ${i + 1} of ${total}: ${condition.title}`);
    await playRace(state, frame, loaded);
    ui.progress((i + 1) / total);

    disposeCondition(loaded);
    pending = nextLoad ? await nextLoad : null;
  }
  return pending;
}

// --- Overlay wiring ---------------------------------------------------------

/**
 * One part of the overlay, which the build-film fragment always ships together
 * with the button. Missing means the markup and this runtime have drifted —
 * worth failing loudly rather than throwing further down on null.
 */
function overlayPart(selector) {
  const part = filmOverlay.querySelector(selector);
  if (!part) throw new Error(`the film overlay has no ${selector}`);
  return part;
}

function openFilmOverlay(state) {
  const canvas = overlayPart('.film-canvas');
  const statusEl = overlayPart('.film-status');
  const fill = overlayPart('.film-progress-fill');
  const actions = overlayPart('.film-actions');
  const cancelBtn = overlayPart('.film-cancel');

  const close = () => {
    state.cancelled = true;
    if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    filmOverlay.hidden = true;
  };
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = close;
  actions.replaceChildren(cancelBtn);
  fill.style.width = '0%';
  filmOverlay.hidden = false;

  return {
    canvas,
    close,
    status: text => { statusEl.textContent = text; },
    progress: value => { fill.style.width = `${Math.min(100, Math.max(0, value * 100)).toFixed(1)}%`; },
    finish: (blob) => {
      state.url = URL.createObjectURL(blob);
      statusEl.textContent = `Film ready — ${(blob.size / (1024 * 1024)).toFixed(1)} MB`;
      fill.style.width = '100%';
      const link = document.createElement('a');
      link.href = state.url;
      link.download = FILM_FILENAME;
      link.textContent = 'Download film';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close';
      closeBtn.onclick = close;
      actions.replaceChildren(link, closeBtn);
    },
    fail: message => {
      statusEl.textContent = message;
      cancelBtn.textContent = 'Close';
    },
  };
}

async function startFilm() {
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
    alert('The film needs a browser with Canvas.captureStream and MediaRecorder (Chrome, Firefox or Edge).');
    return;
  }
  if (location.protocol === 'file:') {
    // A file:// video taints the canvas, and captureStream then refuses to run.
    alert('Serve these results over HTTP to record the film — the race server does that by default, or run e.g. npx serve in this folder.');
    return;
  }
  const plan = buildFilmPlan(filmConfig, filmMetricKey());
  if (plan.conditions.length === 0) {
    alert('No recordings to assemble — this race was run without video.');
    return;
  }

  const state = { cancelled: false, recorder: null, url: null };
  const ui = openFilmOverlay(state);
  filmBtn.disabled = true;
  try {
    const blob = await recordFilm(plan, ui, state);
    if (blob) ui.finish(blob);
  } catch (err) {
    ui.fail(`Could not record the film: ${err.message}`);
  } finally {
    filmBtn.disabled = false;
  }
}

if (filmBtn && filmOverlay && filmConfig) {
  // The listener itself stays synchronous: handing addEventListener an async
  // function would let a rejection escape as an unhandled rejection instead of
  // reaching anything that can report it.
  filmBtn.addEventListener('click', () => {
    startFilm().catch(err => { console.error('film:', err); });
  });
}
