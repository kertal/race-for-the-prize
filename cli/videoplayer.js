/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * video player for race results. Supports 2-5 racers.
 */

// Racer label colors matching RACER_COLORS from colors.js
const RACER_CSS_COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f1c40f', '#9b59b6'];

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  const { fullVideoFiles, mergedVideoFile } = options;
  const racers = summary.racers;
  const comparisons = summary.comparisons || [];
  const overallWinner = summary.overallWinner;
  const count = racers.length;

  // Generate table header columns
  const headerCols = ['Measurement', ...racers, 'Winner', 'Diff'];
  const tableHeader = headerCols.map(col => `<th>${col}</th>`).join('');

  // Generate results rows
  const resultsRows = comparisons.map(comp => {
    const durationCells = racers.map((racer, i) => {
      const duration = comp.racers[i] ? `${comp.racers[i].duration.toFixed(3)}s` : '-';
      const winClass = comp.winner === racer ? ' class="winner"' : '';
      return `<td${winClass}>${duration}</td>`;
    }).join('');
    const winner = comp.winner || '-';
    const diff = comp.diffPercent !== null ? `${comp.diffPercent.toFixed(1)}%` : '-';
    const winnerClass = comp.winner ? ' class="winner-col"' : '';
    return `<tr><td>${comp.name}</td>${durationCells}<td${winnerClass}>${winner}</td><td>${diff}</td></tr>`;
  }).join('\n        ');

  const winnerBanner = overallWinner === 'tie'
    ? `<span class="trophy">&#129309;</span> It's a Tie!`
    : overallWinner
      ? `<span class="trophy">&#127942;</span> ${overallWinner.toUpperCase()} wins!`
      : '';

  // Generate video elements for race videos
  const videoElements = racers.map((racer, i) => {
    const color = RACER_CSS_COLORS[i % RACER_CSS_COLORS.length];
    return `  <div class="racer">
    <div class="racer-label" style="color: ${color}">${racer}</div>
    <video id="v${i}" src="${videoFiles[i]}" preload="auto" muted></video>
  </div>`;
  }).join('\n');

  // Generate merged video element
  const mergedVideoElement = mergedVideoFile ? `
<div class="merged-container" id="mergedContainer" style="display: none;">
  <video id="mergedVideo" src="${mergedVideoFile}" preload="auto" muted></video>
</div>` : '';

  // Generate download links
  const downloadLinks = altFormat && altFiles
    ? `<div class="downloads">
  <h2>Downloads</h2>
  <div class="download-links">
    ${racers.map((racer, i) => `<a href="${altFiles[i]}" download>${racer} (.${altFormat})</a>`).join('\n    ')}
  </div>
</div>` : '';

  // Generate video element IDs for JavaScript
  const videoIds = racers.map((_, i) => `v${i}`);
  const videoVars = videoIds.map(id => `const ${id} = document.getElementById('${id}');`).join('\n  ');
  const videoArray = `[${videoIds.join(', ')}]`;

  // Generate full video paths for JavaScript (or null if not provided)
  const fullVideoPaths = fullVideoFiles
    ? `[${fullVideoFiles.map(f => `'${f}'`).join(', ')}]`
    : 'null';
  const raceVideoPaths = `[${videoFiles.map(f => `'${f}'`).join(', ')}]`;

  // Calculate layout-specific styles
  const maxWidth = count <= 2 ? 680 : count === 3 ? 450 : 340;
  const containerMaxWidth = count <= 2 ? 1400 : count === 3 ? 1400 : 1440;

  // Title based on racer count
  const title = count === 2
    ? `Race: ${racers[0]} vs ${racers[1]}`
    : `Race: ${racers.join(' vs ')}`;

  // Video mode toggle buttons
  const hasFullVideos = fullVideoFiles && fullVideoFiles.length > 0;
  const hasMergedVideo = !!mergedVideoFile;
  const modeToggle = (hasFullVideos || hasMergedVideo) ? `
  <div class="mode-toggle">
    <button class="mode-btn active" id="modeRace" title="Race segments only">Race</button>
    ${hasFullVideos ? '<button class="mode-btn" id="modeFull" title="Full recordings">Full</button>' : ''}
    ${hasMergedVideo ? '<button class="mode-btn" id="modeMerged" title="Side-by-side merged video">Merged</button>' : ''}
  </div>` : '';

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
  .results-table, .downloads {
    max-width: 900px;
    width: 100%;
    padding: 0.5rem 1.5rem 1rem;
  }
  .results-table h2, .downloads h2 {
    font-family: Georgia, serif;
    color: #d4af37;
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th {
    background: #2a2a2a;
    color: #d4af37;
    padding: 0.5rem;
    text-align: left;
    border-bottom: 2px solid #d4af37;
  }
  td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid #333;
  }
  td.winner { color: #4ecdc4; font-weight: bold; }
  td.winner-col { color: #d4af37; }

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
</style>
</head>
<body>

<div class="checkered-bar"></div>

<h1>Race for the Prize</h1>
<div class="winner-banner">${winnerBanner}</div>
${modeToggle}

<div class="player-container" id="playerContainer">
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
</div>

<div class="results-table">
  <h2>Results</h2>
  <table>
    <thead>
      <tr>${tableHeader}</tr>
    </thead>
    <tbody>
        ${resultsRows}
    </tbody>
  </table>
</div>

${downloadLinks}

<div class="checkered-bar"></div>

<script>
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
    videos.forEach(v => v && (v.currentTime = t));
  });

  speedSelect.addEventListener('change', function() {
    const rate = parseFloat(speedSelect.value);
    videos.forEach(v => v && (v.playbackRate = rate));
  });

  function stepFrame(delta) {
    if (playing) { videos.forEach(v => v && v.pause()); playing = false; playBtn.innerHTML = '▶'; }
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
})();
</script>
</body>
</html>`;
}
