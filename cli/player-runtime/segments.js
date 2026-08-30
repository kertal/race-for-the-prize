/* eslint-env browser */
/**
 * segments.js — Settings UI built at runtime: the segment navigation
 * dropdown (whole recording / race clip / per-measurement segments) and
 * the racer visibility filter (3+ racers).
 */

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

  segmentNav.addEventListener('change', () => {
    const val = segmentNav.value;
    if (val === '__full__') {
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
    } else if (val === '__all__') {
      activeSegmentName = null;
      activeSegmentClipTimes = null;
      ensureRaceMode(() => {
        activeClip = resolveAdjustedClip();
        seekAll(activeClip ? activeClip.start : 0);
        scrubber.value = 0;
        updateTimeDisplay();
      });
    } else {
      activeSegmentName = val;
      activeSegmentClipTimes = getSegmentClipTimes(val);
      ensureRaceMode(() => {
        activeClip = resolveAdjustedClip();
        seekAll(activeClip ? activeClip.start : 0);
        scrubber.value = 0;
        updateTimeDisplay();
      });
    }
  });

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
