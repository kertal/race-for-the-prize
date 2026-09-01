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

function fmtSeconds(val) {
  return val != null && Number.isFinite(val) ? val.toFixed(3) + 's' : '\u2014';
}

function toFrame(pts) {
  return pts != null && Number.isFinite(pts) ? Math.round(pts / 0.04) : null;
}

function fmtFrame(pts) {
  const f = toFrame(pts);
  return f != null ? '#' + f : '\u2014';
}

function buildTimingCell(text, className, useBold) {
  const span = document.createElement('span');
  span.className = className;
  if (useBold) {
    const b = document.createElement('b');
    b.textContent = text;
    span.appendChild(b);
  } else {
    span.textContent = text;
  }
  return span;
}

function buildTimingRow(ev, bold) {
  const div = document.createElement('div');
  div.className = 'debug-timing-event';
  const cols = [
    ev.label,
    typeof ev.wc === 'string' ? ev.wc : fmtSeconds(ev.wc),
    typeof ev.ptsVal === 'string' ? ev.ptsVal : fmtSeconds(ev.ptsVal),
    ev.frame != null ? ev.frame : fmtFrame(ev.ptsVal),
  ];
  const classes = ['debug-timing-label', 'debug-timing-val', 'debug-timing-val', 'debug-timing-val'];
  const useBold = bold || ev.bold;
  for (let c = 0; c < cols.length; c++) {
    div.appendChild(buildTimingCell(cols[c], classes[c], useBold));
  }
  return div;
}

// Wall-clock → clip-PTS mapper for a single clip entry.
function makeWcToPts(ct, wcStart, wcEnd) {
  return (wc) => {
    const wcDur = wcEnd - wcStart;
    const ptsDur = ct.end - ct.start;
    if (wcDur <= 0) return null;
    return ct.start + (wc - wcStart) / wcDur * ptsDur;
  };
}

function measurementPts(meas, ct, traceTs, wallTime, toPts) {
  if (Number.isFinite(traceTs)) return traceTsToClipPts(ct, traceTs);
  return wallTime != null ? toPts(wallTime) : null;
}

function buildTimingEvents(ct, v, wcStart, wcEnd, toPts) {
  const events = [
    { label: 'Context created', wc: -(ct.recordingOffset || 0), ptsVal: 0 },
    { label: 'recordingStartTime (t=0)', wc: 0, ptsVal: toPts(0) },
    { label: 'raceRecordingStart()', wc: wcStart, ptsVal: ct.start },
  ];
  const measurements = ct.measurements || [];
  for (const meas of measurements) {
    if (meas.startTime != null || Number.isFinite(meas.startTraceTs)) {
      const startPts = measurementPts(meas, ct, meas.startTraceTs, meas.startTime, toPts);
      events.push({ label: 'raceStart("' + (meas.name || '') + '")', wc: meas.startTime, ptsVal: startPts });
    }
    if (meas.endTime != null || Number.isFinite(meas.endTraceTs)) {
      const endPts = measurementPts(meas, ct, meas.endTraceTs, meas.endTime, toPts);
      events.push({ label: 'raceEnd("' + (meas.name || '') + '")', wc: meas.endTime, ptsVal: endPts });
    }
  }
  events.push(
    { label: 'raceRecordingEnd()', wc: wcEnd, ptsVal: ct.end },
    { label: 'Pre-close', wc: ct.wallClockDuration || null, ptsVal: v.duration },
    { label: 'Calibration mode', wc: 'trace-only', ptsVal: 'trace ts', frame: '\u2014', bold: true },
  );
  return events;
}

function activeClipEntry(adjusted, i) {
  if (adjusted) return adjusted[i];
  return clipTimes ? clipTimes[i] : null;
}

