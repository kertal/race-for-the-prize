/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * video player for race results. Supports 2-5 racers.
 */

import { PROFILE_METRICS } from './profile-analysis.js';
import { getPlacementOrder } from './summary.js';

// Racer label colors matching RACER_COLORS from colors.js
const RACER_CSS_COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f1c40f', '#9b59b6'];

/** Escape a string for safe embedding in HTML text/attribute contexts. */
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Build sorted bar-chart HTML rows for a single metric.
 * @param {Object[]} entries - Array of { name, index, val, formatted } sorted best-first
 * @param {string|null} winner - Winner name
 * @param {function} formatDelta - Formats the delta value as string
 */
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

function buildProfileHtml(profileComparison, racers) {
  if (!profileComparison) return '';
  const { measured, total } = profileComparison;
  if (measured.comparisons.length === 0 && total.comparisons.length === 0) return '';

  let html = `<div class="profile-analysis">
  <h2>Performance Profile</h2>
  <p class="profile-note">Lower values are better for all metrics</p>\n`;

  const scopes = [
    ['During Measurement (raceStart → raceEnd)', measured],
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

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  const { fullVideoFiles, mergedVideoFile, runNavigation, medianRunLabel } = options;
  const racers = summary.racers;
  const comparisons = summary.comparisons || [];
  const overallWinner = summary.overallWinner;
  const profileComparison = summary.profileComparison || null;
  const count = racers.length;

  // Generate results section (bar-chart style, sorted best-first)
  let resultsHtml = '';
  for (const comp of comparisons) {
    const sorted = sortByValue(racers, i => {
      const r = comp.racers[i];
      return { val: r ? r.duration : null, formatted: r ? `${r.duration.toFixed(3)}s` : '-' };
    });
    resultsHtml += `<div class="profile-metric">
        <div class="profile-metric-name">${escHtml(comp.name)}</div>${buildMetricRowsHtml(sorted, comp.winner, v => `${v.toFixed(3)}s`)}</div>\n`;
  }

  const winnerBanner = overallWinner === 'tie'
    ? `<span class="trophy">&#129309;</span> It's a Tie!`
    : overallWinner
      ? `<span class="trophy">&#127942;</span> ${escHtml(overallWinner.toUpperCase())} wins!`
      : '';

  // Generate video elements for race videos (empty when no videos, e.g. median page)
  // Order by placement: winner first, then 2nd, 3rd, etc.
  const hasVideos = videoFiles && videoFiles.length > 0;
  const placementOrder = getPlacementOrder(summary);
  const videoElements = hasVideos ? placementOrder.map((origIdx, displayIdx) => {
    const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
    const racer = racers[origIdx];
    return `  <div class="racer">
    <div class="racer-label" style="color: ${color}">${escHtml(racer)}</div>
    <video id="v${displayIdx}" src="${escHtml(videoFiles[origIdx])}" preload="auto" muted></video>
  </div>`;
  }).join('\n') : '';

  // Generate merged video element
  const mergedVideoElement = mergedVideoFile ? `
<div class="merged-container" id="mergedContainer" style="display: none;">
  <video id="mergedVideo" src="${escHtml(mergedVideoFile)}" preload="auto" muted></video>
</div>` : '';

  // Generate download links (in placement order)
  const downloadLinks = altFormat && altFiles
    ? `<div class="downloads">
  <h2>Downloads</h2>
  <div class="download-links">
    ${placementOrder.map(i => `<a href="${escHtml(altFiles[i])}" download>${escHtml(racers[i])} (.${escHtml(altFormat)})</a>`).join('\n    ')}
  </div>
</div>` : '';

  // Generate profile analysis section
  const profileHtml = buildProfileHtml(profileComparison, racers);

  // Generate JavaScript video references (only needed when videos exist)
  let videoVars = '', videoArray = '', raceVideoPaths = '', fullVideoPaths = 'null';
  if (hasVideos) {
    const videoIds = placementOrder.map((_, i) => `v${i}`);
    videoVars = videoIds.map(id => `const ${id} = document.getElementById('${id}');`).join('\n  ');
    videoArray = `[${videoIds.join(', ')}]`;
    const orderedVideoFiles = placementOrder.map(i => videoFiles[i]);
    raceVideoPaths = JSON.stringify(orderedVideoFiles);
    const orderedFullVideoFiles = fullVideoFiles ? placementOrder.map(i => fullVideoFiles[i]) : null;
    fullVideoPaths = orderedFullVideoFiles
      ? JSON.stringify(orderedFullVideoFiles)
      : 'null';
  }

  // Calculate layout-specific styles
  const maxWidth = count <= 2 ? 680 : count === 3 ? 450 : 340;
  const containerMaxWidth = count <= 2 ? 1400 : count === 3 ? 1400 : 1440;

  // Title based on racer count
  const title = count === 2
    ? `Race: ${escHtml(racers[0])} vs ${escHtml(racers[1])}`
    : `Race: ${racers.map(escHtml).join(' vs ')}`;

  // Video mode toggle buttons
  const hasFullVideos = fullVideoFiles && fullVideoFiles.length > 0;
  const hasMergedVideo = !!mergedVideoFile;
  const modeToggle = (hasFullVideos || hasMergedVideo) ? `
  <div class="mode-toggle">
    <button class="mode-btn active" id="modeRace" title="Race segments only">Race</button>
    ${hasFullVideos ? '<button class="mode-btn" id="modeFull" title="Full recordings">Full</button>' : ''}
    ${hasMergedVideo ? '<button class="mode-btn" id="modeMerged" title="Side-by-side merged video">Merged</button>' : ''}
  </div>` : '';

  // Run navigation for multi-run results
  const runNavHtml = buildRunNavHtml(runNavigation);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a1a;
    color: #e8e0d0;
    font-family: 'Courier New', monospace;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .checkered-bar {
    width: 100%;
    height: 20px;
    background: repeating-conic-gradient(#222 0% 25%, #d4af37 0% 50%) 0 0 / 20px 20px;
  }
  .run-nav {
    display: flex;
    gap: 0.4rem;
    padding: 0.7rem 1rem 0;
    justify-content: center;
    flex-wrap: wrap;
  }
  .run-nav-btn {
    background: #2a2a2a;
    color: #999;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 0.3rem 0.8rem;
    font-size: 0.8rem;
    text-decoration: none;
    font-family: 'Courier New', monospace;
    transition: all 0.2s;
  }
  .run-nav-btn:hover {
    background: #3a3a3a;
    border-color: #d4af37;
    color: #e8e0d0;
  }
  .run-nav-btn.active {
    background: #d4af37;
    color: #1a1a1a;
    border-color: #d4af37;
    font-weight: bold;
    cursor: default;
  }
  h1 {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.8rem;
    color: #d4af37;
    text-align: center;
    padding: 1.2rem 0 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
  }
  .winner-banner {
    text-align: center;
    font-family: Georgia, serif;
    font-size: 1.2rem;
    color: #e8e0d0;
    padding-bottom: 1rem;
  }
  .trophy { font-size: 1.4rem; }
  .video-source-note {
    text-align: center;
    font-size: 0.8rem;
    color: #777;
    padding-bottom: 0.5rem;
  }
  .mode-toggle {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0 1rem;
    justify-content: center;
  }
  .mode-btn {
    background: #2a2a2a;
    color: #999;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 0.4rem 1rem;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: 'Courier New', monospace;
    transition: all 0.2s;
  }
  .mode-btn:hover {
    background: #3a3a3a;
    border-color: #d4af37;
    color: #e8e0d0;
  }
  .mode-btn.active {
    background: #d4af37;
    color: #1a1a1a;
    border-color: #d4af37;
    font-weight: bold;
  }
  .player-container {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0 1.5rem;
    max-width: ${containerMaxWidth}px;
    width: 100%;
    justify-content: center;
  }
  .racer {
    flex: 1;
    min-width: 280px;
    max-width: ${maxWidth}px;
    text-align: center;
  }
  .racer-label {
    font-family: Georgia, serif;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.5rem 0;
  }
  video {
    width: 100%;
    border: 2px solid #333;
    border-radius: 4px;
    background: #000;
  }
  .merged-container {
    max-width: 1200px;
    width: 100%;
    padding: 0 1.5rem;
  }
  .merged-container video {
    width: 100%;
  }
  .controls {
    max-width: 900px;
    width: 100%;
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
  .controls-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex: 1;
    min-width: 300px;
  }
  .play-btn {
    background: #d4af37;
    color: #1a1a1a;
    border: none;
    border-radius: 4px;
    width: 44px;
    height: 34px;
    font-size: 1.1rem;
    cursor: pointer;
    font-weight: bold;
    flex-shrink: 0;
  }
  .play-btn:hover { background: #e8c445; }
  .frame-btn {
    background: #2a2a2a;
    color: #d4af37;
    border: 1px solid #555;
    border-radius: 4px;
    width: 34px;
    height: 34px;
    font-size: 0.7rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .frame-btn:hover { background: #3a3a3a; border-color: #d4af37; }
  .scrubber {
    flex: 1;
    accent-color: #d4af37;
    height: 6px;
    cursor: pointer;
  }
  .time-display {
    font-size: 0.75rem;
    color: #999;
    min-width: 140px;
    text-align: center;
    flex-shrink: 0;
  }
  .frame-display {
    font-size: 0.75rem;
    color: #777;
    min-width: 80px;
    text-align: center;
    flex-shrink: 0;
  }
  .speed-select {
    background: #2a2a2a;
    color: #e8e0d0;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 0.3rem 0.4rem;
    font-size: 0.8rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .downloads {
    max-width: 900px;
    width: 100%;
    padding: 0.5rem 1.5rem 1rem;
  }
  .downloads h2 {
    font-family: Georgia, serif;
    color: #d4af37;
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .download-links {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .download-links a {
    color: #e8e0d0;
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    text-decoration: none;
    font-size: 0.85rem;
  }
  .download-links a:hover {
    background: #3a3a3a;
    border-color: #d4af37;
  }

  .profile-analysis {
    max-width: 900px;
    width: 100%;
    padding: 0.5rem 1.5rem 1rem;
  }
  .profile-analysis h2 {
    font-family: Georgia, serif;
    color: #d4af37;
    font-size: 1.1rem;
    margin-bottom: 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .profile-note {
    color: #777;
    font-size: 0.8rem;
    margin-bottom: 1rem;
  }
  .profile-analysis h3 {
    color: #e8e0d0;
    font-size: 0.95rem;
    margin: 1rem 0 0.5rem;
    border-bottom: 1px solid #444;
    padding-bottom: 0.3rem;
  }
  .profile-analysis h4 {
    color: #999;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0.8rem 0 0.4rem;
  }
  .profile-metric {
    margin-bottom: 0.6rem;
  }
  .profile-metric-name {
    color: #888;
    font-size: 0.8rem;
    margin-bottom: 0.2rem;
  }
  .profile-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0;
    font-size: 0.82rem;
  }
  .profile-racer {
    font-weight: bold;
    min-width: 90px;
    flex-shrink: 0;
  }
  .profile-bar-track {
    flex: 1;
    height: 10px;
    background: #2a2a2a;
    border-radius: 3px;
    overflow: hidden;
    max-width: 200px;
  }
  .profile-bar-fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    opacity: 0.8;
  }
  .profile-value {
    min-width: 120px;
    flex-shrink: 0;
    text-align: right;
    color: #ccc;
  }
  .profile-delta {
    color: #888;
    font-size: 0.75rem;
    margin-left: 0.3rem;
  }
  .profile-medal {
    font-size: 0.85rem;
  }
  .profile-winner {
    font-size: 0.9rem;
    font-weight: bold;
    margin-top: 0.2rem;
  }
</style>
</head>
<body>

<div class="checkered-bar"></div>
${runNavHtml}
<h1>Race for the Prize</h1>
<div class="winner-banner">${winnerBanner}</div>
${medianRunLabel ? `<div class="video-source-note">Videos from ${escHtml(medianRunLabel)} (closest to median)</div>` : ''}
${modeToggle}

${hasVideos ? `<div class="player-container" id="playerContainer">
${videoElements}
</div>
${mergedVideoElement}

<div class="controls">
  <div class="controls-row">
    <button class="frame-btn" id="prevFrame" title="Previous frame (←)">◀◀</button>
    <button class="play-btn" id="playBtn">▶</button>
    <button class="frame-btn" id="nextFrame" title="Next frame (→)">▶▶</button>
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
</div>` : ''}

<div class="profile-analysis">
  <h2>Results</h2>
${resultsHtml}
</div>

${profileHtml}

${downloadLinks}

<div class="checkered-bar"></div>

${hasVideos ? `<script>
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

  // Format time with milliseconds: m:ss.mmm
  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 1000);
    return m + ':' + String(sec).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }

  // Calculate frame number from time
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
        playBtn.innerHTML = '▶';
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

  // Mode switching
  const modeRace = document.getElementById('modeRace');
  const modeFull = document.getElementById('modeFull');
  const modeMerged = document.getElementById('modeMerged');

  function setActiveMode(btn) {
    [modeRace, modeFull, modeMerged].forEach(b => b && b.classList.remove('active'));
    btn && btn.classList.add('active');
  }

  function switchToRace() {
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '▶'; }
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
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '▶'; }
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
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '▶'; }
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
      playBtn.innerHTML = '▶';
    } else {
      videos.forEach(v => v && v.play());
      playBtn.innerHTML = '⏸';
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
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '▶'; }
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
</script>` : ''}
</body>
</html>`;
}
