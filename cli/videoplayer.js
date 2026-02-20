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
import { PROFILE_METRICS, categoryDescriptions } from './profile-analysis.js';
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
  <p class="profile-note">Lower values are better for all metrics. Hover over metric names for details.</p>\n`;

  const scopes = [
    ['During Measurement (raceStart \u2192 raceEnd)', 'Metrics captured only between raceStart() and raceEnd() calls — isolates the code being tested.', measured],
    ['Total Session', 'Metrics for the entire browser session from launch to close — includes page load, setup, and teardown.', total],
  ];
  for (const [title, scopeDesc, section] of scopes) {
    if (section.comparisons.length === 0) continue;
    html += `<h3>${escHtml(title)}</h3>\n`;
    html += `<p class="profile-scope-desc">${escHtml(scopeDesc)}</p>\n`;
    for (const [category, comps] of Object.entries(section.byCategory)) {
      const catLabel = category[0].toUpperCase() + category.slice(1);
      const catDesc = categoryDescriptions[category] || '';
      html += `<h4 ${catDesc ? `title="${escHtml(catDesc)}"` : ''}>${escHtml(catLabel)}</h4>\n`;
      if (catDesc) {
        html += `<p class="profile-category-desc">${escHtml(catDesc)}</p>\n`;
      }
      for (const comp of comps) {
        const sorted = sortByValue(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }));
        const metricDef = PROFILE_METRICS[comp.key];
        const formatDelta = metricDef.format;
        const desc = metricDef.description || '';
        html += `<div class="profile-metric">
        <div class="profile-metric-name" ${desc ? `title="${escHtml(desc)}"` : ''}>${escHtml(comp.name)} ${desc ? '<span class="profile-info-icon">&#9432;</span>' : ''}</div>
        ${desc ? `<div class="profile-metric-desc">${escHtml(desc)}</div>` : ''}${buildMetricRowsHtml(sorted, comp.winner, formatDelta)}</div>\n`;
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
// Player Section Builder — returns player container + controls (or '' if no videos)
// ---------------------------------------------------------------------------

function buildPlayerSectionHtml(videoElements, mergedVideoElement) {
  return `<div class="player-container" id="playerContainer">
${videoElements}
</div>
${mergedVideoElement}

<div class="controls">
  <div class="controls-row">
    <button class="frame-btn" id="prevFrame" title="Previous frame (\u2190)">\u25C0\u25C0</button>
    <button class="play-btn" id="playBtn">\u25B6</button>
    <button class="frame-btn" id="nextFrame" title="Next frame (\u2192)">\u25B6\u25B6</button>
    <input type="range" class="scrubber" id="scrubber" min="0" max="1000" value="0">
  </div>
  <span class="time-display" id="timeDisplay">0:00.000 / 0:00.000</span>
  <span class="frame-display" id="frameDisplay">Frame: 0</span>
  <select class="speed-select" id="speedSelect">
    <option value="0.25">0.25x</option>
    <option value="0.5">0.5x</option>
    <option value="1" selected>1x</option>
    <option value="2">2x</option>
  </select>
</div>`;
}

// ---------------------------------------------------------------------------
// Player Script Builder
// ---------------------------------------------------------------------------

function buildPlayerScript(config) {
  const { videoVars, videoArray, raceVideoPaths, fullVideoPaths } = config;
  return `<script>
