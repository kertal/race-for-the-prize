/* eslint-env browser */
/**
 * segments.js — Settings UI built at runtime: the segment navigation
 * dropdown (whole recording / race clip / per-measurement segments) and
 * the racer visibility filter (3+ racers).
 */

// Distinct measurement names across all clips, in first-seen order.
function collectSegmentNames() {
  const seen = new Set();
  const names = [];
  for (const ct of clipTimes) {
    if (!ct?.measurements) continue;
    for (const m of ct.measurements) {
      if (m.name && !seen.has(m.name)) { seen.add(m.name); names.push(m.name); }
    }
  }
  return names;
}

// Switch back to race-clip videos if currently in whole-recording (full) mode.
function ensureRaceMode(callback) {
  if (fullVideoPaths && loadedSrcSet === 'full') {
    loadVideoSet('race', () => { raceVideos.forEach((v, i) => { v.src = resolvedRacePaths[i]; }); }, callback);
  } else {
    callback();
  }
}

// Seek to the start of the active race clip after (re)entering race mode.
function seekToActiveClipStart() {
  recalcActiveClip();
  seekAll(activeClip ? activeClip.start : 0);
  scrubber.value = 0;
  updateTimeDisplay();
}

function selectFullRecording() {
  setActiveSegment('__full__', null);
  const doSeek = seekToWholeRecordingStart;
  if (fullVideoPaths && loadedSrcSet !== 'full') {
    loadVideoSet('full', () => { raceVideos.forEach((v, i) => { v.src = resolvedFullPaths[i]; }); }, doSeek);
  } else {
    doSeek();
  }
}

function onSegmentChange(val) {
  if (val === '__full__') {
    selectFullRecording();
  } else if (val === '__all__') {
    setActiveSegment(null, null);
    ensureRaceMode(seekToActiveClipStart);
  } else {
    setActiveSegment(val, getSegmentClipTimes(val));
    ensureRaceMode(seekToActiveClipStart);
  }
}

function buildSegmentNav() {
  if (segmentNavBuilt || !clipTimes) return;
  if (!segmentNav) return;
  if (!clipTimes.every(ct => !ct || ct._wcStart != null)) return;
  const names = collectSegmentNames();
  if (names.length < 1) return;
  markSegmentNavBuilt();
  segmentNav.replaceChildren();

  // Build dropdown options
  const fullOpt = document.createElement('option');
  fullOpt.value = '__full__';
  fullOpt.textContent = 'Whole Recording';
  segmentNav.appendChild(fullOpt);

  const allOpt = document.createElement('option');
  allOpt.value = '__all__';
  allOpt.textContent = 'Race Recording';
  allOpt.selected = true;
  segmentNav.appendChild(allOpt);

  if (names.length > 1) {
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      segmentNav.appendChild(opt);
    }
  }

  segmentNav.addEventListener('change', () => onSegmentChange(segmentNav.value));

  segmentNav.style.display = 'inline-block';
  if (modeDebug) modeDebug.style.display = '';
}

function buildRacerFilter() {
  const filterEl = document.getElementById('racerFilter');
  if (!filterEl) return;
  const racerDivs = playerContainer ? playerContainer.querySelectorAll('.racer') : [];
  for (let i = 0; i < raceVideos.length; i++) {
    const btn = document.createElement('button');
    btn.className = 'racer-filter-btn active';
    btn.style.setProperty('--racer-color', racerColors[i]);
    btn.textContent = racerNames[i];
    btn.dataset.idx = i;
    filterEl.appendChild(btn);
  }
  filterEl.style.display = 'flex';
  filterEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.racer-filter-btn');
    if (!btn) return;
    const idx = Number.parseInt(btn.dataset.idx, 10);
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
    recalcActiveClip();
    seekAll(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
    updateTimeDisplay();
  });
}
