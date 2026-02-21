/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * video player for race results. Supports 2-5 racers.
 *
 * The HTML structure and CSS live in player.html (a real HTML template).
 * This module builds the dynamic sections and injects them via {{placeholder}}
 * replacement, keeping presentation separate from data logic.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROFILE_METRICS } from './profile-analysis.js';
import { getPlacementOrder } from './summary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'player.html'), 'utf-8');

const RACER_CSS_COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f1c40f', '#9b59b6'];

// ---------------------------------------------------------------------------
// Template renderer — replaces {{key}} placeholders with values
// ---------------------------------------------------------------------------

function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a string for safe embedding in HTML text/attribute contexts. */
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Build sorted bar-chart HTML rows for a single metric. */
function buildMetricRowsHtml(entries, winner, formatDelta) {
  const nonNullVals = entries.filter(e => e.val !== null).map(e => e.val);
  const maxVal = nonNullVals.length > 0 ? Math.max(...nonNullVals) : 0;
  const bestVal = entries[0]?.val;
  let html = '';
  for (const entry of entries) {
    const color = RACER_CSS_COLORS[entry.index % RACER_CSS_COLORS.length];
    const barPct = entry.val !== null && maxVal > 0 ? Math.round((entry.val / maxVal) * 100) : 0;
    let delta = '';
    if (entry.val !== null && bestVal !== null && entry.val !== bestVal) {
      delta = `<span class="profile-delta">(+${formatDelta(entry.val - bestVal)})</span>`;
    }
    html += `
        <div class="profile-row">
          <span class="profile-racer" style="color: ${color}">${escHtml(entry.name)}</span>
          <span class="profile-bar-track">
            <span class="profile-bar-fill" style="width: ${barPct}%; background: ${color}"></span>
          </span>
          <span class="profile-value">${escHtml(entry.formatted)}${delta}</span>
          ${winner === entry.name ? '<span class="profile-medal">&#127942;</span>' : ''}
        </div>`;
  }
  return html;
}

/** Sort racers by value ascending (best first), nulls last. */
function sortByValue(racers, getValue) {
  return racers
    .map((name, i) => ({ name, index: i, ...getValue(i) }))
    .sort((a, b) => {
      if (a.val === null) return 1;
      if (b.val === null) return -1;
      return a.val - b.val;
    });
}

// ---------------------------------------------------------------------------
// Section Builders — each returns an HTML string (or '' if nothing to show)
// ---------------------------------------------------------------------------

function buildRunNavHtml(runNav) {
  if (!runNav) return '';
  const { currentRun, totalRuns, pathPrefix } = runNav;
  let html = `<div class="run-nav">`;
  for (let i = 1; i <= totalRuns; i++) {
    const isCurrent = currentRun === i;
    const cls = isCurrent ? 'run-nav-btn active' : 'run-nav-btn';
    if (isCurrent) {
      html += `<span class="${cls}" aria-current="page">Run ${i}</span>`;
    } else {
      html += `<a class="${cls}" href="${escHtml(pathPrefix)}${i}/index.html">Run ${i}</a>`;
    }
  }
  const isMedianCurrent = currentRun === 'median';
  const medianCls = isMedianCurrent ? 'run-nav-btn active' : 'run-nav-btn';
  if (isMedianCurrent) {
    html += `<span class="${medianCls}" aria-current="page">Median</span>`;
  } else {
    html += `<a class="${medianCls}" href="${escHtml(pathPrefix)}index.html">Median</a>`;
  }
  html += `</div>`;
  return html;
}

function buildRaceInfoHtml(summary) {
  const { racers, settings, timestamp } = summary;
  const rows = [];
  if (timestamp) rows.push(`<tr><td>Date</td><td>${escHtml(new Date(timestamp).toISOString())}</td></tr>`);
  racers.forEach((r, i) => rows.push(`<tr><td>Racer ${i + 1}</td><td>${escHtml(r)}</td></tr>`));
  if (settings) {
    const mode = settings.parallel === false ? 'sequential' : 'parallel';
    rows.push(`<tr><td>Mode</td><td>${mode}</td></tr>`);
    if (settings.network && settings.network !== 'none') rows.push(`<tr><td>Network</td><td>${escHtml(settings.network)}</td></tr>`);
    if (settings.cpuThrottle && settings.cpuThrottle > 1) rows.push(`<tr><td>CPU Throttle</td><td>${settings.cpuThrottle}x</td></tr>`);
    if (settings.format && settings.format !== 'webm') rows.push(`<tr><td>Format</td><td>${escHtml(settings.format)}</td></tr>`);
    if (settings.headless) rows.push(`<tr><td>Headless</td><td>yes</td></tr>`);
    if (settings.runs && settings.runs > 1) rows.push(`<tr><td>Runs</td><td>${settings.runs}</td></tr>`);
  }
  if (rows.length === 0) return '';
  return `<div class="race-info"><table>${rows.join('')}</table></div>`;
}

