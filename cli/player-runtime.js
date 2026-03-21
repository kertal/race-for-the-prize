/* eslint-env browser */
/**
 * player-runtime.js — Browser-side video player logic.
 *
 * This file is read at build time by videoplayer.js and injected into the
 * generated HTML via {{placeholder}} replacement. It runs in the browser,
 * NOT in Node.js. The {{…}} tokens are replaced with JSON-serialized config
 * before the HTML is written to disk.
 */

// --- Config injected at build time ---
{{videoVars}}
const raceVideos = {{videoArray}};
const raceVideoPaths = {{raceVideoPaths}};
const fullVideoPaths = {{fullVideoPaths}};
const clipTimes = {{clipTimesJson}};
const racerNames = {{racerNamesJson}};
const racerColors = {{racerColorsJson}};
const mergedVideo = document.getElementById('mergedVideo');
const playerContainer = document.getElementById('playerContainer');
const mergedContainer = document.getElementById('mergedContainer');

// Mutable resolved paths — data URIs replaced with seekable Blob URLs on init
let resolvedRacePaths = raceVideoPaths ? raceVideoPaths.slice() : raceVideoPaths;
let resolvedFullPaths = fullVideoPaths ? fullVideoPaths.slice() : fullVideoPaths;

(async function resolveEmbeddedVideos() {
  async function toBlobUrl(p) {
    if (!p || !p.startsWith('data:')) return p;
    return URL.createObjectURL(await fetch(p).then(r => r.blob()));
  }
  const hasData = arr => arr && arr.some(p => p && p.startsWith('data:'));
  const mergedSrc = mergedVideo && mergedVideo.getAttribute('src');
  const mergedIsData = mergedSrc && mergedSrc.startsWith('data:');
  if (!hasData(raceVideoPaths) && !hasData(fullVideoPaths) && !mergedIsData) return;
  [resolvedRacePaths, resolvedFullPaths] = await Promise.all([
    raceVideoPaths ? Promise.all(raceVideoPaths.map(toBlobUrl)) : Promise.resolve(raceVideoPaths),
    fullVideoPaths ? Promise.all(fullVideoPaths.map(toBlobUrl)) : Promise.resolve(fullVideoPaths),
  ]);
  raceVideos.forEach((v, i) => { if (resolvedRacePaths[i]) v.src = resolvedRacePaths[i]; });
  if (mergedIsData) mergedVideo.src = await toBlobUrl(mergedSrc);
})();

