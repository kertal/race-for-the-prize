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
    faint: themeValue('color', '--text-ghost', '#666'),
    accent: themeValue('color', '--accent', '#d4af37'),
    track: themeValue('color', '--surface-raised', '#3a3a3a'),
    rule: themeValue('color', '--border-subtle', '#333'),
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

/**
 * The type scale and the column grid of one card, derived from the frame it
 * has to fill: the same card has to read on a squat two-racer frame and on a
 * tall six-racer one, so everything is sized off both dimensions.
 */
function cardMetrics(layout, rowCount) {
  const w = layout.canvasW;
  const h = layout.canvasH;
  // Both dimensions get a say: a wide, short frame (two 16:9 racers) must not
  // grow type it has no room for, and a narrow, tall one (four racers stacked)
  // must not leave the card marooned in the middle of the picture.
  const scale = Math.max(0.75, Math.min(1.8, Math.min(w / 1100, h / 520)));
  const title = Math.round(38 * scale);
  const label = Math.round(17 * scale);
  const row = Math.round(22 * scale);
  // Vertical rhythm, top to bottom: title baseline, subtitle baseline, the
  // rule, then one line per row. blockH is the sum, so centring stays honest.
  const subtitleGap = Math.round(label * 2.1);
  const ruleGap = Math.round(row * 0.9);
  const lineH = Math.round(row * 1.55);

  const blockW = Math.min(Math.round(w * 0.72), Math.round(860 * scale));
  const gap = Math.round(row * 0.6);
  const left = Math.round((w - blockW) / 2);
  // Columns are sized in characters of the monospace UI face: a medal, a name,
  // the bar taking what is left, then the value and the delta right-aligned.
  const medalW = Math.round(row * 1.4);
  const nameW = Math.round(row * 6.6);
  const valueW = Math.round(row * 4.6);
  const deltaW = Math.round(row * 4.6);
  const barX = left + medalW + gap + nameW + gap;
  const valueRight = left + blockW - deltaW - gap;

  return {
    w, h, left, blockW, title, label, row, subtitleGap, ruleGap, lineH, nameW,
    blockH: title + subtitleGap + ruleGap + rowCount * lineH,
    medalX: left,
    nameX: left + medalW + gap,
    barX,
    barW: valueRight - valueW - gap - barX,
    valueRight,
    deltaRight: left + blockW,
  };
}

/** Trim a name to the width its column allows, with an ellipsis when it must. */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** One racer's bar, on the matrix's own scale: full strength for the winner. */
function drawCardBar(ctx, theme, m, row, y) {
  if (m.barW < m.row) return; // no room for a bar worth drawing
  const height = Math.max(3, Math.round(m.row * 0.3));
  const top = y - Math.round(m.row * 0.32);
  ctx.fillStyle = theme.track;
  ctx.fillRect(m.barX, top, m.barW, height);
  if (!Number.isFinite(row.fraction) || row.fraction <= 0) return;
  ctx.globalAlpha = row.win ? 1 : 0.5;
  ctx.fillStyle = row.color || theme.accent;
  ctx.fillRect(m.barX, top, Math.max(2, Math.round(m.barW * row.fraction)), height);
  ctx.globalAlpha = 1;
}

/** One row of the field: medal, racer, bar, value, delta. */
function drawCardRow(ctx, theme, m, row, y) {
  ctx.font = `${row.win ? 'bold ' : ''}${m.row}px ${theme.ui}`;
  ctx.textAlign = 'left';
  if (row.medal) {
    ctx.fillStyle = theme.text;
    ctx.fillText(row.medal, m.medalX, y);
  }
  ctx.fillStyle = row.color || theme.text;
  ctx.fillText(fitText(ctx, row.name, m.nameW), m.nameX, y);

  drawCardBar(ctx, theme, m, row, y);

  ctx.textAlign = 'right';
  ctx.fillStyle = row.win ? theme.text : theme.dim;
  ctx.fillText(row.value, m.valueRight, y);
  ctx.fillStyle = theme.faint;
  ctx.fillText(row.delta, m.deltaRight, y);
}