function buildErrorsHtml(errors) {
  if (!errors || errors.length === 0) return '';
  return `<div class="errors"><ul>${errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul></div>`;
}

function buildResultsHtml(comparisons, racers, clickCounts) {
  let html = '';
  for (const comp of comparisons) {
    const sorted = sortByValue(racers, i => {
      const r = comp.racers[i];
      return { val: r ? r.duration : null, formatted: r ? `${r.duration.toFixed(3)}s` : '-' };
    });
    html += `<div class="profile-metric">
        <div class="profile-metric-name">${escHtml(comp.name)}</div>${buildMetricRowsHtml(sorted, comp.winner, v => `${v.toFixed(3)}s`)}</div>\n`;
  }
  if (clickCounts) {
    const total = racers.reduce((sum, r) => sum + (clickCounts[r] || 0), 0);
    if (total > 0) {
      const maxCount = Math.max(...racers.map(r => clickCounts[r] || 0));
      html += `<div class="profile-metric">
        <div class="profile-metric-name">Clicks</div>${racers.map((r, i) => {
        const count = clickCounts[r] || 0;
        const barPct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
        const color = RACER_CSS_COLORS[i % RACER_CSS_COLORS.length];
        return `
        <div class="profile-row">
          <span class="profile-racer" style="color: ${color}">${escHtml(r)}</span>
          <span class="profile-bar-track">
            <span class="profile-bar-fill" style="width: ${barPct}%; background: ${color}"></span>
          </span>
          <span class="profile-value">${count}</span>
        </div>`;
      }).join('')}</div>\n`;
    }
  }
  return html;
}