// Convert a Blob to a base64 data URI (used when embedding videos in ZIP export)
async function blobToDataUri(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${blob.type};base64,${btoa(binary)}`;
}

let videos = raceVideos;
let primary = videos[0];
const playBtn = document.getElementById('playBtn');
const scrubber = document.getElementById('scrubber');
const timeDisplay = document.getElementById('timeDisplay');
const frameDisplay = document.getElementById('frameDisplay');
const speedSelect = document.getElementById('speedSelect');

function setPlayState(isPlaying) {
  playBtn.textContent = isPlaying ? '\u23F8' : '\u25B6';
  playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
}

let playing = false;
let duration = 0;
let activeClip = null;
let activeSegmentClipTimes = null;
let activeSegmentName = null;
let segmentNavBuilt = false;
const hiddenRacers = new Set();
const STEP = 0.1;
let loadedSrcSet = 'race';
let pendingSeek = null;
let calibrationFatalError = null;

function failCalibration(msg) {
  if (calibrationFatalError) return;
  calibrationFatalError = msg;
  if (timeDisplay) timeDisplay.textContent = msg;
  if (frameDisplay) frameDisplay.textContent = 'manual calibration required';
  if (playBtn) playBtn.disabled = true;
  if (scrubber) scrubber.disabled = true;
  // Log to console rather than throwing: this function is called from event
  // listeners (loadedmetadata, durationchange) where an uncaught throw would
  // surface as an unhandled exception without providing any extra information.
  console.error('[player] calibration failed:', msg);
}

function applyCalibrationToClip(ct, ptsStart, videoDuration) {
  const segDuration = ct._wcEnd - ct._wcStart;
  ct.calibratedStart = ptsStart;
  ct.calibratedEnd = ptsStart + segDuration;
  ct._ptsScale = null;
  ct.start = ptsStart;
  ct.end = isFinite(videoDuration) ? Math.min(ptsStart + segDuration, videoDuration) : ptsStart + segDuration;
  ct._converted = true;
}

// --- Formatting helpers ---

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return m + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
}

function getTime(t) {
  return t.toFixed(1) + 's';
}

// --- Clip helpers ---

function clipOffset() {
  return activeClip ? activeClip.start : 0;
}

function clipDuration() {
  return activeClip ? (activeClip.end - activeClip.start) : duration;
}

function updateTimeDisplay() {
  const d = clipDuration();
  const t = d > 0 ? (scrubber.value / 1000) * d : 0;
  timeDisplay.textContent = fmt(Math.max(0, t)) + ' / ' + fmt(d);
  frameDisplay.textContent = getTime(Math.max(0, t));
}

function isValidClipEntry(c) {
  return c != null && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start <= c.end;
}

function hasTraceCalibration(ct) {
  return !!(ct && ct.traceCalibration && Number.isFinite(ct.traceCalibration.recordingStartTs));
}

function canApplyTraceCalibration(ct) {
  return hasTraceCalibration(ct) && Number.isFinite(ct.traceCalibration.firstFrameTs);
}

const US_PER_SECOND = 1e6; // trace timestamps are in microseconds

function traceTsToClipPts(ct, traceTs) {
  if (!hasTraceCalibration(ct) || !Number.isFinite(traceTs)) return null;
  // Video PTS is measured from firstFrameTs (the first captured frame = PTS 0).
  // Using recordingStartTs as the base would give time-since-recording-started,
  // which is ct.start seconds too early once applyCalibrationToClip has set
  // ct.start = (recordingStartTs - firstFrameTs) / US_PER_SECOND.
  return (traceTs - ct.traceCalibration.firstFrameTs) / US_PER_SECOND;
}

function seekAll(t) {
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  videos.forEach((v, i) => {
    if (!v) return;
    let target = t;
    if (activeClip && ct && isValidClipEntry(ct[i])) {
      const elapsed = t - activeClip.start;
      target = ct[i].start + elapsed;
      target = Math.max(ct[i].start, Math.min(ct[i].end, target));
    }
    v.currentTime = Math.min(target, v.duration || target);
  });
  updateFramePositions();
}

// --- Metadata & calibration ---

// Chrome reports video.duration = Infinity for WebM files without a Duration
// element in the container header (all Playwright recordings). Seeking requires
// a finite duration. The fix: seek to 1e10 which forces Chrome to scan to the
// end of the file, after which it fires durationchange with the real value.
// _durationForced maps each video element to the src key for which the 1e10
// seek was already triggered. Keyed by src (not element) so that switching
// sources (e.g. race clip → full recording) re-triggers the scan if needed.
const _durationForced = new WeakMap();

function onMeta() {
  if (calibrationFatalError) return;

  // Block calibration until every video has a finite duration.
  // readyState >= 1 (HAVE_METADATA) means the duration field is populated.
  // We must check ALL videos before proceeding: a second loadedmetadata
  // listener must not race ahead and run calibration while the 1e10 seek for
  // another video is still in progress.
  // Note: runs unconditionally (not gated on clipTimes) so full-recording
  // pages also get finite durations before any seek/UI is attempted.
  for (const v of videos) {
    if (!v || v.readyState < 1) continue; // readyState 1 = HAVE_METADATA
    if (!isFinite(v.duration)) {
      const srcKey = v.currentSrc || v.src || '';
      if (_durationForced.get(v) !== srcKey) {
        _durationForced.set(v, srcKey);
        v.addEventListener('durationchange', onMeta, { once: true });
        v.currentTime = 1e10; // seek past end → Chrome scans file → durationchange fires
      }
      return; // always wait — do not proceed until durationchange fires
    }
  }

  duration = Math.max(...videos.filter(v => v).map(v => v.duration || 0));
  let convertedAny = false;
  if (clipTimes) {
    for (let i = 0; i < clipTimes.length; i++) {
      if (!isValidClipEntry(clipTimes[i]) || !videos[i] || (videos[i].readyState < 1)) continue;
      const clipEntry = clipTimes[i];
      if (clipEntry._converted) continue;
      // _converted is always false here (the guard above skips converted entries),
      // but we capture it before mutating so the convertedAny check below is explicit.
      const wasConverted = !!clipEntry._converted;
      if (clipEntry._wcStart == null) { clipEntry._wcStart = clipEntry.start; clipEntry._wcEnd = clipEntry.end; }
      if (!canApplyTraceCalibration(clipEntry)) {
        failCalibration('Calibration error: missing trace calibration metadata. Please calibrate manually.');
        return;
      }
      // recordingStartTs − firstFrameTs gives the PTS offset (µs) where recording
      // started relative to the first captured frame; divide to get seconds.
      const tracePtsStart = (clipEntry.traceCalibration.recordingStartTs - clipEntry.traceCalibration.firstFrameTs) / US_PER_SECOND;
      if (!Number.isFinite(tracePtsStart) || tracePtsStart < 0) {
        failCalibration('Calibration error: invalid trace timestamps. Please calibrate manually.');
        return;
      }
      applyCalibrationToClip(clipEntry, tracePtsStart, videos[i].duration);
      if (!wasConverted && clipEntry._converted) convertedAny = true;
    }
  }
  activeClip = resolveAdjustedClip();
  buildSegmentNav();
  updateTimeDisplay();
  updateDebugStats();

  if (pendingSeek && videos.every(v => !v || v.readyState >= 1)) {
    const fn = pendingSeek;
    pendingSeek = null;
    fn();
  } else if (convertedAny && !playing && videos.every(v => !v || v.readyState >= 1)) {
    // If conversion landed after the initial seek was already consumed,
    // force one seek to the actual clip start to avoid stale startup frame.
    // Guard: all videos must be at HAVE_METADATA (readyState >= 1) before
    // seeking — calling seekAllWithVerify while another video is still at
    // readyState 0 seeds seeked/canplay listeners with stale clip positions.
    seekAllWithVerify(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
    updateTimeDisplay();
  }

}

// --- Playback event handlers ---

function onTimeUpdate() {
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  let elapsed = 0;
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (!v) continue;
    const vidClip = activeClip && ct && isValidClipEntry(ct[i]) ? ct[i] : null;
    if (vidClip && v.currentTime > vidClip.end) {
      v.currentTime = vidClip.end;
      v.pause();
    }
    const clamped = vidClip ? Math.min(v.currentTime, vidClip.end) : v.currentTime;
    const e = vidClip ? (clamped - vidClip.start) : (clamped - clipOffset());
    if (e > elapsed) elapsed = e;
  }
  if (activeClip && elapsed >= clipDuration()) {
    videos.forEach(v => v?.pause());
    seekAll(activeClip.end);
    playing = false;
    setPlayState(false);
    scrubber.value = 1000;
    updateTimeDisplay();
    return;
  }
  if (duration > 0) {
    const d = clipDuration();
    scrubber.value = d > 0 ? (Math.max(0, elapsed) / d) * 1000 : 0;
    updateTimeDisplay();
    updateFramePositions();
  }
}

function onEnded() {
  if (videos.every(vi => !vi || vi.paused || vi.ended)) {
    playing = false;
    setPlayState(false);
  }
}

// --- Listener management ---

function detachVideoListeners() {
  raceVideos.forEach(v => {
    if (v) {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('ended', onEnded);
    }
  });
  if (mergedVideo) {
    mergedVideo.removeEventListener('loadedmetadata', onMeta);
    mergedVideo.removeEventListener('timeupdate', onTimeUpdate);
    mergedVideo.removeEventListener('ended', onEnded);
  }
}

function attachVideoListeners() {
  videos.forEach(v => {
    if (v) {
      v.addEventListener('loadedmetadata', onMeta);
      v.addEventListener('timeupdate', onTimeUpdate);
      v.addEventListener('ended', onEnded);
    }
  });
}

attachVideoListeners();

// --- Mode switching ---

const modeRace = document.getElementById('modeRace');
const modeFull = document.getElementById('modeFull');
const modeMerged = document.getElementById('modeMerged');
const modeDebug = document.getElementById('modeDebug');
const debugPanel = document.getElementById('debugPanel');
const segmentNav = document.getElementById('segmentNav');

function setActiveMode(btn) {
  [modeRace, modeFull, modeMerged].forEach(b => b?.classList.remove('active'));
  btn?.classList.add('active');
}

function resolveClip() {
  if (!clipTimes) return null;
  let minStart = Infinity, maxDuration = 0, found = false;
  for (let i = 0; i < clipTimes.length; i++) {
    if (hiddenRacers.has(i)) continue;
    if (isValidClipEntry(clipTimes[i])) {
      minStart = Math.min(minStart, clipTimes[i].start);
      maxDuration = Math.max(maxDuration, clipTimes[i].end - clipTimes[i].start);
      found = true;
    }
  }
  return found ? { start: minStart, end: minStart + maxDuration } : null;
}

function switchMode(targetSrcSet, targetVideos, modeBtn, opts) {
  pendingSeek = null;
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
  detachVideoListeners();
  const srcChanged = loadedSrcSet !== targetSrcSet;
  if (srcChanged && opts.loadSrc) opts.loadSrc();
  if (targetSrcSet) loadedSrcSet = targetSrcSet;
  videos = targetVideos;
  primary = videos[0];
  attachVideoListeners();
  if (opts.onActivate) opts.onActivate();
  setActiveMode(modeBtn);
  if (srcChanged) {
    duration = 0;
    pendingSeek = opts.doSeek;
  } else {
    onMeta();
    opts.doSeek();
  }
}

function hideCalibration() {
  if (debugPanel) debugPanel.style.display = 'none';
  if (modeDebug) { modeDebug.classList.remove('active'); modeDebug.style.display = 'none'; }
}

function showCalibrationBtn() {
  if (modeDebug) modeDebug.style.display = '';
}

function resetSegmentState({ hide = false } = {}) {
  activeSegmentName = null;
  activeSegmentClipTimes = null;
  if (!segmentNav) return;
  segmentNav.querySelectorAll('.segment-btn').forEach((b) => {
    b.classList.remove('active');
  });
  const allBtn = segmentNav.querySelector('.segment-btn[data-segment="__all__"]');
  if (allBtn) allBtn.classList.add('active');
  segmentNav.style.display = hide ? 'none' : (segmentNavBuilt ? 'flex' : 'none');
}

function switchToRace() {
  switchMode('race', raceVideos, modeRace, {
    loadSrc() { raceVideos.forEach((v, i) => { v.src = resolvedRacePaths[i]; }); },
    onActivate() {
      playerContainer.style.display = 'flex';
      if (mergedContainer) mergedContainer.style.display = 'none';
      hideCalibration();
      showCalibrationBtn();
      resetSegmentState({ hide: false });
    },
    doSeek() {
      activeClip = resolveAdjustedClip();
      seekAll(activeClip ? activeClip.start : 0);
      scrubber.value = 0;
      updateTimeDisplay();
    }
  });
}

function switchToFull() {
  if (!fullVideoPaths && !clipTimes) return;
  const needsSrcSwitch = fullVideoPaths && loadedSrcSet !== 'full';
  switchMode(needsSrcSwitch ? 'full' : loadedSrcSet, raceVideos, modeFull, {
    loadSrc: needsSrcSwitch ? () => { raceVideos.forEach((v, i) => { v.src = resolvedFullPaths[i]; }); } : null,
    onActivate() {
      playerContainer.style.display = 'flex';
      if (mergedContainer) mergedContainer.style.display = 'none';
      hideCalibration();
      resetSegmentState({ hide: true });
    },
    doSeek() {
      activeClip = null;
      seekAll(0);
      scrubber.value = 0;
      updateTimeDisplay();
    }
  });
}

function switchToMerged() {
  if (!mergedVideo) return;
  switchMode(null, [mergedVideo], modeMerged, {
    onActivate() {
      playerContainer.style.display = 'none';
      mergedContainer.style.display = 'block';
      hideCalibration();
      resetSegmentState({ hide: true });
      activeClip = null;
      duration = mergedVideo.duration || 0;
    },
    doSeek() {
      seekAll(0);
      scrubber.value = 0;
      updateTimeDisplay();
    }
  });
}

function toggleCalibration() {
  if (!debugPanel) return;
  const visible = debugPanel.style.display === 'block';
  debugPanel.style.display = visible ? 'none' : 'block';
  modeDebug?.classList.toggle('active', !visible);
  if (!visible) {
    updateDebugDisplay();
    updateDebugStats();
    updateFramePositions();
  }
}

// --- Debug panel: video stats ---

function clearRowKeepName(row) {
  const nameSpan = row.querySelector('.racer-name');
  const saved = nameSpan ? nameSpan.cloneNode(true) : null;
  row.textContent = '';
  if (saved) row.appendChild(saved);
}

function appendSpan(parent, text) {
  const s = document.createElement('span');
  s.textContent = text;
  parent.appendChild(s);
}

function updateDebugStats() {
  const statsEl = document.getElementById('debugStats');
  if (!statsEl || statsEl.offsetParent === null) return;
  const adjusted = getAdjustedClipTimes();
  for (let i = 0; i < raceVideos.length; i++) {
    const row = document.getElementById('debugStatsRow' + i);
    if (!row) continue;
    const v = raceVideos[i];
    if (!v || !v.duration) continue;
    const dur = v.duration.toFixed(2) + 's';
    const res = v.videoWidth + 'x' + v.videoHeight;
    let framesText = '\u2014';
    let droppedText = '\u2014';
    if (typeof v.getVideoPlaybackQuality === 'function') {
      const q = v.getVideoPlaybackQuality();
      framesText = String(q.totalVideoFrames);
      droppedText = String(q.droppedVideoFrames);
    }
    let clipDur = '';
    const activeCt = adjusted ? adjusted[i] : (clipTimes ? clipTimes[i] : null);
    if (activeCt) {
      clipDur = ' (clip: ' + (activeCt.end - activeCt.start).toFixed(2) + 's)';
    }
    clearRowKeepName(row);
    appendSpan(row, 'duration: ' + dur + clipDur);
    appendSpan(row, 'frames: ' + framesText + ' dropped: ' + droppedText);
    appendSpan(row, 'resolution: ' + res);
  }
  // TIMING EVENTS
  for (let i = 0; i < raceVideos.length; i++) {
    const eventsEl = document.getElementById('debugTimingEvents' + i);
    if (!eventsEl) continue;
    const v = raceVideos[i];
    const ct = clipTimes ? clipTimes[i] : null;
    if (!ct || !v || !v.duration) {
      eventsEl.replaceChildren();
      const noData = document.createElement('span');
      noData.style.color = '#777';
      noData.textContent = 'No timing data';
      eventsEl.appendChild(noData);
      continue;
    }
    const wcStart = ct._wcStart != null ? ct._wcStart : ct.start;
    const wcEnd = ct._wcEnd != null ? ct._wcEnd : ct.end;
    const toPts = (wc) => {
      const wcDur = wcEnd - wcStart;
      const ptsDur = ct.end - ct.start;
      if (wcDur <= 0) return null;
      return ct.start + (wc - wcStart) / wcDur * ptsDur;
    };
    const fmtS = (val) => val != null && isFinite(val) ? val.toFixed(3) + 's' : '\u2014';
    const toFrame = (pts) => pts != null && isFinite(pts) ? Math.round(pts / 0.04) : null;
    const fmtF = (pts) => { const f = toFrame(pts); return f != null ? '#' + f : '\u2014'; };
    const events = [];
    events.push({ label: 'Context created', wc: -offset, ptsVal: 0 });
    events.push({ label: 'recordingStartTime (t=0)', wc: 0, ptsVal: toPts(0) });
    events.push({ label: 'raceRecordingStart()', wc: wcStart, ptsVal: ct.start });
    const measurements = ct.measurements || [];
    for (let m = 0; m < measurements.length; m++) {
      const meas = measurements[m];
      const startPts = Number.isFinite(meas.startTraceTs)
        ? traceTsToClipPts(ct, meas.startTraceTs)
        : (meas.startTime != null ? toPts(meas.startTime) : null);
      const endPts = Number.isFinite(meas.endTraceTs)
        ? traceTsToClipPts(ct, meas.endTraceTs)
        : (meas.endTime != null ? toPts(meas.endTime) : null);
      if (meas.startTime != null || Number.isFinite(meas.startTraceTs)) {
        events.push({ label: 'raceStart("' + (meas.name || '') + '")', wc: meas.startTime, ptsVal: startPts });
      }
      if (meas.endTime != null || Number.isFinite(meas.endTraceTs)) {
        events.push({ label: 'raceEnd("' + (meas.name || '') + '")', wc: meas.endTime, ptsVal: endPts });
      }
    }
    events.push({ label: 'raceRecordingEnd()', wc: wcEnd, ptsVal: ct.end });
    events.push({ label: 'Pre-close', wc: ct.wallClockDuration || null, ptsVal: v.duration });
    events.push({ label: 'Calibration mode', wc: 'trace-only', ptsVal: 'trace ts', frame: '\u2014', bold: true });

    function buildTimingRow(ev, bold) {
      const div = document.createElement('div');
      div.className = 'debug-timing-event';
      const cols = [
        ev.label,
        typeof ev.wc === 'string' ? ev.wc : fmtS(ev.wc),
        typeof ev.ptsVal === 'string' ? ev.ptsVal : fmtS(ev.ptsVal),
        ev.frame != null ? ev.frame : fmtF(ev.ptsVal),
      ];
      const classes = ['debug-timing-label', 'debug-timing-val', 'debug-timing-val', 'debug-timing-val'];
      for (let c = 0; c < cols.length; c++) {
        const span = document.createElement('span');
        span.className = classes[c];
        if (bold || ev.bold) {
          const b = document.createElement('b');
          b.textContent = cols[c];
          span.appendChild(b);
        } else {
          span.textContent = cols[c];
        }
        div.appendChild(span);
      }
      return div;
    }

    eventsEl.replaceChildren();
    eventsEl.appendChild(buildTimingRow({ label: 'Event', wc: 'Wall-clock', ptsVal: 'Video time', frame: 'Frame' }, true));
    for (const ev of events) {
      eventsEl.appendChild(buildTimingRow(ev, false));
    }
  }
}

// --- Debug panel: frame positions ---

function updateFramePositions() {
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  for (let i = 0; i < raceVideos.length; i++) {
    const row = document.getElementById('debugFrameRow' + i);
    if (!row) continue;
    const v = raceVideos[i];
    if (!v || !v.duration) continue;
    let totalFrames = 0;
    if (typeof v.getVideoPlaybackQuality === 'function') {
      totalFrames = v.getVideoPlaybackQuality().totalVideoFrames;
    }
    clearRowKeepName(row);
    if (totalFrames <= 0) { appendSpan(row, '\u2014'); continue; }
    const fullFrame = Math.round(v.currentTime / v.duration * totalFrames);
    const clip = ct ? ct[i] : null;
    if (clip && isValidClipEntry(clip)) {
      const clipStartFrame = Math.round(clip.start / v.duration * totalFrames);
      const clipEndFrame = Math.round(clip.end / v.duration * totalFrames);
      const clipFrame = fullFrame - clipStartFrame;
      const clipTotal = clipEndFrame - clipStartFrame;
      appendSpan(row, 'clip: ' + clipFrame + ' / ' + clipTotal);
      appendSpan(row, 'full: ' + fullFrame + ' / ' + totalFrames);
      appendSpan(row, 'range: ' + clipStartFrame + '\u2013' + clipEndFrame);
    } else {
      appendSpan(row, 'full: ' + fullFrame + ' / ' + totalFrames);
    }
  }
}

// --- Debug mode: per-racer clip start calibration ---

const FRAME_STEP = 0.04;
const debugOffsets = raceVideos.map(() => 0);

function getAdjustedClipTimes() {
  const base = activeSegmentClipTimes || clipTimes;
  if (!base) return null;
  return base.map((ct, i) => {
    if (!ct) return null;
    return { start: ct.start + debugOffsets[i], end: ct.end };
  });
}

function getSegmentClipTimes(name) {
  if (!clipTimes) return null;
  return clipTimes.map(ct => {
    if (!ct || ct._wcStart == null || ct._wcEnd == null) return null;
    const m = ct.measurements && ct.measurements.find(m => m.name === name);
    if (!m || !Number.isFinite(m.startTraceTs) || !Number.isFinite(m.endTraceTs)) return null;
    const startPts = traceTsToClipPts(ct, m.startTraceTs);
    const endPts = traceTsToClipPts(ct, m.endTraceTs);
    if (!Number.isFinite(startPts) || !Number.isFinite(endPts) || endPts <= startPts) return null;
    return { start: startPts, end: endPts };
  });
}

function buildSegmentNav() {
  if (segmentNavBuilt || !clipTimes) return;
  if (!segmentNav) return;
  if (!clipTimes.every(ct => !ct || ct._wcStart != null)) return;
  const seen = new Set();
  const names = [];
  for (const ct of clipTimes) {
    if (!ct || !ct.measurements) continue;
    for (const m of ct.measurements) {
      if (m.name && !seen.has(m.name)) { seen.add(m.name); names.push(m.name); }
    }
  }
  if (names.length < 1) return;
  segmentNavBuilt = true;
  segmentNav.innerHTML = '';

  function setActiveSegBtn(btn) {
    segmentNav.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // Switch to race-clip videos if we were in whole-recording (full) mode
  function ensureRaceMode(callback) {
    if (fullVideoPaths && loadedSrcSet === 'full') {
      if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
      detachVideoListeners();
      raceVideos.forEach((v, i) => { v.src = resolvedRacePaths[i]; });
      loadedSrcSet = 'race';
      videos = raceVideos;
      primary = videos[0];
      attachVideoListeners();
      duration = 0;
      pendingSeek = callback;
    } else {
      callback();
    }
  }

  // "Whole Recording" — shows full unclipped recording
  const fullBtn = document.createElement('button');
  fullBtn.className = 'segment-btn';
  fullBtn.textContent = 'Whole Recording';
  fullBtn.dataset.segment = '__full__';
  fullBtn.addEventListener('click', () => {
    setActiveSegBtn(fullBtn);
    activeSegmentName = '__full__';
    activeSegmentClipTimes = null;
    const doSeek = () => { activeClip = null; seekAll(0); scrubber.value = 0; updateTimeDisplay(); };
    if (fullVideoPaths && loadedSrcSet !== 'full') {
      if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
      detachVideoListeners();
      raceVideos.forEach((v, i) => { v.src = resolvedFullPaths[i]; });
      loadedSrcSet = 'full';
      videos = raceVideos;
      primary = videos[0];
      attachVideoListeners();
      duration = 0;
      pendingSeek = doSeek;
    } else {
      doSeek();
    }
  });
  segmentNav.appendChild(fullBtn);

  // "All" — shows all measurements combined
  const allBtn = document.createElement('button');
  allBtn.className = 'segment-btn active';
  allBtn.textContent = 'Race Recording';
  allBtn.dataset.segment = '__all__';
  allBtn.addEventListener('click', () => {
    setActiveSegBtn(allBtn);
    activeSegmentName = null;
    activeSegmentClipTimes = null;
    ensureRaceMode(() => {
      activeClip = resolveAdjustedClip();
      seekAll(activeClip ? activeClip.start : 0);
      scrubber.value = 0;
      updateTimeDisplay();
    });
  });
  segmentNav.appendChild(allBtn);

  // Individual measurement buttons — only shown when there are multiple measurements
  if (names.length > 1) {
    for (const name of names) {
      const btn = document.createElement('button');
      btn.className = 'segment-btn';
      btn.textContent = name;
      btn.dataset.segment = name;
      btn.addEventListener('click', () => {
        setActiveSegBtn(btn);
        activeSegmentName = name;
        activeSegmentClipTimes = getSegmentClipTimes(name);
        ensureRaceMode(() => {
          activeClip = resolveAdjustedClip();
          seekAll(activeClip ? activeClip.start : 0);
          scrubber.value = 0;
          updateTimeDisplay();
        });
      });
      segmentNav.appendChild(btn);
    }
  }

  segmentNav.style.display = 'flex';
}

function buildRacerFilter() {
  const filterEl = document.getElementById('racerFilter');
  if (!filterEl) return;
  const racerDivs = playerContainer ? playerContainer.querySelectorAll('.racer') : [];
  for (let i = 0; i < raceVideos.length; i++) {
    const btn = document.createElement('button');
    btn.className = 'racer-filter-btn active';
    btn.style.color = racerColors[i];
    btn.textContent = racerNames[i];
    btn.dataset.idx = i;
    filterEl.appendChild(btn);
  }
  filterEl.style.display = 'flex';
  filterEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.racer-filter-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    const isHidden = hiddenRacers.has(idx);
    const visibleCount = raceVideos.length - hiddenRacers.size;
    if (!isHidden && visibleCount <= 2) return;
    if (isHidden) {
      hiddenRacers.delete(idx);
      btn.classList.add('active');
      if (racerDivs[idx]) racerDivs[idx].style.display = '';
    } else {
      hiddenRacers.add(idx);
      btn.classList.remove('active');
      if (racerDivs[idx]) racerDivs[idx].style.display = 'none';
    }
    activeClip = resolveAdjustedClip();
    seekAll(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
    updateTimeDisplay();
  });
}

function resolveAdjustedClip() {
  const adj = getAdjustedClipTimes();
  if (!adj) return resolveClip();
  let minStart = Infinity, maxDuration = 0, found = false;
  for (let i = 0; i < adj.length; i++) {
    if (hiddenRacers.has(i)) continue;
    if (isValidClipEntry(adj[i])) {
      minStart = Math.min(minStart, adj[i].start);
      maxDuration = Math.max(maxDuration, adj[i].end - adj[i].start);
      found = true;
    }
  }
  return found ? { start: minStart, end: minStart + maxDuration } : null;
}

function updateDebugDisplay() {
  const adj = getAdjustedClipTimes();
  for (let i = 0; i < raceVideos.length; i++) {
    const el = document.getElementById('debugStart' + i);
    if (!el) continue;
    const frames = Math.round(debugOffsets[i] / FRAME_STEP);
    const sign = frames >= 0 ? '+' : '';
    const startVal = adj && adj[i] ? adj[i].start.toFixed(3) : '0.000';
    el.textContent = 'start: ' + startVal + 's (' + sign + frames + 'f)';
  }
}

function adjustDebugOffset(idx, frameDelta) {
  if (!clipTimes || !clipTimes[idx]) return;
  let newOffset = debugOffsets[idx] + frameDelta * FRAME_STEP;
  const newStart = clipTimes[idx].start + newOffset;
  if (newStart < 0) newOffset = -clipTimes[idx].start;
  if (newStart >= clipTimes[idx].end) return;
  debugOffsets[idx] = newOffset;
  updateDebugDisplay();
  updateDebugStats();
  activeClip = resolveAdjustedClip();
  seekAll(activeClip ? activeClip.start : 0);
  scrubber.value = 0;
  updateTimeDisplay();
}

// --- Debug panel event delegation ---

if (debugPanel) {
  debugPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('.debug-frame-btn');
    if (btn) {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const delta = parseInt(btn.getAttribute('data-delta'), 10);
      adjustDebugOffset(idx, delta);
      return;
    }
    if (e.target.id === 'debugCopyJson') {
      const adj = getAdjustedClipTimes();
      const timingData = raceVideos.map((v, i) => {
        const ct = clipTimes ? clipTimes[i] : null;
        if (!ct) return null;
        return {
          _wcStart: ct._wcStart != null ? ct._wcStart : null,
          _wcEnd: ct._wcEnd != null ? ct._wcEnd : null,
          _ptsScale: ct._ptsScale || null,
          calibratedStart: ct.calibratedStart != null ? ct.calibratedStart : null,
          calibratedEnd: ct.calibratedEnd != null ? ct.calibratedEnd : null,
          recordingOffset: ct.recordingOffset || 0,
          wallClockDuration: ct.wallClockDuration || 0,
          measurements: ct.measurements || [],
          videoDuration: v ? v.duration : null
        };
      });
      const out = { clipTimes: adj, offsets: debugOffsets.slice(), timingData };
      navigator.clipboard.writeText(JSON.stringify(out, null, 2));
      return;
    }
    if (e.target.id === 'debugResetAll') {
      for (let i = 0; i < debugOffsets.length; i++) debugOffsets[i] = 0;
      updateDebugDisplay();
      updateDebugStats();
      activeClip = resolveAdjustedClip();
      seekAll(activeClip ? activeClip.start : 0);
      scrubber.value = 0;
      updateTimeDisplay();
    }
  });
}

// --- Mode button bindings ---

if (modeRace) modeRace.addEventListener('click', switchToRace);
if (modeFull) modeFull.addEventListener('click', switchToFull);
if (modeMerged) modeMerged.addEventListener('click', switchToMerged);
if (modeDebug) modeDebug.addEventListener('click', toggleCalibration);
if (mergedVideo) mergedVideo.addEventListener('loadedmetadata', () => {
  if (videos.indexOf(mergedVideo) !== -1) {
    duration = mergedVideo.duration;
    updateTimeDisplay();
  }
});

// --- Playback controls ---

playBtn.addEventListener('click', () => {
  if (playing) {
    videos.forEach(v => v?.pause());
    setPlayState(false);
  } else {
    if (activeClip && Number(scrubber.value) >= 999) {
      seekAll(activeClip.start);
      scrubber.value = 0;
    }
    videos.forEach(v => v?.play());
    setPlayState(true);
  }
  playing = !playing;
});

scrubber.addEventListener('input', () => {
  const d = clipDuration();
  const t = (scrubber.value / 1000) * d + clipOffset();
  seekAll(t);
  updateTimeDisplay();
});

speedSelect.addEventListener('change', () => {
  const rate = parseFloat(speedSelect.value);
  videos.forEach(v => { if (v) v.playbackRate = rate; });
});

function stepFrame(delta) {
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
  const minT = clipOffset();
  const maxT = activeClip ? activeClip.end : duration;
  const d = clipDuration();
  const cur = d > 0 ? minT + (scrubber.value / 1000) * d : (primary.currentTime || 0);
  const t = Math.max(minT, Math.min(maxT, cur + delta));
  seekAll(t);
  const newElapsed = t - minT;
  scrubber.value = d > 0 ? (newElapsed / d) * 1000 : 0;
  updateTimeDisplay();
}

document.getElementById('prevFrame').addEventListener('click', () => stepFrame(-STEP));
document.getElementById('nextFrame').addEventListener('click', () => stepFrame(STEP));

function goToStart() {
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
  seekAll(activeClip ? activeClip.start : 0);
  scrubber.value = 0;
  updateTimeDisplay();
}

function goToEnd() {
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
  seekAll(activeClip ? activeClip.end : duration);
  scrubber.value = 1000;
  updateTimeDisplay();
}

document.getElementById('goStart').addEventListener('click', goToStart);
document.getElementById('goEnd').addEventListener('click', goToEnd);

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-STEP); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(STEP); }
  else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  else if (e.key === 'Home') { e.preventDefault(); goToStart(); }
  else if (e.key === 'End') { e.preventDefault(); goToEnd(); }
});

// --- Racer filter (3+ racers only) ---

buildRacerFilter();

// --- Initial clip seek ---

// Tolerance (seconds): if currentTime lands within this window of the target
// we consider the seek successful and stop retrying.
const SEEK_SNAP_TOLERANCE = 0.15;
// Maximum number of seeked-event retries before giving up on a snap-back seek.
const MAX_SEEK_RETRIES = 10;
// Positions within 1ms of zero are treated as "start of video" — no seek needed.
const ZERO_START_THRESHOLD = 0.001;

// seekAllWithVerify handles two distinct Chrome/WebM seeking failure modes:
//
//  1. Seek snaps back (seeked fires but currentTime < expected − tolerance):
//     Chrome can't find the target cluster without a seek table (Cues element).
//     Retry via the 'seeked' event up to MAX_SEEK_RETRIES times as data buffers.
//
//  2. Seek silently ignored at readyState=1 (HAVE_METADATA, no buffered data):
//     The seek is issued before any data is available, so Chrome drops it.
//     Retry via 'canplay' (readyState ≥ 3) when enough data has loaded.
//     The 'canplay' handler resets the retry counter so case-1 retries still work.
function seekAllWithVerify(targetStart) {
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  seekAll(targetStart);
  raceVideos.forEach((v, i) => {
    if (!v || !clipTimes) return;
    const expected = ct && isValidClipEntry(ct[i]) ? ct[i].start : targetStart;
    if (expected <= ZERO_START_THRESHOLD) return; // nothing to verify at start of video
    let retries = 0;
    const handler = () => {
      if (Math.abs(v.currentTime - expected) > SEEK_SNAP_TOLERANCE && retries++ < MAX_SEEK_RETRIES) {
        v.currentTime = Math.min(expected, isFinite(v.duration) ? v.duration : expected);
        v.addEventListener('seeked', handler, { once: true });
      }
    };
    v.addEventListener('seeked', handler, { once: true });
    // Case 2 fallback: retry when data is available (canplay = readyState ≥ 3).
    v.addEventListener('canplay', () => {
      if (Math.abs(v.currentTime - expected) > SEEK_SNAP_TOLERANCE) {
        retries = 0; // give the seeked retry loop a fresh budget
        v.currentTime = Math.min(expected, isFinite(v.duration) ? v.duration : expected);
        v.addEventListener('seeked', handler, { once: true });
      }
    }, { once: true });
  });
}

if (clipTimes) {
  const initSeek = () => {
    activeClip = resolveAdjustedClip();
    seekAllWithVerify(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
    updateTimeDisplay();
  };
  pendingSeek = initSeek;
  if (raceVideos.every(v => !v || v.readyState >= 1)) {
    // If metadata loaded before listeners attached, run one onMeta() pass
    // explicitly so clip conversions/calibration are applied on first paint.
    onMeta();
  }
}

// Kick an initial metadata pass in case loadedmetadata fired before listeners
// were attached (e.g. cache-fast loads). Wait until all race videos expose
// metadata so conversion/calibration can actually run.
{
  let attempts = 0;
  const runInitialMetaPass = () => {
    if (raceVideos.every(v => !v || v.readyState >= 1)) {
      onMeta();
      return;
    }
    attempts++;
    if (attempts < 120) setTimeout(runInitialMetaPass, 50);
  };
  runInitialMetaPass();
}

// --- Export: client-side side-by-side video stitching ---

const exportBtn = document.getElementById('exportBtn');

function getExportLayout(count) {
  const LABEL_H = 30;
  const targetW = count <= 3 ? 640 : 480;
  const sample = raceVideos.find(v => v && v.videoWidth);
  const aspect = sample ? sample.videoHeight / sample.videoWidth : 9/16;
  const cellH = Math.round(targetW * aspect);
  const slotH = cellH + LABEL_H;
  let cols, rows;
  const positions = [];
  if (count <= 3) {
    cols = count; rows = 1;
    for (let i = 0; i < count; i++) positions.push({ x: i * targetW, y: 0 });
  } else if (count === 4) {
    cols = 2; rows = 2;
    for (let i = 0; i < 4; i++) positions.push({ x: (i % 2) * targetW, y: Math.floor(i / 2) * slotH });
  } else {
    cols = 3; rows = 2;
    for (let i = 0; i < 3; i++) positions.push({ x: i * targetW, y: 0 });
    const bottomOffset = Math.floor(targetW / 2);
    for (let i = 0; i < count - 3; i++) positions.push({ x: bottomOffset + i * targetW, y: slotH });
  }
  const canvasW = (count >= 5 ? 3 : cols) * targetW;
  const canvasH = rows * slotH;
  return { canvasW, canvasH, targetW, cellH, labelH: LABEL_H, positions };
}

function drawExportFrame(ctx, layout, clockTime) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  for (let i = 0; i < raceVideos.length; i++) {
    const v = raceVideos[i];
    if (!v) continue;
    const pos = layout.positions[i];
    ctx.fillStyle = racerColors[i] || '#e8e0d0';
    ctx.font = 'bold 16px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(racerNames[i] || '', pos.x + layout.targetW / 2, pos.y + layout.labelH - 8);
    try { ctx.drawImage(v, pos.x, pos.y + layout.labelH, layout.targetW, layout.cellH); } catch {}
  }
  // Clock overlay: matches the ffmpeg drawtext style in sidebyside.js
  const t = clockTime != null ? clockTime : (primary ? (primary.currentTime || 0) : 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  const clockText = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  const metrics = ctx.measureText(clockText);
  const tw = metrics.width;
  const th = 22;
  const pad = 4;
  const cx = layout.canvasW / 2;
  const cy = layout.canvasH - th - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(cx - tw / 2 - pad, cy - th + pad, tw + pad * 2, th + pad);
  ctx.fillStyle = '#fff';
  ctx.fillText(clockText, cx, cy + pad);
}

// --- Browser-based format conversion via ffmpeg.wasm ---
let ffmpegInstance = null;

function toBlobURL(url, mimeType) {
  return fetch(url).then(resp => {
    if (!resp.ok) throw new Error('Failed to fetch ' + url + ' (' + resp.status + ')');
    return resp.blob();
  }).then(data => URL.createObjectURL(new Blob([data], { type: mimeType })));
}

function loadFFmpeg() {
  if (ffmpegInstance) return Promise.resolve(ffmpegInstance);
  if (location.protocol === 'file:') {
    return Promise.reject(new Error('Conversion requires HTTP(S) — serve this file via a local server (e.g. npx serve)'));
  }
  return import('{{ffmpegDir}}index.js')
    .then(mod => {
      const ff = new mod.FFmpeg();
      return Promise.all([
        toBlobURL('{{ffmpegDir}}ffmpeg-core.js', 'text/javascript'),
        toBlobURL('{{ffmpegDir}}ffmpeg-core.wasm', 'application/wasm'),
      ]).then(urls => {
        const revoke = () => urls.forEach(u => URL.revokeObjectURL(u));
        return ff.load({ coreURL: urls[0], wasmURL: urls[1] }).then(revoke, err => { revoke(); throw err; });
      }).then(() => {
        ffmpegInstance = ff;
        return ff;
      });
    });
}

let convertCounter = 0;

function convertWithFFmpeg(blob, format, statusEl, progressFill, actionsEl, overlay, downloadName, clipRange) {
  const runId = ++convertCounter;
  const inFile = 'input_' + runId + '.webm';
  const outFile = 'output_' + runId + '.' + format;
  const outFilename = (downloadName || 'race-side-by-side') + '.' + format;
  const buttons = actionsEl.querySelectorAll('button');
  buttons.forEach(b => { b.disabled = true; });
  let cancelled = false;
  let outUrl = null;

  function revokeOutUrl() { if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; } }

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Cancel';
  dismissBtn.addEventListener('click', () => { cancelled = true; revokeOutUrl(); overlay.remove(); });
  actionsEl.appendChild(dismissBtn);
  statusEl.textContent = 'Loading ffmpeg.wasm (~25 MB)...';
  progressFill.style.width = '0%';

  window.addEventListener('pagehide', revokeOutUrl, { once: true });

  loadFFmpeg().then(ff => {
    if (cancelled) return;
    statusEl.textContent = 'Converting to ' + format.toUpperCase() + '...';
    progressFill.style.width = '30%';

    return blob.arrayBuffer().then(buf => {
      if (cancelled) return;
      return ff.writeFile(inFile, new Uint8Array(buf));
    }).then(() => {
      if (cancelled) return;
      let trimArgs = [];
      if (clipRange) {
        trimArgs = ['-ss', clipRange.start.toFixed(3), '-t', (clipRange.end - clipRange.start).toFixed(3)];
      }
      let args;
      if (format === 'gif') {
        args = trimArgs.concat(['-i', inFile, '-filter_complex',
          'fps=10,scale=640:-2,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
          outFile]);
      } else {
        args = trimArgs.concat(['-i', inFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outFile]);
      }
      progressFill.style.width = '50%';
      return ff.exec(args);
    }).then(exitCode => {
      if (cancelled || exitCode == null) return;
      if (exitCode !== 0) throw new Error('ffmpeg exited with code ' + exitCode + ' — conversion failed');
      progressFill.style.width = '90%';
      return ff.readFile(outFile);
    }).then(data => {
      if (cancelled || !data) return;
      const mType = format === 'gif' ? 'image/gif' : 'video/quicktime';
      const outBlob = new Blob([data], { type: mType });
      outUrl = URL.createObjectURL(outBlob);

      statusEl.textContent = 'Conversion complete! (' + (outBlob.size / (1024 * 1024)).toFixed(1) + ' MB)';
      progressFill.style.width = '100%';

      const dlLink = document.createElement('a');
      dlLink.href = outUrl;
      dlLink.download = outFilename;
      dlLink.textContent = 'Download ' + format.toUpperCase();

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => { revokeOutUrl(); overlay.remove(); });

      actionsEl.innerHTML = '';
      actionsEl.appendChild(dlLink);
      actionsEl.appendChild(closeBtn);

      ff.deleteFile(inFile).catch(e => { console.warn('ffmpeg cleanup:', e.message); });
      ff.deleteFile(outFile).catch(e => { console.warn('ffmpeg cleanup:', e.message); });
    });
  }).catch(err => {
    revokeOutUrl();
    if (ffmpegInstance) {
      ffmpegInstance.deleteFile(inFile).catch(() => {});
      ffmpegInstance.deleteFile(outFile).catch(() => {});
    }
    statusEl.textContent = 'Conversion failed: ' + err.message;
    buttons.forEach(b => { b.disabled = false; });
    if (dismissBtn.parentNode) dismissBtn.remove();
  });
}

async function startExport() {
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
    alert('Export requires a browser that supports Canvas.captureStream and MediaRecorder (Chrome, Firefox, or Edge).');
    return;
  }
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }

  const layout = getExportLayout(raceVideos.length);

  const tmpl = document.getElementById('tmpl-export-overlay');
  const overlay = tmpl.content.cloneNode(true).firstElementChild;
  const canvas = overlay.querySelector('.export-canvas');
  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;
  document.body.appendChild(overlay);

  const ctx = canvas.getContext('2d');
  const progressFill = overlay.querySelector('.export-progress-fill');
  const statusEl = overlay.querySelector('.export-status');
  const actionsEl = overlay.querySelector('.export-actions');

  const startTime = activeClip ? activeClip.start : 0;
  const endTime = activeClip ? activeClip.end : duration;
  const totalDur = endTime - startTime;

  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  const perVideoEnd = raceVideos.map((v, i) => {
    if (!v) return endTime;
    return (activeClip && ct && ct[i]) ? ct[i].end : endTime;
  });

  const seekPromises = raceVideos.map((v, i) => {
    if (!v) return Promise.resolve();
    return new Promise((resolve) => {
      let target = startTime;
      if (activeClip && ct && ct[i]) {
        const elapsed = startTime - activeClip.start;
        target = ct[i].start + elapsed;
        target = Math.max(ct[i].start, Math.min(ct[i].end, target));
      }
      v.currentTime = Math.min(target, v.duration || target);
      v.onseeked = () => { v.onseeked = null; resolve(); };
    });
  });

  let cancelled = false;
  let recorder = null;
  let rafId = null;

  overlay.querySelector('.export-cancel').addEventListener('click', () => {
    cancelled = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (rafId) cancelAnimationFrame(rafId);
    raceVideos.forEach(v => v?.pause());
    overlay.remove();
  });

  await Promise.all(seekPromises);
  if (cancelled) return;
  statusEl.textContent = 'Recording...';

  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    if (cancelled) return;
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    statusEl.textContent = 'Export complete!';
    progressFill.style.width = '100%';
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'race-side-by-side.webm';
    downloadLink.textContent = 'Download';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => { URL.revokeObjectURL(url); overlay.remove(); });
    const convertRow = document.createElement('div');
    convertRow.className = 'export-convert-row';
    const gifBtn = document.createElement('button');
    gifBtn.textContent = 'Convert to GIF';
    gifBtn.addEventListener('click', () => { convertWithFFmpeg(blob, 'gif', statusEl, progressFill, actionsEl, overlay); });
    const movBtn = document.createElement('button');
    movBtn.textContent = 'Convert to MOV';
    movBtn.addEventListener('click', () => { convertWithFFmpeg(blob, 'mov', statusEl, progressFill, actionsEl, overlay); });
    convertRow.appendChild(gifBtn);
    convertRow.appendChild(movBtn);
    actionsEl.replaceChildren(downloadLink, convertRow, closeBtn);
  };

  recorder.start();
  const exportRate = parseFloat(speedSelect.value) || 1;
  raceVideos.forEach(v => { if (v) { v.playbackRate = exportRate; v.play(); } });
  const speedLabel = exportRate !== 1 ? ' (' + exportRate + 'x)' : '';

  function tick() {
    if (cancelled) return;
    const cur = Math.max(...raceVideos.map(v => v?.currentTime || 0));
    drawExportFrame(ctx, layout, cur);
    const progress = totalDur > 0 ? Math.min(1, (cur - startTime) / totalDur) : 0;
    progressFill.style.width = (progress * 100).toFixed(1) + '%';
    statusEl.textContent = 'Recording' + speedLabel + '... ' + Math.round(progress * 100) + '%';
    const allDone = raceVideos.every((v, i) => !v || v.currentTime >= perVideoEnd[i] || v.ended);
    if (allDone) {
      raceVideos.forEach(v => v?.pause());
      if (recorder.state !== 'inactive') recorder.stop();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

if (exportBtn) {
  if (raceVideos.length < 2) exportBtn.style.display = 'none';
  exportBtn.addEventListener('click', startExport);
}

// --- Export HTML: self-contained zip with videos, profiles, baked adjustments ---

const _crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  _crc32Table[i] = c;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = _crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZipBuilder() {
  const chunks = [];
  const entries = [];
  const encoder = new TextEncoder();
  let offset = 0;

  function addFile(name, data) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    let pos = 0;
    view.setUint32(pos, 0x04034b50, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2;
    view.setUint16(pos, 0x0800, true); pos += 2; // UTF-8 flag
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0x5421, true); pos += 2;
    view.setUint32(pos, crc, true); pos += 4;
    view.setUint32(pos, data.length, true); pos += 4;
    view.setUint32(pos, data.length, true); pos += 4;
    view.setUint16(pos, nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    localHeader.set(nameBytes, pos);

    chunks.push(localHeader, data);
    entries.push({ name: nameBytes, size: data.length, crc, offset });
    offset += localHeader.length + data.length;
  }

  function toBlob() {
    const centralDirOffset = offset;
    let centralDirSize = 0;
    entries.forEach(e => { centralDirSize += 46 + e.name.length; });

    const trailerChunks = [];
    for (const e of entries) {
      const centralHeader = new Uint8Array(46 + e.name.length);
      const view = new DataView(centralHeader.buffer);
      let pos = 0;
      view.setUint32(pos, 0x02014b50, true); pos += 4;
      view.setUint16(pos, 20, true); pos += 2;
      view.setUint16(pos, 20, true); pos += 2;
      view.setUint16(pos, 0x0800, true); pos += 2; // UTF-8 flag
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0x5421, true); pos += 2;
      view.setUint32(pos, e.crc, true); pos += 4;
      view.setUint32(pos, e.size, true); pos += 4;
      view.setUint32(pos, e.size, true); pos += 4;
      view.setUint16(pos, e.name.length, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint32(pos, 0, true); pos += 4;
      view.setUint32(pos, e.offset, true); pos += 4;
      centralHeader.set(e.name, pos);
      trailerChunks.push(centralHeader);
    }

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    let p = 0;
    eocdView.setUint32(p, 0x06054b50, true); p += 4;
    eocdView.setUint16(p, 0, true); p += 2;
    eocdView.setUint16(p, 0, true); p += 2;
    eocdView.setUint16(p, entries.length, true); p += 2;
    eocdView.setUint16(p, entries.length, true); p += 2;
    eocdView.setUint32(p, centralDirSize, true); p += 4;
    eocdView.setUint32(p, centralDirOffset, true); p += 4;
    eocdView.setUint16(p, 0, true);
    trailerChunks.push(eocd);

    // Build zip from chunks to avoid creating one giant contiguous ArrayBuffer copy.
    return new Blob([...chunks, ...trailerChunks], { type: 'application/zip' });
  }

  return { addFile, toBlob };
}

function buildExportHtml(pathOverrides = {}) {
  const doc = document.documentElement.cloneNode(true);

  // Defensive cleanup: if runtime state duplicated racer cards, keep one set.
  const racerCards = Array.from(doc.querySelectorAll('#playerContainer .racer'));
  const expectedRacers = Array.isArray(raceVideoPaths) ? raceVideoPaths.filter(Boolean).length : 0;
  if (expectedRacers > 0 && racerCards.length > expectedRacers) {
    racerCards.slice(expectedRacers).forEach((el) => el.remove());
  }

  // Remove debug/calibration panel and button
  const dp = doc.querySelector('#debugPanel');
  if (dp) dp.remove();
  const calBtn = doc.querySelector('#modeDebug');
  if (calBtn) calBtn.remove();

  // Remove export buttons (HTML export already done, video export needs ffmpeg assets not in ZIP)
  const htmlBtn = doc.querySelector('#exportHtmlBtn');
  if (htmlBtn) htmlBtn.remove();
  const expBtn = doc.querySelector('#exportBtn');
  if (expBtn) expBtn.remove();

  // Remove any active export overlays
  doc.querySelectorAll('.export-overlay').forEach(el => el.remove());

  // Embed video paths: patch merged video src attribute and raceVideoPaths/fullVideoPaths in script
  const hasOverrides = Object.keys(pathOverrides).length > 0;
  if (hasOverrides) {
    const mv = doc.querySelector('#mergedVideo');
    if (mv) {
      const mvSrc = mv.getAttribute('src');
      if (mvSrc && pathOverrides[mvSrc]) mv.setAttribute('src', pathOverrides[mvSrc]);
    }
  }

  // Bake adjusted clip times into the script; also apply path overrides for video embedding
  const scripts = doc.querySelectorAll('script');
  for (const script of scripts) {
    let text = script.textContent;
    if (!text.includes('const clipTimes =')) continue;
    const adj = getAdjustedClipTimes();
    if (adj && clipTimes) {
      const baked = adj.map((ct, i) => {
        if (!ct) return null;
        const orig = clipTimes[i] || {};
        return {
          start: ct.start,
          end: ct.end,
          _converted: true,
          calibratedStart: ct.start,
          calibratedEnd: ct.end,
          _wcStart: orig._wcStart != null ? orig._wcStart : ct.start,
          _wcEnd: orig._wcEnd != null ? orig._wcEnd : ct.end,
          wallClockDuration: orig.wallClockDuration || 0,
          recordingOffset: orig.recordingOffset || 0,
          measurements: orig.measurements || [],
        };
      });
      text = text.replace(
        /const clipTimes = [\s\S]+?;\n/,
        'const clipTimes = ' + JSON.stringify(baked) + ';\n'
      );
    }
    if (hasOverrides) {
      for (const [oldPath, dataUri] of Object.entries(pathOverrides)) {
        text = text.replaceAll(JSON.stringify(oldPath), JSON.stringify(dataUri));
      }
    }
    script.textContent = text;
  }

  return '<!DOCTYPE html>\n' + doc.outerHTML;
}

async function startHtmlExport() {
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }

  const tmpl = document.getElementById('tmpl-export-overlay');
  const overlay = tmpl.content.cloneNode(true).firstElementChild;
  const canvas = overlay.querySelector('.export-canvas');
  canvas.style.display = 'none';
  const titleEl = overlay.querySelector('h3');
  titleEl.textContent = 'Exporting HTML';
  document.body.appendChild(overlay);

  const progressFill = overlay.querySelector('.export-progress-fill');
  const statusEl = overlay.querySelector('.export-status');
  const actionsEl = overlay.querySelector('.export-actions');

  const abortCtrl = new AbortController();
  overlay.querySelector('.export-cancel').addEventListener('click', () => {
    abortCtrl.abort();
    overlay.remove();
  });

  // Collect video paths to embed and non-video paths to bundle as separate ZIP entries
  const videoPaths = new Set();
  raceVideoPaths.forEach(p => { if (p && !p.startsWith('data:')) videoPaths.add(p); });
  if (fullVideoPaths) fullVideoPaths.forEach(p => { if (p && !p.startsWith('data:')) videoPaths.add(p); });
  if (mergedVideo) {
    const mp = mergedVideo.getAttribute('src');
    if (mp && !mp.startsWith('data:')) videoPaths.add(mp);
  }

  const otherPaths = new Set();
  const optionalPaths = new Set(['summary.json']);
  document.querySelectorAll('.file-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('http') && !href.startsWith('//') && !href.startsWith('data:') && !videoPaths.has(href)) {
      otherPaths.add(href);
    }
  });
  otherPaths.add('summary.json');

  const total = videoPaths.size + otherPaths.size;
  const failedFiles = [];
  let fetched = 0;

  // Embed videos as data URIs directly in the exported HTML
  const pathOverrides = {};
  for (const vPath of videoPaths) {
    if (abortCtrl.signal.aborted) return;
    fetched++;
    statusEl.textContent = 'Embedding ' + vPath + ' (' + fetched + '/' + total + ')';
    progressFill.style.width = (fetched / total * 80).toFixed(0) + '%';
    try {
      const resp = await fetch(vPath, { signal: abortCtrl.signal });
      if (resp.ok) {
        pathOverrides[vPath] = await blobToDataUri(await resp.blob());
      } else {
        failedFiles.push(vPath);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      failedFiles.push(vPath);
    }
  }

  // Bundle non-video assets (trace files, summary, etc.) as separate ZIP entries
  const zipBuilder = createZipBuilder();
  for (const filePath of otherPaths) {
    if (abortCtrl.signal.aborted) return;
    fetched++;
    statusEl.textContent = 'Fetching ' + filePath + ' (' + fetched + '/' + total + ')';
    progressFill.style.width = (fetched / total * 80).toFixed(0) + '%';
    try {
      const resp = await fetch(filePath, { signal: abortCtrl.signal });
      if (resp.ok) {
        zipBuilder.addFile(filePath, new Uint8Array(await resp.arrayBuffer()));
      } else {
        if (!optionalPaths.has(filePath)) failedFiles.push(filePath);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (!optionalPaths.has(filePath)) failedFiles.push(filePath);
    }
  }

  if (abortCtrl.signal.aborted) return;

  statusEl.textContent = 'Building HTML...';
  progressFill.style.width = '90%';
  const html = buildExportHtml(pathOverrides);
  zipBuilder.addFile('index.html', new TextEncoder().encode(html));

  statusEl.textContent = 'Creating ZIP...';
  progressFill.style.width = '95%';
  const blob = zipBuilder.toBlob();
  const url = URL.createObjectURL(blob);

  let statusMsg = 'Export complete! (' + (blob.size / (1024 * 1024)).toFixed(1) + ' MB)';
  if (failedFiles.length > 0) {
    statusMsg += '\nSkipped ' + failedFiles.length + ' file(s): ' + failedFiles.join(', ');
  }
  statusEl.textContent = statusMsg;
  progressFill.style.width = '100%';

  const dlLink = document.createElement('a');
  dlLink.href = url;
  const zipName = document.title.replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_').toLowerCase();
  dlLink.download = (zipName || 'race-export') + '.zip';
  dlLink.textContent = 'Download ZIP';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { URL.revokeObjectURL(url); overlay.remove(); });
  actionsEl.replaceChildren(dlLink, closeBtn);
}

const exportHtmlBtn = document.getElementById('exportHtmlBtn');
if (exportHtmlBtn) {
  exportHtmlBtn.addEventListener('click', startHtmlExport);
}

