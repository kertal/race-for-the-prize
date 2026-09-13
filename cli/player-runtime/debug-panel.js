/* eslint-env browser */
/**
 * debug-panel.js — Calibration/debug panel UI: panel visibility, per-video
 * stats, timing event tables, frame-position readouts, the on-video frame
 * badges, per-racer frame-offset adjustment, and the panel's click delegation.
 */

// --- Calibration mode visibility ---

// Calibration is independent of segment navigation: the toggle is revealed as
// soon as the page has a panel and at least one usable clip window. It used to
// be revealed from buildSegmentNav(), which bails out for races whose specs
// never call raceStart()/raceEnd() — leaving manual calibration unreachable.
function revealCalibrationToggle() {
  if (!debugPanel || !modeDebug || !clipTimes) return;
  if (!clipTimes.some(isValidClipEntry)) return;
  modeDebug.style.display = '';
}

function calibrationVisible() {
  return !!debugPanel && debugPanel.style.display === 'block';
}

function setCalibrationVisible(on) {
  if (!debugPanel) return;
  debugPanel.style.display = on ? 'block' : 'none';
  modeDebug?.classList.toggle('active', on);
  playerContainer?.classList.toggle('show-frame-badges', on);
  if (!on) return;
  updateDebugDisplay();
  updateDebugStats();
  updateFramePositions();
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

function fmtSeconds(val) {
  return val != null && Number.isFinite(val) ? val.toFixed(3) + 's' : '\u2014';
}

function toFrame(pts) {
  return pts != null ? timeToFrame(pts) : null;
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
    noData.className = 'debug-timing-empty';
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

// --- Frame readouts ---

// mediaTime of the frame each racer's compositor last presented, so the
// readouts name the frame that is actually on screen. currentTime is only the
// seek target and can sit up to a frame ahead of the visible picture.
const presentedTimes = raceVideos.map(() => null);

// Time to report for a video: the presented frame's mediaTime when it still
// describes where the video is, otherwise currentTime (a seek that has not
// painted yet leaves the previous mediaTime behind).
function displayedTime(v, i) {
  const presented = presentedTimes[i];
  if (presented != null && Math.abs(presented - v.currentTime) <= FRAME_STEP) return presented;
  return v.currentTime;
}

// Keep presentedTimes fresh. requestVideoFrameCallback fires once per painted
// frame (Chrome, including after a seek); without it the readouts fall back to
// currentTime, which is close enough to keep calibration usable.
function trackPresentedFrames() {
  raceVideos.forEach((v, i) => {
    if (!v || typeof v.requestVideoFrameCallback !== 'function') return;
    const onFrame = (_now, metadata) => {
      presentedTimes[i] = metadata.mediaTime;
      if (calibrationVisible()) renderFrameBadge(i, getAdjustedClipTimes() || clipTimes);
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  });
}

// The frame number painted over one racer's video.
function renderFrameBadge(i, ct) {
  const badge = document.getElementById('frameBadge' + i);
  if (!badge) return;
  const v = raceVideos[i];
  const readout = v ? frameReadout(displayedTime(v, i), ct ? ct[i] : null) : null;
  badge.replaceChildren();
  if (!readout) { badge.textContent = '\u2014'; return; }
  const frameEl = document.createElement('span');
  frameEl.className = 'frame-badge-num';
  frameEl.textContent = 'f ' + readout.frame;
  badge.appendChild(frameEl);
  if (readout.clipFrame == null) return;
  const clipEl = document.createElement('span');
  clipEl.className = 'frame-badge-clip';
  clipEl.textContent = 'clip ' + readout.clipFrame + '/' + readout.clipTotal;
  badge.appendChild(clipEl);
}

// Every badge, while calibration is open. Nothing to draw when the panel is
// closed — the badges are hidden and get a fresh pass from
// setCalibrationVisible() the moment it reopens.
function updateFrameBadges() {
  if (!calibrationVisible()) return;
  const ct = getAdjustedClipTimes() || clipTimes;
  for (let i = 0; i < raceVideos.length; i++) renderFrameBadge(i, ct);
}

// --- Debug panel: frame positions ---

function updateFramePositions() {
  updateFrameBadges();
  const ct = getAdjustedClipTimes() || clipTimes;
  for (let i = 0; i < raceVideos.length; i++) {
    const row = document.getElementById('debugFrameRow' + i);
    if (!row) continue;
    const v = raceVideos[i];
    if (!v?.duration) continue;
    clearRowKeepName(row);
    const readout = frameReadout(displayedTime(v, i), ct ? ct[i] : null);
    const totalFrames = timeToFrame(v.duration);
    if (!readout) { appendSpan(row, '\u2014'); continue; }
    if (readout.clipFrame != null) {
      appendSpan(row, 'clip: ' + readout.clipFrame + ' / ' + readout.clipTotal);
      appendSpan(row, 'full: ' + readout.frame + ' / ' + totalFrames);
      appendSpan(row, 'range: ' + readout.clipStart + '\u2013' + readout.clipEnd);
    } else {
      appendSpan(row, 'full: ' + readout.frame + ' / ' + totalFrames);
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

// The windows an offset shifts within: a selected segment when one is active,
// else the race clip. Offsets are applied on top of these, so the bounds have
// to come from them too — clamping against the raw clip entry let an offset
// push a selected segment past its own end, freezing that racer on a blank
// frame.
function offsetWindows() {
  return activeSegmentClipTimes || clipTimes;
}

function offsetBase(idx) {
  const base = offsetWindows();
  return base ? base[idx] : null;
}

// Nudge one racer relative to the others. planOffsetNudge() decides how much of
// the move the clicked racer can absorb itself and how much the others have to
// give, so a button only does nothing when no racer has any room left at all.
function adjustDebugOffset(idx, frameDelta) {
  const next = planOffsetNudge(offsetWindows(), debugOffsets, idx, frameDelta);
  if (!next) return;
  for (let i = 0; i < debugOffsets.length; i++) debugOffsets[i] = next[i];
  saveDebugOffsets();
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

// Start following presented frames now: the badges read whatever the loop has
// recorded by the time calibration is first opened.
trackPresentedFrames();

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
      saveDebugOffsets();
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