function buildProfileHtml(profileComparison, racers) {
  if (!profileComparison) return '';
  const { measured, total } = profileComparison;
  if (measured.comparisons.length === 0 && total.comparisons.length === 0) return '';

  let html = `<div class="section">
  <h2>Performance Profile</h2>
  <p class="profile-note">Lower values are better for all metrics</p>\n`;

  const scopes = [
    ['During Measurement (raceStart \u2192 raceEnd)', measured],
    ['Total Session', total],
  ];
  for (const [title, section] of scopes) {
    if (section.comparisons.length === 0) continue;
    html += `<h3>${escHtml(title)}</h3>\n`;
    for (const [category, comps] of Object.entries(section.byCategory)) {
      html += `<h4>${category[0].toUpperCase() + category.slice(1)}</h4>\n`;
      for (const comp of comps) {
        const sorted = sortByValue(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }));
        const formatDelta = PROFILE_METRICS[comp.key].format;
        html += `<div class="profile-metric">
        <div class="profile-metric-name">${escHtml(comp.name)}</div>${buildMetricRowsHtml(sorted, comp.winner, formatDelta)}</div>\n`;
      }
    }
    if (section.overallWinner === 'tie') {
      html += `<div class="profile-winner">&#129309; Tie!</div>`;
    } else if (section.overallWinner) {
      const idx = racers.indexOf(section.overallWinner);
      html += `<div class="profile-winner">&#127942; <span style="color: ${RACER_CSS_COLORS[idx % RACER_CSS_COLORS.length]}">${escHtml(section.overallWinner)}</span> wins!</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function buildFilesHtml(racers, videoFiles, options) {
  const { fullVideoFiles, mergedVideoFile, traceFiles, altFormat, altFiles, placementOrder } = options;
  const links = [];
  const order = placementOrder || racers.map((_, i) => i);

  order.forEach(i => {
    if (videoFiles[i]) links.push(`<a href="${escHtml(videoFiles[i])}">${escHtml(racers[i])} (race)</a>`);
  });
  if (fullVideoFiles) {
    order.forEach(i => {
      if (fullVideoFiles[i]) links.push(`<a href="${escHtml(fullVideoFiles[i])}">${escHtml(racers[i])} (full)</a>`);
    });
  }
  if (mergedVideoFile) {
    links.push(`<a href="${escHtml(mergedVideoFile)}">side-by-side</a>`);
  }
  if (altFormat && altFiles) {
    order.forEach(i => {
      if (altFiles[i]) links.push(`<a href="${escHtml(altFiles[i])}" download>${escHtml(racers[i])} (.${escHtml(altFormat)})</a>`);
    });
  }
  if (traceFiles) {
    order.forEach(i => {
      if (traceFiles[i]) links.push(`<a href="${escHtml(traceFiles[i])}" title="Open in chrome://tracing or ui.perfetto.dev">${escHtml(racers[i])} (profile)</a>`);
    });
  }

  if (links.length === 0) return '';

  return `<div class="section">
  <h2>Files</h2>
  <div class="file-links">
    ${links.join('\n    ')}
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Debug Panel Builder — per-racer clip start calibration controls
// ---------------------------------------------------------------------------

function buildDebugPanelHtml(racers, placementOrder, clipTimes) {
  const orderedClipTimes = placementOrder.map(i => clipTimes[i] || null);
  let rows = '';
  placementOrder.forEach((origIdx, displayIdx) => {
    const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
    const clip = orderedClipTimes[displayIdx];
    const startVal = clip ? clip.start.toFixed(3) : '0.000';
    rows += `
    <div class="debug-row" data-debug-idx="${displayIdx}">
      <span class="racer-name" style="color: ${color}">${escHtml(racers[origIdx])}</span>
      <span class="start-info" id="debugStart${displayIdx}">start: ${startVal}s (+0f)</span>
      <button class="debug-frame-btn" data-idx="${displayIdx}" data-delta="-5">-5f</button>
      <button class="debug-frame-btn" data-idx="${displayIdx}" data-delta="-1">-1f</button>
      <button class="debug-frame-btn" data-idx="${displayIdx}" data-delta="1">+1f</button>
      <button class="debug-frame-btn" data-idx="${displayIdx}" data-delta="5">+5f</button>
    </div>`;
  });

  return `<div class="debug-panel" id="debugPanel">
  <h3>DEBUG: Clip Start Calibration</h3>${rows}
  <div class="debug-stats" id="debugStats">
    <div class="debug-stats-header">VIDEO INFO</div>
${placementOrder.map((origIdx, displayIdx) => {
    const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
    return `    <div class="debug-stats-row" id="debugStatsRow${displayIdx}">
      <span class="racer-name" style="color: ${color}">${escHtml(racers[origIdx])}</span>
      <span>duration: \u2014</span>
      <span>frames: \u2014 dropped: \u2014</span>
      <span>resolution: \u2014</span>
    </div>`;
  }).join('\n')}
  </div>
  <div class="debug-footer">
    <span>1 frame = 0.040s (25fps)</span>
    <button class="debug-action-btn" id="debugCopyJson">Copy JSON</button>
    <button class="debug-action-btn" id="debugResetAll">Reset All</button>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Player Section Builder — returns player container + controls (or '' if no videos)
// ---------------------------------------------------------------------------

function buildPlayerSectionHtml(videoElements, mergedVideoElement, debugPanelHtml) {
  return `<div class="player-container" id="playerContainer">
${videoElements}
</div>
${mergedVideoElement}
${debugPanelHtml || ''}

<div class="controls">
  <div class="controls-row">
    <button class="frame-btn" id="prevFrame" title="-0.1s (\u2190)">\u25C0\u25C0</button>
    <button class="play-btn" id="playBtn">\u25B6</button>
    <button class="frame-btn" id="nextFrame" title="+0.1s (\u2192)">\u25B6\u25B6</button>
    <input type="range" class="scrubber" id="scrubber" min="0" max="1000" value="0">
  </div>
  <span class="time-display" id="timeDisplay">0:00.000 / 0:00.000</span>
  <span class="frame-display" id="frameDisplay">0.0s</span>
  <select class="speed-select" id="speedSelect">
    <option value="0.25">0.25x</option>
    <option value="0.5">0.5x</option>
    <option value="1" selected>1x</option>
    <option value="2">2x</option>
  </select>
  <button class="export-btn" id="exportBtn" title="Export side-by-side video">Export</button>
</div>`;
}

// ---------------------------------------------------------------------------
// Player Script Builder
// ---------------------------------------------------------------------------

function buildPlayerScript(config) {
  const { videoVars, videoArray, raceVideoPaths, fullVideoPaths, clipTimesJson, hasDebug, racerNamesJson, racerColorsJson, hasMergedVideo } = config;
  return `<script>
(function() {
  ${videoVars}
  const raceVideos = ${videoArray};
  const raceVideoPaths = ${raceVideoPaths};
  const fullVideoPaths = ${fullVideoPaths};
  const clipTimes = ${clipTimesJson};
  const racerNames = ${racerNamesJson || '[]'};
  const racerColors = ${racerColorsJson || '[]'};
  const mergedVideo = document.getElementById('mergedVideo');
  const playerContainer = document.getElementById('playerContainer');
  const mergedContainer = document.getElementById('mergedContainer');

  let videos = raceVideos;
  let primary = videos[0];
  const playBtn = document.getElementById('playBtn');
  const scrubber = document.getElementById('scrubber');
  const timeDisplay = document.getElementById('timeDisplay');
  const frameDisplay = document.getElementById('frameDisplay');
  const speedSelect = document.getElementById('speedSelect');

  let playing = false;
  let duration = 0;
  let activeClip = null; // { start, end } when clipping is active
  const STEP = 0.1; // 100ms step — reliable even with dropped frames

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 1000);
    return m + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }

  function getTime(t) {
    return t.toFixed(1) + 's';
  }

  function clipOffset() {
    return activeClip ? activeClip.start : 0;
  }

  function clipDuration() {
    return activeClip ? (activeClip.end - activeClip.start) : duration;
  }

  function updateTimeDisplay() {
    const raw = primary.currentTime || 0;
    const t = raw - clipOffset();
    const d = clipDuration();
    timeDisplay.textContent = fmt(Math.max(0, t)) + ' / ' + fmt(d);
    frameDisplay.textContent = getTime(Math.max(0, t));
  }

  function seekAll(t) {
    var adj = getAdjustedClipTimes();
    var ct = adj || clipTimes;
    videos.forEach((v, i) => {
      if (!v) return;
      let target = t;
      // In clip mode, clamp each video to its own clip range
      if (activeClip && ct && ct[i]) {
        target = Math.max(ct[i].start, Math.min(ct[i].end, t));
      }
      v.currentTime = Math.min(target, v.duration || target);
    });
  }

  function onMeta() {
    duration = Math.max(...videos.filter(v => v).map(v => v.duration || 0));
    updateTimeDisplay();
    updateDebugStats();
  }

  function attachVideoListeners() {
    videos.forEach(v => {
      if (v) v.addEventListener('loadedmetadata', onMeta);
    });
    if (primary) {
      primary.addEventListener('ended', function() {
        playing = false;
        playBtn.textContent = '\\u25B6';
      });
      primary.addEventListener('timeupdate', function() {
        // Enforce clip end boundary
        if (activeClip && primary.currentTime >= activeClip.end) {
          videos.forEach(v => v && v.pause());
          seekAll(activeClip.end);
          playing = false;
          playBtn.textContent = '\\u25B6';
        }
        if (duration > 0) {
          const t = primary.currentTime - clipOffset();
          const d = clipDuration();
          scrubber.value = d > 0 ? (Math.max(0, t) / d) * 1000 : 0;
          updateTimeDisplay();
        }
      });
    }
  }

  attachVideoListeners();

  const modeRace = document.getElementById('modeRace');
  const modeFull = document.getElementById('modeFull');
  const modeMerged = document.getElementById('modeMerged');
  const modeDebug = document.getElementById('modeDebug');
  const debugPanel = document.getElementById('debugPanel');

  function setActiveMode(btn) {
    [modeRace, modeFull, modeMerged, modeDebug].forEach(b => b && b.classList.remove('active'));
    btn && btn.classList.add('active');
  }

  function resolveClip() {
    // Compute union range across all racers so the scrubber covers all recordings
    if (!clipTimes) return null;
    let minStart = Infinity, maxEnd = -Infinity, found = false;
    for (let i = 0; i < clipTimes.length; i++) {
      if (clipTimes[i]) {
        minStart = Math.min(minStart, clipTimes[i].start);
        maxEnd = Math.max(maxEnd, clipTimes[i].end);
        found = true;
      }
    }
    return found ? { start: minStart, end: maxEnd } : null;
  }

  function switchToRace() {
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    raceVideos.forEach((v, i) => v.src = raceVideoPaths[i]);
    videos = raceVideos;
    primary = videos[0];
    playerContainer.style.display = 'flex';
    if (mergedContainer) mergedContainer.style.display = 'none';
    if (debugPanel) debugPanel.style.display = 'none';
    setActiveMode(modeRace);
    activeClip = resolveAdjustedClip();
    duration = 0;
    onMeta();
    seekAll(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
  }

  function switchToFull() {
    if (!fullVideoPaths && !clipTimes) return;
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    if (fullVideoPaths) {
      raceVideos.forEach((v, i) => v.src = fullVideoPaths[i]);
    }
    // If clipTimes mode (no-ffmpeg), same src already loaded — just remove clip constraint
    videos = raceVideos;
    primary = videos[0];
    playerContainer.style.display = 'flex';
    if (mergedContainer) mergedContainer.style.display = 'none';
    if (debugPanel) debugPanel.style.display = 'none';
    setActiveMode(modeFull);
    activeClip = null;
    duration = 0;
    onMeta();
    seekAll(0);
    scrubber.value = 0;
  }

  function switchToMerged() {
    if (!mergedVideo) return;
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    videos = [mergedVideo];
    primary = mergedVideo;
    playerContainer.style.display = 'none';
    mergedContainer.style.display = 'block';
    if (debugPanel) debugPanel.style.display = 'none';
    setActiveMode(modeMerged);
    activeClip = null;
    duration = mergedVideo.duration || 0;
    onMeta();
  }

  // --- Debug: video stats ---
  function updateDebugStats() {
    var statsEl = document.getElementById('debugStats');
    if (!statsEl || statsEl.offsetParent === null) return;
    for (var i = 0; i < raceVideos.length; i++) {
      var row = document.getElementById('debugStatsRow' + i);
      if (!row) continue;
      var v = raceVideos[i];
      if (!v || !v.duration) continue;
      var dur = v.duration.toFixed(2) + 's';
      var res = v.videoWidth + 'x' + v.videoHeight;
      var framesText = '\\u2014';
      var droppedText = '\\u2014';
      if (typeof v.getVideoPlaybackQuality === 'function') {
        var q = v.getVideoPlaybackQuality();
        framesText = String(q.totalVideoFrames);
        droppedText = String(q.droppedVideoFrames);
      }
      var clipDur = '';
      if (clipTimes && clipTimes[i]) {
        clipDur = ' (clip: ' + (clipTimes[i].end - clipTimes[i].start).toFixed(2) + 's)';
      }
      var nameSpan = row.querySelector('.racer-name');
      var nameHtml = nameSpan ? nameSpan.outerHTML : '';
      row.innerHTML = nameHtml +
        '<span>duration: ' + dur + clipDur + '</span>' +
        '<span>frames: ' + framesText + ' dropped: ' + droppedText + '</span>' +
        '<span>resolution: ' + res + '</span>';
    }
  }

  // --- Debug mode: per-racer clip start calibration ---
  const FRAME_STEP = 0.04;
  const debugOffsets = raceVideos.map(function() { return 0; });

  function getAdjustedClipTimes() {
    if (!clipTimes) return null;
    return clipTimes.map(function(ct, i) {
      if (!ct) return null;
      return { start: ct.start + debugOffsets[i], end: ct.end };
    });
  }

  function resolveAdjustedClip() {
    var adj = getAdjustedClipTimes();
    if (!adj) return resolveClip();
    var minStart = Infinity, maxEnd = -Infinity, found = false;
    for (var i = 0; i < adj.length; i++) {
      if (adj[i]) {
        minStart = Math.min(minStart, adj[i].start);
        maxEnd = Math.max(maxEnd, adj[i].end);
        found = true;
      }
    }
    return found ? { start: minStart, end: maxEnd } : null;
  }

  function updateDebugDisplay() {
    var adj = getAdjustedClipTimes();
    for (var i = 0; i < raceVideos.length; i++) {
      var el = document.getElementById('debugStart' + i);
      if (!el) continue;
      var frames = Math.round(debugOffsets[i] / FRAME_STEP);
      var sign = frames >= 0 ? '+' : '';
      var startVal = adj && adj[i] ? adj[i].start.toFixed(3) : '0.000';
      el.textContent = 'start: ' + startVal + 's (' + sign + frames + 'f)';
    }
  }

  function adjustDebugOffset(idx, frameDelta) {
    if (!clipTimes || !clipTimes[idx]) return;
    var newOffset = debugOffsets[idx] + frameDelta * FRAME_STEP;
    // Guard: don't let adjusted start go below 0 or past clip end
    var newStart = clipTimes[idx].start + newOffset;
    if (newStart < 0) newOffset = -clipTimes[idx].start;
    if (newStart >= clipTimes[idx].end) return;
    debugOffsets[idx] = newOffset;
    updateDebugDisplay();
    // Update active clip and seek
    activeClip = resolveAdjustedClip();
    seekAll(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
    updateTimeDisplay();
  }

  function switchToDebug() {
    if (playing) { videos.forEach(function(v) { v && v.pause(); }); playing = false; playBtn.textContent = '\\u25B6'; }
    raceVideos.forEach(function(v, i) { v.src = raceVideoPaths[i]; });
    videos = raceVideos;
    primary = videos[0];
    playerContainer.style.display = 'flex';
    if (mergedContainer) mergedContainer.style.display = 'none';
    if (debugPanel) debugPanel.style.display = 'block';
    setActiveMode(modeDebug);
    activeClip = resolveAdjustedClip();
    duration = 0;
    onMeta();
    updateDebugDisplay();
    updateDebugStats();
    seekAll(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
  }

  if (debugPanel) {
    debugPanel.addEventListener('click', function(e) {
      var btn = e.target.closest('.debug-frame-btn');
      if (btn) {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var delta = parseInt(btn.getAttribute('data-delta'), 10);
        adjustDebugOffset(idx, delta);
        return;
      }
      if (e.target.id === 'debugCopyJson') {
        var adj = getAdjustedClipTimes();
        var out = { clipTimes: adj, offsets: debugOffsets.slice() };
        navigator.clipboard.writeText(JSON.stringify(out, null, 2));
        return;
      }
      if (e.target.id === 'debugResetAll') {
        for (var i = 0; i < debugOffsets.length; i++) debugOffsets[i] = 0;
        updateDebugDisplay();
        activeClip = resolveAdjustedClip();
        seekAll(activeClip ? activeClip.start : 0);
        scrubber.value = 0;
        updateTimeDisplay();
      }
    });
  }

  if (modeRace) modeRace.addEventListener('click', switchToRace);
  if (modeFull) modeFull.addEventListener('click', switchToFull);
  if (modeMerged) modeMerged.addEventListener('click', switchToMerged);
  if (modeDebug) modeDebug.addEventListener('click', switchToDebug);
  if (mergedVideo) mergedVideo.addEventListener('loadedmetadata', function() {
    if (videos.includes(mergedVideo)) {
      duration = mergedVideo.duration;
      updateTimeDisplay();
    }
  });

  playBtn.addEventListener('click', function() {
    if (playing) {
      videos.forEach(v => v && v.pause());
      playBtn.textContent = '\\u25B6';
    } else {
      // If at clip end, restart from clip start
      if (activeClip && primary.currentTime >= activeClip.end - STEP) {
        seekAll(activeClip.start);
      }
      videos.forEach(v => v && v.play());
      playBtn.textContent = '\\u23F8';
    }
    playing = !playing;
  });

  scrubber.addEventListener('input', function() {
    const d = clipDuration();
    const t = (scrubber.value / 1000) * d + clipOffset();
    seekAll(t);
  });

  speedSelect.addEventListener('change', function() {
    const rate = parseFloat(speedSelect.value);
    videos.forEach(v => v && (v.playbackRate = rate));
  });

  function stepFrame(delta) {
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    const minT = clipOffset();
    const maxT = activeClip ? activeClip.end : duration;
    // Use max currentTime across all videos so stepping works past shorter videos
    const cur = Math.max.apply(null, videos.filter(function(v) { return v; }).map(function(v) { return v.currentTime || 0; }));
    const t = Math.max(minT, Math.min(maxT, cur + delta));
    seekAll(t);
  }

  document.getElementById('prevFrame').addEventListener('click', function() { stepFrame(-STEP); });
  document.getElementById('nextFrame').addEventListener('click', function() { stepFrame(STEP); });

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(STEP); }
    else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });

  // If clip times are active on initial load, seek to clip start
  if (clipTimes) {
    activeClip = resolveAdjustedClip();
    if (activeClip) {
      var initSeek = function() {
        seekAll(activeClip.start);
        updateTimeDisplay();
      };
      if (primary.readyState >= 1) initSeek();
      else primary.addEventListener('loadedmetadata', initSeek);
    }
  }

  // --- Export: client-side side-by-side video stitching ---
  var exportBtn = document.getElementById('exportBtn');

  function getExportLayout(count) {
    var LABEL_H = 30;
    var targetW = count <= 3 ? 640 : 480;
    // Use first video's aspect ratio, fallback to 16:9
    var sample = raceVideos.find(function(v) { return v && v.videoWidth; });
    var aspect = sample ? sample.videoHeight / sample.videoWidth : 9/16;
    var cellH = Math.round(targetW * aspect);
    var slotH = cellH + LABEL_H;
    var cols, rows, positions = [];
    if (count <= 3) {
      cols = count; rows = 1;
      for (var i = 0; i < count; i++) positions.push({ x: i * targetW, y: 0 });
    } else if (count === 4) {
      cols = 2; rows = 2;
      for (var i = 0; i < 4; i++) positions.push({ x: (i % 2) * targetW, y: Math.floor(i / 2) * slotH });
    } else {
      cols = 3; rows = 2;
      for (var i = 0; i < 3; i++) positions.push({ x: i * targetW, y: 0 });
      var bottomOffset = Math.floor(targetW / 2);
      for (var i = 0; i < 2; i++) positions.push({ x: bottomOffset + i * targetW, y: slotH });
    }
    var canvasW = (count === 5 ? 3 : cols) * targetW;
    var canvasH = rows * slotH;
    return { canvasW: canvasW, canvasH: canvasH, targetW: targetW, cellH: cellH, labelH: LABEL_H, positions: positions };
  }

  function drawExportFrame(ctx, layout) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
    for (var i = 0; i < raceVideos.length; i++) {
      var v = raceVideos[i];
      if (!v) continue;
      var pos = layout.positions[i];
      // Draw label
      ctx.fillStyle = racerColors[i] || '#e8e0d0';
      ctx.font = 'bold 16px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(racerNames[i] || '', pos.x + layout.targetW / 2, pos.y + layout.labelH - 8);
      // Draw video frame
      try { ctx.drawImage(v, pos.x, pos.y + layout.labelH, layout.targetW, layout.cellH); } catch(e) {}
    }
  }

  function startExport() {
    if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
      alert('Export requires a browser that supports Canvas.captureStream and MediaRecorder (Chrome, Firefox, or Edge).');
      return;
    }
    // Pause current playback
    if (playing) { videos.forEach(function(v) { v && v.pause(); }); playing = false; playBtn.textContent = '\\u25B6'; }

    var layout = getExportLayout(raceVideos.length);

    // Create overlay
    var overlay = document.createElement('div');
    overlay.className = 'export-overlay';
    overlay.innerHTML = '<div class="export-modal">' +
      '<h3>Exporting Side-by-Side</h3>' +
      '<canvas id="exportCanvas" width="' + layout.canvasW + '" height="' + layout.canvasH + '"></canvas>' +
      '<div class="export-progress-bar"><div class="export-progress-fill" id="exportProgressFill"></div></div>' +
      '<div class="export-status" id="exportStatus">Preparing...</div>' +
      '<div class="export-actions"><button id="exportCancel">Cancel</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    var canvas = document.getElementById('exportCanvas');
    var ctx = canvas.getContext('2d');
    var progressFill = document.getElementById('exportProgressFill');
    var statusEl = document.getElementById('exportStatus');
    var actionsEl = overlay.querySelector('.export-actions');

    // Determine time range
    var startTime = activeClip ? activeClip.start : 0;
    var endTime = activeClip ? activeClip.end : duration;
    var totalDur = endTime - startTime;

    // Seek all to start and wait for seeked events
    var seekPromises = raceVideos.map(function(v, i) {
      if (!v) return Promise.resolve();
      return new Promise(function(resolve) {
        var adj = getAdjustedClipTimes();
        var ct = adj || clipTimes;
        var target = startTime;
        if (activeClip && ct && ct[i]) target = Math.max(ct[i].start, Math.min(ct[i].end, startTime));
        v.currentTime = Math.min(target, v.duration || target);
        v.onseeked = function() { v.onseeked = null; resolve(); };
      });
    });

    var cancelled = false;
    var recorder = null;
    var rafId = null;

    document.getElementById('exportCancel').addEventListener('click', function() {
      cancelled = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      if (rafId) cancelAnimationFrame(rafId);
      raceVideos.forEach(function(v) { v && v.pause(); });
      overlay.remove();
    });

    Promise.all(seekPromises).then(function() {
      if (cancelled) return;
      statusEl.textContent = 'Recording...';

      var stream = canvas.captureStream(30);
      var mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      recorder = new MediaRecorder(stream, { mimeType: mimeType });
      var chunks = [];
      recorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = function() {
        if (cancelled) return;
        var blob = new Blob(chunks, { type: mimeType });
        var url = URL.createObjectURL(blob);
        statusEl.textContent = 'Export complete!';
        progressFill.style.width = '100%';
        var downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'race-side-by-side.webm';
        downloadLink.textContent = 'Download';
        downloadLink.className = '';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.addEventListener('click', function() { URL.revokeObjectURL(url); overlay.remove(); });
        actionsEl.innerHTML = '';
        actionsEl.appendChild(downloadLink);
        actionsEl.appendChild(closeBtn);
      };

      recorder.start();
      // Play all videos at user-selected speed
      var exportRate = parseFloat(speedSelect.value) || 1;
      raceVideos.forEach(function(v) { if (v) { v.playbackRate = exportRate; v.play(); } });
      var speedLabel = exportRate !== 1 ? ' (' + exportRate + 'x)' : '';

      function tick() {
        if (cancelled) return;
        drawExportFrame(ctx, layout);
        var cur = primary.currentTime || 0;
        var progress = totalDur > 0 ? Math.min(1, (cur - startTime) / totalDur) : 0;
        progressFill.style.width = (progress * 100).toFixed(1) + '%';
        statusEl.textContent = 'Recording' + speedLabel + '... ' + Math.round(progress * 100) + '%';
        if (cur >= endTime || primary.ended) {
          raceVideos.forEach(function(v) { v && v.pause(); });
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    });
  }

  if (exportBtn) {
    // Hide export button for single video or merged-only mode
    if (raceVideos.length < 2) exportBtn.style.display = 'none';
    exportBtn.addEventListener('click', startExport);
  }
})();
</script>`;
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  const { fullVideoFiles, mergedVideoFile, traceFiles, runNavigation, medianRunLabel, clipTimes } = options;
  const racers = summary.racers;
  const count = racers.length;

  // Layout dimensions
  const maxWidth = count <= 2 ? 680 : count === 3 ? 450 : 340;
  const containerMaxWidth = count <= 2 ? 1400 : count === 3 ? 1400 : 1440;

  // Title
  const title = count === 2
    ? `Race: ${escHtml(racers[0])} vs ${escHtml(racers[1])}`
    : `Race: ${racers.map(escHtml).join(' vs ')}`;

  // Winner banner
  const winnerBanner = summary.overallWinner === 'tie'
    ? `<span class="trophy">&#129309;</span> It's a Tie!`
    : summary.overallWinner
      ? `<span class="trophy">&#127942;</span> ${escHtml(summary.overallWinner.toUpperCase())} wins!`
      : '';

  // Video elements — ordered by placement (winner first)
  const hasVideos = videoFiles && videoFiles.length > 0;
  const placementOrder = getPlacementOrder(summary);

  const hasFullVideos = fullVideoFiles && fullVideoFiles.length > 0;
  const hasClipTimes = clipTimes && clipTimes.some(c => c !== null);
  const hasMergedVideo = !!mergedVideoFile;

  let playerSection = '';
  let scriptTag = '';

  if (hasVideos) {
    const videoElements = placementOrder.map((origIdx, displayIdx) => {
      const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
      const racer = racers[origIdx];
      return `  <div class="racer">
    <div class="racer-label" style="color: ${color}">${escHtml(racer)}</div>
    <video id="v${displayIdx}" src="${escHtml(videoFiles[origIdx])}" preload="auto" muted></video>
  </div>`;
    }).join('\n');

    const mergedVideoElement = mergedVideoFile ? `
<div class="merged-container" id="mergedContainer" style="display: none;">
  <video id="mergedVideo" src="${escHtml(mergedVideoFile)}" preload="auto" muted></video>
</div>` : '';

    const debugPanelHtml = hasClipTimes ? buildDebugPanelHtml(racers, placementOrder, clipTimes) : '';
    playerSection = buildPlayerSectionHtml(videoElements, mergedVideoElement, debugPanelHtml);

    // Player script config — use JSON.stringify for safe path embedding
    const videoIds = placementOrder.map((_, i) => `v${i}`);
    const orderedVideoFiles = placementOrder.map(i => videoFiles[i]);
    const orderedFullVideoFiles = fullVideoFiles ? placementOrder.map(i => fullVideoFiles[i]) : null;

    // Order clip times to match placement order
    const orderedClipTimes = clipTimes ? placementOrder.map(i => clipTimes[i] || null) : null;

    // Racer names/colors in placement order for export labels
    const orderedRacerNames = placementOrder.map(i => racers[i]);
    const orderedRacerColors = placementOrder.map(i => RACER_CSS_COLORS[i % RACER_CSS_COLORS.length]);

    scriptTag = buildPlayerScript({
      videoVars: videoIds.map(id => `const ${id} = document.getElementById('${id}');`).join('\n  '),
      videoArray: `[${videoIds.join(', ')}]`,
      raceVideoPaths: JSON.stringify(orderedVideoFiles),
      fullVideoPaths: orderedFullVideoFiles
        ? JSON.stringify(orderedFullVideoFiles)
        : 'null',
      clipTimesJson: orderedClipTimes
        ? JSON.stringify(orderedClipTimes)
        : 'null',
      hasDebug: hasClipTimes,
      racerNamesJson: JSON.stringify(orderedRacerNames),
      racerColorsJson: JSON.stringify(orderedRacerColors),
      hasMergedVideo: hasMergedVideo,
    });
  }

  // Mode toggle — show Full button when separate full videos exist OR when clip times
  // provide virtual trimming (no-ffmpeg mode, same file but different playback range)
  const modeToggle = (hasFullVideos || hasClipTimes || hasMergedVideo) ? `
  <div class="mode-toggle">
    <button class="mode-btn active" id="modeRace" title="Race segments only">Race</button>
    ${hasFullVideos || hasClipTimes ? '<button class="mode-btn" id="modeFull" title="Full recordings">Full</button>' : ''}
    ${hasMergedVideo ? '<button class="mode-btn" id="modeMerged" title="Side-by-side merged video">Merged</button>' : ''}
    ${hasClipTimes ? '<button class="mode-btn" id="modeDebug" title="Debug clip start calibration">Debug</button>' : ''}
  </div>` : '';

  // Render template with all sections
  return render(TEMPLATE, {
    title,
    layoutCss: `.player-container { max-width: ${containerMaxWidth}px; }\n  .racer { max-width: ${maxWidth}px; }`,
    runNav: buildRunNavHtml(runNavigation),
    winnerBanner,
    videoSourceNote: medianRunLabel ? `<div class="video-source-note">Videos from ${escHtml(medianRunLabel)} (closest to median)</div>` : '',
    raceInfo: buildRaceInfoHtml(summary),
    errors: buildErrorsHtml(summary.errors),
    modeToggle,
    playerSection,
    results: buildResultsHtml(summary.comparisons || [], racers, summary.clickCounts),
    profile: buildProfileHtml(summary.profileComparison || null, racers),
    files: buildFilesHtml(racers, videoFiles, {
      fullVideoFiles, mergedVideoFile, traceFiles, altFormat, altFiles, placementOrder,
    }),
    scriptTag,
  });
}