function renderVideoStatsRow(i, adjusted) {
  const row = document.getElementById('debugStatsRow' + i);
  const v = raceVideos[i];
  if (!row || !v?.duration) return;
  const dur = v.duration.toFixed(2) + 's';
  const res = v.videoWidth + 'x' + v.videoHeight;
  let framesText = '\u2014';
  let droppedText = '\u2014';
  if (typeof v.getVideoPlaybackQuality === 'function') {
    const q = v.getVideoPlaybackQuality();
    framesText = String(q.totalVideoFrames);
    droppedText = String(q.droppedVideoFrames);
  }
  const activeCt = activeClipEntry(adjusted, i);
  const clipDur = activeCt ? ' (clip: ' + (activeCt.end - activeCt.start).toFixed(2) + 's)' : '';
  clearRowKeepName(row);
  appendSpan(row, 'duration: ' + dur + clipDur);
  appendSpan(row, 'frames: ' + framesText + ' dropped: ' + droppedText);
  appendSpan(row, 'resolution: ' + res);
}

function renderTimingEventsRow(i) {
  const eventsEl = document.getElementById('debugTimingEvents' + i);
  if (!eventsEl) return;
  const v = raceVideos[i];
  const ct = clipTimes ? clipTimes[i] : null;
  if (!ct || !v?.duration) {
    eventsEl.replaceChildren();
    const noData = document.createElement('span');
    noData.style.color = '#777';
    noData.textContent = 'No timing data';
    eventsEl.appendChild(noData);
    return;
  }
  const wcStart = ct._wcStart != null ? ct._wcStart : ct.start;
  const wcEnd = ct._wcEnd != null ? ct._wcEnd : ct.end;
  const events = buildTimingEvents(ct, v, wcStart, wcEnd, makeWcToPts(ct, wcStart, wcEnd));
  eventsEl.replaceChildren();
  eventsEl.appendChild(buildTimingRow({ label: 'Event', wc: 'Wall-clock', ptsVal: 'Video time', frame: 'Frame' }, true));
  for (const ev of events) {
    eventsEl.appendChild(buildTimingRow(ev, false));
  }
}

function updateDebugStats() {
  const statsEl = document.getElementById('debugStats');
  if (statsEl?.offsetParent == null) return;
  const adjusted = getAdjustedClipTimes();
  for (let i = 0; i < raceVideos.length; i++) renderVideoStatsRow(i, adjusted);
  for (let i = 0; i < raceVideos.length; i++) renderTimingEventsRow(i);
}

// --- Debug panel: frame positions ---

function updateFramePositions() {
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  for (let i = 0; i < raceVideos.length; i++) {
    const row = document.getElementById('debugFrameRow' + i);
    if (!row) continue;
    const v = raceVideos[i];
    if (!v?.duration) continue;
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
    const startVal = adj?.[i] ? adj[i].start.toFixed(3) : '0.000';
    el.textContent = 'start: ' + startVal + 's (' + sign + frames + 'f)';
  }
}

function clipStartTarget(ct, i) {
  if (activeClip && ct && isValidClipEntry(ct[i])) return ct[i].start;
  return activeClip ? activeClip.start : 0;
}

function adjustDebugOffset(idx, frameDelta) {
  if (!clipTimes?.[idx]) return;
  let newOffset = debugOffsets[idx] + frameDelta * FRAME_STEP;
  const newStart = clipTimes[idx].start + newOffset;
  if (newStart < 0) newOffset = -clipTimes[idx].start;
  if (newStart >= clipTimes[idx].end) return;
  debugOffsets[idx] = newOffset;
  updateDebugDisplay();
  updateDebugStats();
  pausePlayback();
  recalcActiveClip();
  // Force each video to seek to its adjusted start and render the frame.
  // Use direct per-video currentTime assignment + pause to guarantee a visible update.
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  videos.forEach((v, i) => {
    if (!v) return;
    const target = clipStartTarget(ct, i);
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
      const idx = Number.parseInt(btn.dataset.idx, 10);
      const delta = Number.parseInt(btn.dataset.delta, 10);
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
      pausePlayback();
      recalcActiveClip();
      const adj = getAdjustedClipTimes();
      const ct = adj || clipTimes;
      videos.forEach((v, i) => {
        if (!v) return;
        const target = clipStartTarget(ct, i);
        v.currentTime = Math.min(target, v.duration || target);
      });
      updateFramePositions();
      scrubber.value = 0;
      updateTimeDisplay();
    }
  });
}
