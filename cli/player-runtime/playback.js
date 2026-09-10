/* eslint-env browser */
/**
 * playback.js — Shared playback state, synchronized seeking, metadata
 * handling (WebM duration forcing), mode switching, transport controls,
 * and notes persistence. Pure calibration math lives in calibration.cjs;
 * this file keeps the thin state-bound wrappers around it.
 */

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

// Pause every video and reset the transport if playback is active.
function pausePlayback() {
  if (!playing) return;
  videos.forEach(v => v?.pause());
  playing = false;
  setPlayState(false);
}

// Recompute the active clip window from the current calibration/offsets.
function recalcActiveClip() {
  activeClip = resolveAdjustedClip();
  return activeClip;
}

// Switch the active video set (race ↔ full recording): swap sources, reset
// listeners/duration, and queue the follow-up seek.
function loadVideoSet(srcSet, applySrc, seekCallback) {
  pausePlayback();
  detachVideoListeners();
  applySrc();
  loadedSrcSet = srcSet;
  videos = raceVideos;
  primary = videos[0];
  attachVideoListeners();
  duration = 0;
  pendingSeek = seekCallback;
}

// Set the active segment and its resolved clip times. The calibration panel
// reads its rows off the active window, so it has to be repainted here — it
// used to keep showing the previous segment's starts until the next nudge.
function setActiveSegment(name, clip) {
  activeSegmentName = name;
  activeSegmentClipTimes = clip;
  updateDebugDisplay();
  updateDebugStats();
}

// Queue a seek to run once metadata/calibration is ready.
function setPendingSeek(fn) {
  pendingSeek = fn;
}

// Mark the segment-nav dropdown as built (guards against rebuilding).
function markSegmentNavBuilt() {
  segmentNavBuilt = true;
}

// Jump to the start of the whole recording (no active clip window).
function seekToWholeRecordingStart() {
  activeClip = null;
  seekAll(0);
  scrubber.value = 0;
  updateTimeDisplay();
}

let playing = false;
let duration = 0;
let activeClip = null;
let activeSegmentClipTimes = null;
let activeSegmentName = null;
let segmentNavBuilt = false;
const hiddenRacers = new Set();
let loadedSrcSet = 'race';
let pendingSeek = null;

// The transport steps by exactly one frame — FRAME_STEP, the same unit the
// calibration buttons nudge by and the frame badges count in. It is declared in
// calibration.cjs, concatenated after this file, so it is only ever read from
// inside a handler that runs once the whole runtime has been evaluated.
//
// stepFrame reads its position back off the scrubber (racers can be offset from
// each other, so no single video holds the shared elapsed time). The scrubber
// therefore carries `step="any"`: over its 1000 units one unit is 40ms once the
// window passes 40s — coarser than a frame — and integer rounding would make
// single-frame steps stall or jump two.

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

// --- Debug mode: per-racer clip start calibration ---

// Calibration offsets survive a reload, keyed on the race id stamped into
// #race-config at build time. That id is unique to one race run, so a second
// race — or a re-run of the same one, whose recordings start elsewhere — can
// never overwrite this page's calibration. Without an id (an older page, or a
// config that failed to parse) nothing is stored rather than risking a
// cross-race clash on a shared key.
//
// An exported page already carries its calibration inside clipTimes, so it
// stores under its own ':baked' key: it must neither re-apply offsets that are
// baked in nor write its own nudges back over the source page's.
const CALIBRATION_KEY_PREFIX = 'race-calibration:';

function calibrationStorageKey() {
  if (!raceId) return null;
  return CALIBRATION_KEY_PREFIX + raceId + (calibrationBaked ? ':baked' : '');
}

function zeroOffsets() {
  return raceVideos.map(() => 0);
}

function loadDebugOffsets() {
  const key = calibrationStorageKey();
  if (!key) return zeroOffsets();
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    // Only take a value shaped for this page: a stale entry from a race with a
    // different racer count must not half-apply.
    if (Array.isArray(stored) && stored.length === raceVideos.length && stored.every(Number.isFinite)) {
      return stored;
    }
  } catch (e) { /* storage unavailable (privacy mode / sandboxed) or corrupt */ }
  return zeroOffsets();
}

