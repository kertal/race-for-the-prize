/* eslint-env browser */
/**
 * debug-panel.js — Calibration/debug panel UI: per-video stats, timing
 * event tables, frame-position readouts, per-racer frame-offset
 * adjustment, and the panel's click delegation.
 */

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
    events.push({ label: 'Context created', wc: -(ct.recordingOffset || 0), ptsVal: 0 });
    events.push({ label: 'recordingStartTime (t=0)', wc: 0, ptsVal: toPts(0) });
    events.push({ label: 'raceRecordingStart()', wc: wcStart, ptsVal: ct.start });
    const measurements = ct.measurements || [];
    for (const element of measurements) {
      const meas = element;
      let startPts;
      if (Number.isFinite(meas.startTraceTs)) {
        startPts = traceTsToClipPts(ct, meas.startTraceTs);
      } else {
        startPts = meas.startTime != null ? toPts(meas.startTime) : null;
      }
      let endPts;
      if (Number.isFinite(meas.endTraceTs)) {
        endPts = traceTsToClipPts(ct, meas.endTraceTs);
      } else {
        endPts = meas.endTime != null ? toPts(meas.endTime) : null;
      }
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
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
  activeClip = resolveAdjustedClip();
  // Force each video to seek to its adjusted start and render the frame.
  // Use direct per-video currentTime assignment + pause to guarantee a visible update.
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  videos.forEach((v, i) => {
    if (!v) return;
    const target = (activeClip && ct && isValidClipEntry(ct[i])) ? ct[i].start : (activeClip ? activeClip.start : 0);
    v.currentTime = Math.min(target, v.duration || target);
  });
  updateFramePositions();
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
      if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }
      activeClip = resolveAdjustedClip();
      const adj = getAdjustedClipTimes();
      const ct = adj || clipTimes;
      videos.forEach((v, i) => {
        if (!v) return;
        const target = (activeClip && ct && isValidClipEntry(ct[i])) ? ct[i].start : (activeClip ? activeClip.start : 0);
        v.currentTime = Math.min(target, v.duration || target);
      });
      updateFramePositions();
      scrubber.value = 0;
      updateTimeDisplay();
    }
  });
}