/**
 * The info card: which condition is coming up, and how it went. The whole
 * block — title, subtitle, field — is centred in the frame, so a two-racer
 * card doesn't sit in the top third of the picture with dead space below it.
 */
function drawCard(ctx, layout, theme, card) {
  const m = cardMetrics(layout, card.rows.length);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, m.w, m.h);

  let y = Math.round((m.h - m.blockH) / 2) + m.title;
  ctx.textAlign = 'center';
  cardLine(ctx, card.title, m.w / 2, y, `bold ${m.title}px ${theme.display}`, theme.accent);
  y += m.subtitleGap;
  cardLine(ctx, card.subtitle, m.w / 2, y, `${m.label}px ${theme.ui}`, theme.dim);

  // A hairline under the header, the same separator the matrix cells draw
  // between their verdict and their times.
  y += m.ruleGap;
  ctx.fillStyle = theme.rule;
  ctx.fillRect(m.left, y, m.blockW, 1);

  y += m.lineH;
  for (const row of card.rows) {
    drawCardRow(ctx, theme, m, row, y);
    y += m.lineH;
  }

  ctx.textAlign = 'center';
  cardLine(ctx, card.footer, m.w / 2, m.h - Math.round(m.label * 1.4), `${m.label}px ${theme.ui}`, theme.faint);
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

/** mm:ss.mmm — a race is seconds long, so hours would only be noise. */
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
    if (!pos) return; // more racers than the layout has slots for
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

/**
 * A load that a cancel must never wait for. Resolves to the loaded condition,
 * or to null the moment the film is cancelled — a slow or broken recording
 * would otherwise hold the Cancel button hostage for the whole load timeout.
 * Whatever the abandoned load eventually produces is disposed behind it.
 */
function loadUnlessCancelled(state, loading) {
  const abandoned = state.whenCancelled.then(() => {
    loading.then(disposeCondition).catch(() => {});
    return null;
  });
  return Promise.race([loading, abandoned]);
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

/** How far into the race the field is: the furthest any racer has got. */
function raceElapsed(loaded) {
  return loaded.videos.reduce((most, video, i) => Math.max(most, video.currentTime - loaded.windows[i].start), 0);
}

/** Every racer has reached the end of its window — or the race has overrun its grace. */
function raceFinished(loaded, elapsed) {
  const longest = loaded.windows.reduce((most, w) => Math.max(most, w.end - w.start), 0);
  if (elapsed > longest + RACE_GRACE_SECONDS) return true; // a stalled recording must not wedge the film
  return loaded.videos.every((video, i) => video.ended || video.currentTime >= loaded.windows[i].end - SEEK_TOLERANCE);
}

async function recordFilm(plan, ui, state) {
  const theme = readTheme();
  ui.status('Loading recordings…');
  let loaded = await loadUnlessCancelled(state, loadCondition(plan.conditions[0]));
  if (!loaded || state.cancelled) {
    disposeCondition(loaded);
    return null;
  }

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
    const nextLoad = i + 1 < total
      ? loadUnlessCancelled(state, loadCondition(plan.conditions[i + 1]))
      : Promise.resolve(null);

    ui.status(`Card ${i + 1} of ${total}: ${condition.title}`);
    ui.progress((i + 0.15) / total);
    await showCard(state, frame, condition.card);

    ui.status(`Race ${i + 1} of ${total}: ${condition.title}`);
    await playRace(state, frame, loaded);
    ui.progress((i + 1) / total);

    disposeCondition(loaded);
    pending = await nextLoad;
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
    state.cancel();
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

  // `cancelled` is for code that polls; `whenCancelled` for code that waits.
  const state = { cancelled: false, recorder: null, url: null, cancel: null, whenCancelled: null };
  state.whenCancelled = new Promise(resolve => { state.cancel = resolve; });
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