const debugOffsets = loadDebugOffsets();

// Persist the current offsets; an all-zero calibration drops the entry instead
// of storing a no-op.
function saveDebugOffsets() {
  const key = calibrationStorageKey();
  if (!key) return;
  try {
    if (debugOffsets.some(o => o !== 0)) localStorage.setItem(key, JSON.stringify(debugOffsets));
    else localStorage.removeItem(key);
  } catch (e) { /* storage unavailable */ }
}

function getAdjustedClipTimes() {
  const base = activeSegmentClipTimes || clipTimes;
  if (!base) return null;
  return base.map((ct, i) => {
    if (!ct) return null;
    return { start: ct.start + debugOffsets[i], end: ct.end };
  });
}

function getSegmentClipTimes(name) {
  return computeSegmentClipTimes(clipTimes, name);
}

function resolveClip() {
  return resolveClipWindow(clipTimes, hiddenRacers);
}

function resolveAdjustedClip() {
  const adj = getAdjustedClipTimes();
  if (!adj) return resolveClip();
  return resolveClipWindow(adj, hiddenRacers);
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

// Ensure every video has a finite duration, triggering the 1e10 scan when
// needed. Returns true once all videos report finite durations.
function ensureFiniteDurations() {
  for (const v of videos) {
    if (!v || v.readyState < 1) continue; // readyState 1 = HAVE_METADATA
    if (!Number.isFinite(v.duration)) {
      const srcKey = v.currentSrc || v.src || '';
      if (_durationForced.get(v) !== srcKey) {
        _durationForced.set(v, srcKey);
        v.addEventListener('durationchange', onMeta, { once: true });
        v.currentTime = 1e10; // seek past end → Chrome scans file → durationchange fires
      }
      return false; // always wait — do not proceed until durationchange fires
    }
  }
  return true;
}

// Convert a single clip entry using trace calibration. Returns true if the
// entry transitioned to converted during this call.
function convertClipEntry(clipEntry, video) {
  if (clipEntry._converted) return false;
  if (clipEntry._wcStart == null) { clipEntry._wcStart = clipEntry.start; clipEntry._wcEnd = clipEntry.end; }
  if (!canApplyTraceCalibration(clipEntry)) {
    // No trace calibration metadata — use raw clip times as-is (e.g. URL mode races)
    clipEntry._converted = true;
    return true;
  }
  // recordingStartTs − firstFrameTs gives the PTS offset (µs) where recording
  // started relative to the first captured frame; divide to get seconds.
  const tracePtsStart = (clipEntry.traceCalibration.recordingStartTs - clipEntry.traceCalibration.firstFrameTs) / US_PER_SECOND;
  if (!Number.isFinite(tracePtsStart) || tracePtsStart < 0) {
    // Invalid trace timestamps — use raw clip times as-is
    clipEntry._converted = true;
    return true;
  }
  applyCalibrationToClip(clipEntry, tracePtsStart, video.duration);
  return !!clipEntry._converted;
}

// Calibrate all clip entries; returns true if any entry was converted.
function calibrateClipTimes() {
  if (!clipTimes) return false;
  let convertedAny = false;
  for (let i = 0; i < clipTimes.length; i++) {
    if (!isValidClipEntry(clipTimes[i]) || !videos[i] || (videos[i].readyState < 1)) continue;
    if (convertClipEntry(clipTimes[i], videos[i])) convertedAny = true;
  }
  return convertedAny;
}

// After calibration converts clip entries, seek to the calibrated start and
// consume any pending seek.
function finalizeCalibration(convertedAny) {
  if (!videos.every(v => !v || v.readyState >= 1)) return;
  if (pendingSeek) {
    const fn = pendingSeek;
    pendingSeek = null;
    fn();
  }
  // Always seek to calibrated start after calibration converts clip entries,
  // even if the user already started playing or pendingSeek was consumed earlier.
  // This ensures the video visibly jumps to the correct frame.
  if (convertedAny) {
    pausePlayback();
    seekAllWithVerify(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
    updateTimeDisplay();
  }
}

function onMeta() {
  // Block calibration until every video has a finite duration.
  // readyState >= 1 (HAVE_METADATA) means the duration field is populated.
  // We must check ALL videos before proceeding: a second loadedmetadata
  // listener must not race ahead and run calibration while the 1e10 seek for
  // another video is still in progress.
  // Note: runs unconditionally (not gated on clipTimes) so full-recording
  // pages also get finite durations before any seek/UI is attempted.
  if (!ensureFiniteDurations()) return;

  duration = Math.max(...videos.filter(Boolean).map(v => v.duration || 0));
  const convertedAny = calibrateClipTimes();
  // Recompute segment clip times after calibration (they depend on traceTsToClipPts
  // which uses the now-calibrated traceCalibration data on clipTimes entries).
  // Skip for __all__ (uses base clipTimes) and __full__ (intentionally null).
  if (convertedAny && activeSegmentName && activeSegmentName !== '__all__' && activeSegmentName !== '__full__') {
    activeSegmentClipTimes = getSegmentClipTimes(activeSegmentName);
  }
  activeClip = resolveAdjustedClip();
  revealCalibrationToggle();
  buildSegmentNav();
  updateTimeDisplay();
  updateDebugStats();
  finalizeCalibration(convertedAny);
}

// --- Playback event handlers ---

// Clamp one video to its clip end and return its elapsed time within the clip.
function videoClipElapsed(v, vidClip) {
  if (vidClip && v.currentTime > vidClip.end) {
    v.currentTime = vidClip.end;
    v.pause();
  }
  const clamped = vidClip ? Math.min(v.currentTime, vidClip.end) : v.currentTime;
  return vidClip ? (clamped - vidClip.start) : (clamped - clipOffset());
}

// Largest per-video elapsed time, so playback tracks the slowest racer.
function maxClipElapsed(ct) {
  let elapsed = 0;
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (!v) continue;
    const vidClip = activeClip && ct && isValidClipEntry(ct[i]) ? ct[i] : null;
    const e = videoClipElapsed(v, vidClip);
    if (e > elapsed) elapsed = e;
  }
  return elapsed;
}

function onTimeUpdate() {
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  const elapsed = maxClipElapsed(ct);
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
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');

if (settingsToggle && settingsPanel) {
  settingsToggle.addEventListener('click', () => {
    const visible = settingsPanel.classList.toggle('visible');
    settingsToggle.classList.toggle('active', visible);
  });
}

const shareToggle = document.getElementById('shareToggle');
const shareMenu = document.getElementById('shareMenu');

if (shareToggle && shareMenu) {
  shareToggle.addEventListener('click', () => {
    const visible = shareMenu.classList.toggle('visible');
    shareToggle.classList.toggle('active', visible);
  });
  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!shareToggle.contains(e.target) && !shareMenu.contains(e.target)) {
      shareMenu.classList.remove('visible');
      shareToggle.classList.remove('active');
    }
  });
}

