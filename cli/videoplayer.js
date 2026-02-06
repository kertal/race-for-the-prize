/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * video player for race results. Supports 2-5 racers.
 *
 * Structure: CSS template + section builders + JS template + main assembler.
 * Each section builder returns an HTML string or '' if nothing to render.
 */

import { PROFILE_METRICS } from './profile-analysis.js';

const RACER_CSS_COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f1c40f', '#9b59b6'];

// ---------------------------------------------------------------------------
// CSS Template
// ---------------------------------------------------------------------------

const PAGE_CSS = `
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
    padding-bottom: 0.5rem;
  }
  .trophy { font-size: 1.4rem; }
  .race-info {
    max-width: 900px;
    width: 100%;
    padding: 0.3rem 1.5rem 0.8rem;
  }
  .race-info table {
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .race-info td {
    padding: 0.15rem 0.8rem 0.15rem 0;
  }
  .race-info td:first-child {
    color: #888;
  }
  .errors {
    max-width: 900px;
    width: 100%;
    padding: 0.3rem 1.5rem;
  }
  .errors ul {
    list-style: none;
    font-size: 0.85rem;
    color: #e74c3c;
  }
  .errors li::before { content: "\\26A0  "; }
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
    width: 100%;
    justify-content: center;
  }
  .racer {
    flex: 1;
    min-width: 280px;
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
  .merged-container video { width: 100%; }
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
  .section {
    max-width: 900px;
    width: 100%;
    padding: 0.5rem 1.5rem 1rem;
  }
  .section h2 {
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
  .section h3 {
    color: #e8e0d0;
    font-size: 0.95rem;
    margin: 1rem 0 0.5rem;
    border-bottom: 1px solid #444;
    padding-bottom: 0.3rem;
  }
  .section h4 {
    color: #999;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0.8rem 0 0.4rem;
  }
  .profile-metric { margin-bottom: 0.6rem; }
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
  .profile-medal { font-size: 0.85rem; }
  .profile-winner {
    font-size: 0.9rem;
    font-weight: bold;
    margin-top: 0.2rem;
  }
  .file-links {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .file-links a {
    color: #e8e0d0;
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    text-decoration: none;
    font-size: 0.85rem;
  }
  .file-links a:hover {
    background: #3a3a3a;
    border-color: #d4af37;
  }`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
          <span class="profile-racer" style="color: ${color}">${entry.name}</span>
          <span class="profile-bar-track">
            <span class="profile-bar-fill" style="width: ${barPct}%; background: ${color}"></span>
          </span>
          <span class="profile-value">${entry.formatted}${delta}</span>
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

function buildRaceInfoHtml(summary) {
  const { racers, settings, timestamp } = summary;
  const rows = [];
  if (timestamp) rows.push(`<tr><td>Date</td><td>${new Date(timestamp).toLocaleString()}</td></tr>`);
  racers.forEach((r, i) => rows.push(`<tr><td>Racer ${i + 1}</td><td>${r}</td></tr>`));
  if (settings) {
    const mode = settings.parallel === false ? 'sequential' : 'parallel';
    rows.push(`<tr><td>Mode</td><td>${mode}</td></tr>`);
    if (settings.network && settings.network !== 'none') rows.push(`<tr><td>Network</td><td>${settings.network}</td></tr>`);
    if (settings.cpuThrottle && settings.cpuThrottle > 1) rows.push(`<tr><td>CPU Throttle</td><td>${settings.cpuThrottle}x</td></tr>`);
    if (settings.format && settings.format !== 'webm') rows.push(`<tr><td>Format</td><td>${settings.format}</td></tr>`);
    if (settings.headless) rows.push(`<tr><td>Headless</td><td>yes</td></tr>`);
    if (settings.runs && settings.runs > 1) rows.push(`<tr><td>Runs</td><td>${settings.runs}</td></tr>`);
  }
  if (rows.length === 0) return '';
  return `<div class="race-info"><table>${rows.join('')}</table></div>`;
}

function buildErrorsHtml(errors) {
  if (!errors || errors.length === 0) return '';
  return `<div class="errors"><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul></div>`;
}