(function() {
  ${videoVars}
  const raceVideos = ${videoArray};
  const raceVideoPaths = ${raceVideoPaths};
  const fullVideoPaths = ${fullVideoPaths};
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
  const FPS = 30;
  const FRAME = 1 / FPS;

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 1000);
    return m + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }

  function getFrame(t) {
    return Math.floor(t * FPS);
  }

  function updateTimeDisplay() {
    const t = primary.currentTime || 0;
    timeDisplay.textContent = fmt(t) + ' / ' + fmt(duration);
    frameDisplay.textContent = 'Frame: ' + getFrame(t);
  }

  function seekAll(t) {
    videos.forEach(v => v && (v.currentTime = Math.min(t, v.duration || t)));
  }

  function onMeta() {
    duration = Math.max(...videos.filter(v => v).map(v => v.duration || 0));
    updateTimeDisplay();
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
        if (duration > 0) {
          scrubber.value = (primary.currentTime / duration) * 1000;
          updateTimeDisplay();
        }
      });
    }
  }

  attachVideoListeners();

  const modeRace = document.getElementById('modeRace');
  const modeFull = document.getElementById('modeFull');
  const modeMerged = document.getElementById('modeMerged');

  function setActiveMode(btn) {
    [modeRace, modeFull, modeMerged].forEach(b => b && b.classList.remove('active'));
    btn && btn.classList.add('active');
  }

  function switchToRace() {
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    raceVideos.forEach((v, i) => v.src = raceVideoPaths[i]);
    videos = raceVideos;
    primary = videos[0];
    playerContainer.style.display = 'flex';
    if (mergedContainer) mergedContainer.style.display = 'none';
    setActiveMode(modeRace);
    duration = 0;
    onMeta();
  }

  function switchToFull() {
    if (!fullVideoPaths) return;
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    raceVideos.forEach((v, i) => v.src = fullVideoPaths[i]);
    videos = raceVideos;
    primary = videos[0];
    playerContainer.style.display = 'flex';
    if (mergedContainer) mergedContainer.style.display = 'none';
    setActiveMode(modeFull);
    duration = 0;
    onMeta();
  }

  function switchToMerged() {
    if (!mergedVideo) return;
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    videos = [mergedVideo];
    primary = mergedVideo;
    playerContainer.style.display = 'none';
    mergedContainer.style.display = 'block';
    setActiveMode(modeMerged);
    duration = mergedVideo.duration || 0;
    onMeta();
  }

  if (modeRace) modeRace.addEventListener('click', switchToRace);
  if (modeFull) modeFull.addEventListener('click', switchToFull);
  if (modeMerged) modeMerged.addEventListener('click', switchToMerged);
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
      videos.forEach(v => v && v.play());
      playBtn.textContent = '\\u23F8';
    }
    playing = !playing;
  });

  scrubber.addEventListener('input', function() {
    const t = (scrubber.value / 1000) * duration;
    seekAll(t);
  });

  speedSelect.addEventListener('change', function() {
    const rate = parseFloat(speedSelect.value);
    videos.forEach(v => v && (v.playbackRate = rate));
  });

  function stepFrame(delta) {
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.textContent = '\\u25B6'; }
    const t = Math.max(0, Math.min(duration, primary.currentTime + delta));
    seekAll(t);
  }

  document.getElementById('prevFrame').addEventListener('click', function() { stepFrame(-FRAME); });
  document.getElementById('nextFrame').addEventListener('click', function() { stepFrame(FRAME); });

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-FRAME); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(FRAME); }
    else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });
})();
</script>`;
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  const { fullVideoFiles, mergedVideoFile, traceFiles, runNavigation, medianRunLabel } = options;
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

    playerSection = buildPlayerSectionHtml(videoElements, mergedVideoElement);

    // Player script config — use JSON.stringify for safe path embedding
    const videoIds = placementOrder.map((_, i) => `v${i}`);
    const orderedVideoFiles = placementOrder.map(i => videoFiles[i]);
    const orderedFullVideoFiles = fullVideoFiles ? placementOrder.map(i => fullVideoFiles[i]) : null;

    scriptTag = buildPlayerScript({
      videoVars: videoIds.map(id => `const ${id} = document.getElementById('${id}');`).join('\n  '),
      videoArray: `[${videoIds.join(', ')}]`,
      raceVideoPaths: JSON.stringify(orderedVideoFiles),
      fullVideoPaths: orderedFullVideoFiles
        ? JSON.stringify(orderedFullVideoFiles)
        : 'null',
    });
  }

  // Mode toggle
  const hasFullVideos = fullVideoFiles && fullVideoFiles.length > 0;
  const hasMergedVideo = !!mergedVideoFile;
  const modeToggle = (hasFullVideos || hasMergedVideo) ? `
  <div class="mode-toggle">
    <button class="mode-btn active" id="modeRace" title="Race segments only">Race</button>
    ${hasFullVideos ? '<button class="mode-btn" id="modeFull" title="Full recordings">Full</button>' : ''}
    ${hasMergedVideo ? '<button class="mode-btn" id="modeMerged" title="Side-by-side merged video">Merged</button>' : ''}
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