function setActiveMode(btn) {
  [modeRace, modeFull, modeMerged].forEach(b => b?.classList.remove('active'));
  btn?.classList.add('active');
}

function switchMode(targetSrcSet, targetVideos, modeBtn, opts) {
  pendingSeek = null;
  pausePlayback();
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
    // Merged mode switches to a video whose source never changed (it passes a
    // null srcSet and has no loadSrc), so 'loadedmetadata' may already have
    // fired and will not fire again — a deferred seek would never run, leaving
    // duration at 0 and the scrubber/end controls on an invalid range.
    if (!opts.loadSrc && primary && primary.readyState >= 1) {
      onMeta();
      opts.doSeek();
    } else {
      pendingSeek = opts.doSeek;
    }
  } else {
    onMeta();
    opts.doSeek();
  }
}

function hideCalibration() {
  setCalibrationVisible(false);
}

function resetSegmentState({ hide = false } = {}) {
  activeSegmentName = null;
  activeSegmentClipTimes = null;
  if (!segmentNav) return;
  segmentNav.value = '__all__';
  let segDisplay = 'none';
  if (!hide) segDisplay = segmentNavBuilt ? 'inline-block' : 'none';
  segmentNav.style.display = segDisplay;
}

function switchToRace() {
  switchMode('race', raceVideos, modeRace, {
    loadSrc() { raceVideos.forEach((v, i) => { v.src = resolvedRacePaths[i]; }); },
    onActivate() {
      playerContainer.style.display = 'flex';
      if (mergedContainer) mergedContainer.style.display = 'none';
      hideCalibration();
      resetSegmentState({ hide: false });
    },
    doSeek() {
      recalcActiveClip();
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
  setCalibrationVisible(debugPanel.style.display !== 'block');
}

// --- Mode button bindings ---

if (modeRace) modeRace.addEventListener('click', switchToRace);
if (modeFull) modeFull.addEventListener('click', switchToFull);
if (modeMerged) modeMerged.addEventListener('click', switchToMerged);
if (modeDebug) modeDebug.addEventListener('click', toggleCalibration);
if (mergedVideo) mergedVideo.addEventListener('loadedmetadata', () => {
  if (videos.includes(mergedVideo)) {
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

// A native <select> keeps focus after a pick, and the shortcuts below stand
// aside for a focused select (its own arrow keys move through the options) — so
// choosing a speed silently killed frame stepping until something else took
// focus. That bites hardest in fullscreen, where the controls fade out and
// nothing shows what holds focus. Release focus after a pointer-driven pick;
// a keyboard user is still walking the options with those same arrows, so leave
// their focus where it is.
let speedPickedByPointer = false;
speedSelect.addEventListener('pointerdown', () => { speedPickedByPointer = true; });
speedSelect.addEventListener('keydown', () => { speedPickedByPointer = false; });
speedSelect.addEventListener('blur', () => { speedPickedByPointer = false; });

speedSelect.addEventListener('change', () => {
  const rate = Number.parseFloat(speedSelect.value);
  videos.forEach(v => { if (v) v.playbackRate = rate; });
  if (speedPickedByPointer) speedSelect.blur();
});

function stepFrame(delta) {
  pausePlayback();
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

document.getElementById('prevFrame').addEventListener('click', () => stepFrame(-FRAME_STEP));
document.getElementById('nextFrame').addEventListener('click', () => stepFrame(FRAME_STEP));

function goToStart() {
  pausePlayback();
  seekAll(activeClip ? activeClip.start : 0);
  scrubber.value = 0;
  updateTimeDisplay();
}

function goToEnd() {
  pausePlayback();
  seekAll(activeClip ? activeClip.end : duration);
  scrubber.value = 1000;
  updateTimeDisplay();
}

document.getElementById('goStart').addEventListener('click', goToStart);
document.getElementById('goEnd').addEventListener('click', goToEnd);

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-FRAME_STEP); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(FRAME_STEP); }
  else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  else if (e.key === 'Home') { e.preventDefault(); goToStart(); }
  else if (e.key === 'End') { e.preventDefault(); goToEnd(); }
  else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
});

// --- Notes: persist in localStorage ---

const notesTextarea = document.getElementById('notesTextarea');
if (notesTextarea) {
  const notesKey = 'race-notes:' + location.pathname;
  try {
    const stored = localStorage.getItem(notesKey);
    // Use stored value if present; otherwise keep any baked-in content (from export)
    if (stored !== null) notesTextarea.value = stored;
  } catch (e) { /* storage unavailable (privacy mode / sandboxed) */ }

  let notesTimer;
  const saveNotes = () => { try { localStorage.setItem(notesKey, notesTextarea.value); } catch (e) {} };
  notesTextarea.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(saveNotes, 400); });
  notesTextarea.addEventListener('blur', saveNotes);
  window.addEventListener('beforeunload', saveNotes, { once: true });
}