function buildResultsHtml(comparisons, racers, clickCounts) {
  let html = '';
  for (const comp of comparisons) {
    const sorted = sortByValue(racers, i => {
      const r = comp.racers[i];
      return { val: r ? r.duration : null, formatted: r ? `${r.duration.toFixed(3)}s` : '-' };
    });
    html += `<div class="profile-metric">
        <div class="profile-metric-name">${comp.name}</div>${buildMetricRowsHtml(sorted, comp.winner, v => `${v.toFixed(3)}s`)}</div>\n`;
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
          <span class="profile-racer" style="color: ${color}">${r}</span>
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
    ['During Measurement (raceStart → raceEnd)', measured],
    ['Total Session', total],
  ];
  for (const [title, section] of scopes) {
    if (section.comparisons.length === 0) continue;
    html += `<h3>${title}</h3>\n`;
    for (const [category, comps] of Object.entries(section.byCategory)) {
      html += `<h4>${category[0].toUpperCase() + category.slice(1)}</h4>\n`;
      for (const comp of comps) {
        const sorted = sortByValue(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }));
        const formatDelta = PROFILE_METRICS[comp.key].format;
        html += `<div class="profile-metric">
        <div class="profile-metric-name">${comp.name}</div>${buildMetricRowsHtml(sorted, comp.winner, formatDelta)}</div>\n`;
      }
    }
    if (section.overallWinner === 'tie') {
      html += `<div class="profile-winner">&#129309; Tie!</div>`;
    } else if (section.overallWinner) {
      const idx = racers.indexOf(section.overallWinner);
      html += `<div class="profile-winner">&#127942; <span style="color: ${RACER_CSS_COLORS[idx % RACER_CSS_COLORS.length]}">${section.overallWinner}</span> wins!</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function buildFilesHtml(racers, videoFiles, options) {
  const { fullVideoFiles, mergedVideoFile, traceFiles, altFormat, altFiles } = options;
  const links = [];

  racers.forEach((r, i) => {
    if (videoFiles[i]) links.push(`<a href="${videoFiles[i]}">${r} (race)</a>`);
  });
  if (fullVideoFiles) {
    racers.forEach((r, i) => {
      if (fullVideoFiles[i]) links.push(`<a href="${fullVideoFiles[i]}">${r} (full)</a>`);
    });
  }
  if (mergedVideoFile) {
    links.push(`<a href="${mergedVideoFile}">side-by-side</a>`);
  }
  if (altFormat && altFiles) {
    racers.forEach((r, i) => {
      if (altFiles[i]) links.push(`<a href="${altFiles[i]}" download>${r} (.${altFormat})</a>`);
    });
  }
  if (traceFiles) {
    racers.forEach((r, i) => {
      if (traceFiles[i]) links.push(`<a href="${traceFiles[i]}" title="Open in chrome://tracing or ui.perfetto.dev">${r} (profile)</a>`);
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
// Player Script Builder
// ---------------------------------------------------------------------------

function buildPlayerScript(config) {
  const { videoVars, videoArray, raceVideoPaths, fullVideoPaths } = config;
  return `(function() {
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
        playBtn.innerHTML = '\\u25B6';
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
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '\\u25B6'; }
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
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '\\u25B6'; }
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
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '\\u25B6'; }
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
      playBtn.innerHTML = '\\u25B6';
    } else {
      videos.forEach(v => v && v.play());
      playBtn.innerHTML = '\\u23F8';
    }
    playing = !playing;
  });

  scrubber.addEventListener('input', function() {
    const t = (scrubber.value / 1000) * duration;
    videos.forEach(v => v && (v.currentTime = t));
  });

  speedSelect.addEventListener('change', function() {
    const rate = parseFloat(speedSelect.value);
    videos.forEach(v => v && (v.playbackRate = rate));
  });

  function stepFrame(delta) {
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '\\u25B6'; }
    const t = Math.max(0, Math.min(duration, primary.currentTime + delta));
    videos.forEach(v => v && (v.currentTime = t));
  }

  document.getElementById('prevFrame').addEventListener('click', function() { stepFrame(-FRAME); });
  document.getElementById('nextFrame').addEventListener('click', function() { stepFrame(FRAME); });

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-FRAME); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(FRAME); }
    else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });
})();`;
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  const { fullVideoFiles, mergedVideoFile, traceFiles } = options;
  const racers = summary.racers;
  const count = racers.length;

  // Layout dimensions
  const maxWidth = count <= 2 ? 680 : count === 3 ? 450 : 340;
  const containerMaxWidth = count <= 2 ? 1400 : count === 3 ? 1400 : 1440;
  const layoutCss = `\n  .player-container { max-width: ${containerMaxWidth}px; }\n  .racer { max-width: ${maxWidth}px; }`;

  // Title
  const title = count === 2
    ? `Race: ${racers[0]} vs ${racers[1]}`
    : `Race: ${racers.join(' vs ')}`;

  // Winner banner
  const winnerBanner = summary.overallWinner === 'tie'
    ? `<span class="trophy">&#129309;</span> It's a Tie!`
    : summary.overallWinner
      ? `<span class="trophy">&#127942;</span> ${summary.overallWinner.toUpperCase()} wins!`
      : '';

  // Video elements
  const videoElements = racers.map((racer, i) => {
    const color = RACER_CSS_COLORS[i % RACER_CSS_COLORS.length];
    return `  <div class="racer">
    <div class="racer-label" style="color: ${color}">${racer}</div>
    <video id="v${i}" src="${videoFiles[i]}" preload="auto" muted></video>
  </div>`;
  }).join('\n');

  const mergedVideoElement = mergedVideoFile ? `
<div class="merged-container" id="mergedContainer" style="display: none;">
  <video id="mergedVideo" src="${mergedVideoFile}" preload="auto" muted></video>
</div>` : '';

  // Mode toggle
  const hasFullVideos = fullVideoFiles && fullVideoFiles.length > 0;
  const hasMergedVideo = !!mergedVideoFile;
  const modeToggle = (hasFullVideos || hasMergedVideo) ? `
  <div class="mode-toggle">
    <button class="mode-btn active" id="modeRace" title="Race segments only">Race</button>
    ${hasFullVideos ? '<button class="mode-btn" id="modeFull" title="Full recordings">Full</button>' : ''}
    ${hasMergedVideo ? '<button class="mode-btn" id="modeMerged" title="Side-by-side merged video">Merged</button>' : ''}
  </div>` : '';

  // Player script config
  const videoIds = racers.map((_, i) => `v${i}`);
  const scriptConfig = {
    videoVars: videoIds.map(id => `const ${id} = document.getElementById('${id}');`).join('\n  '),
    videoArray: `[${videoIds.join(', ')}]`,
    raceVideoPaths: `[${videoFiles.map(f => `'${f}'`).join(', ')}]`,
    fullVideoPaths: fullVideoFiles
      ? `[${fullVideoFiles.map(f => `'${f}'`).join(', ')}]`
      : 'null',
  };

  // Build sections
  const raceInfoHtml = buildRaceInfoHtml(summary);
  const errorsHtml = buildErrorsHtml(summary.errors);
  const resultsHtml = buildResultsHtml(summary.comparisons || [], racers, summary.clickCounts);
  const profileHtml = buildProfileHtml(summary.profileComparison || null, racers);
  const filesHtml = buildFilesHtml(racers, videoFiles, {
    fullVideoFiles, mergedVideoFile, traceFiles, altFormat, altFiles,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${PAGE_CSS}${layoutCss}</style>
</head>
<body>

<div class="checkered-bar"></div>

<h1>Race for the Prize</h1>
<div class="winner-banner">${winnerBanner}</div>
${raceInfoHtml}
${errorsHtml}
${modeToggle}

<div class="player-container" id="playerContainer">
${videoElements}
</div>
${mergedVideoElement}

<div class="controls">
  <div class="controls-row">
    <button class="frame-btn" id="prevFrame" title="Previous frame (\\u2190)">◀◀</button>
    <button class="play-btn" id="playBtn">▶</button>
    <button class="frame-btn" id="nextFrame" title="Next frame (\\u2192)">▶▶</button>
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
</div>

<div class="section">
  <h2>Results</h2>
${resultsHtml}
</div>

${profileHtml}

${filesHtml}

<div class="checkered-bar"></div>

<script>
${buildPlayerScript(scriptConfig)}
</script>
</body>
</html>`;
}
