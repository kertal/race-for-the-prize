/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * side-by-side video player for race results.
 */

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles) {
  const [video1, video2] = videoFiles;
  const racer1 = summary.racers[0];
  const racer2 = summary.racers[1];
  const comparisons = summary.comparisons || [];
  const overallWinner = summary.overallWinner;

  const resultsRows = comparisons.map(comp => {
    const d0 = comp.racers[0] ? `${comp.racers[0].duration.toFixed(3)}s` : '-';
    const d1 = comp.racers[1] ? `${comp.racers[1].duration.toFixed(3)}s` : '-';
    const winner = comp.winner || '-';
    const diff = comp.diffPercent !== null ? `${comp.diffPercent.toFixed(1)}%` : '-';
    const w0 = comp.winner === racer1 ? ' class="winner"' : '';
    const w1 = comp.winner === racer2 ? ' class="winner"' : '';
    const wc = comp.winner ? ' class="winner-col"' : '';
    return `<tr><td>${comp.name}</td><td${w0}>${d0}</td><td${w1}>${d1}</td><td${wc}>${winner}</td><td>${diff}</td></tr>`;
  }).join('\n        ');

  const winnerBanner = overallWinner === 'tie'
    ? `<span class="trophy">&#129309;</span> It's a Tie!`
    : overallWinner
      ? `<span class="trophy">&#127942;</span> ${overallWinner.toUpperCase()} wins!`
      : '';

  const downloadLinks = altFormat && altFiles
    ? `<div class="downloads">
  <h2>Downloads</h2>
  <div class="download-links">
    <a href="${altFiles[0]}" download>${racer1} (.${altFormat})</a>
    <a href="${altFiles[1]}" download>${racer2} (.${altFormat})</a>
  </div>
</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Race: ${racer1} vs ${racer2}</title>
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
  .player-container {
    display: flex;
    gap: 1rem;
    padding: 0 1.5rem;
    max-width: 1400px;
    width: 100%;
    justify-content: center;
  }
  .racer {
    flex: 1;
    max-width: 680px;
    text-align: center;
  }
  .racer-label {
    font-family: Georgia, serif;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.5rem 0;
  }
  .racer:first-child .racer-label { color: #e74c3c; }
  .racer:last-child .racer-label { color: #3498db; }
  video {
    width: 100%;
    border: 2px solid #333;
    border-radius: 4px;
    background: #000;
  }
  .controls {
    max-width: 900px;
    width: 100%;
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
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
    font-size: 0.8rem;
    color: #999;
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

<div class="player-container">
  <div class="racer">
    <div class="racer-label">${racer1}</div>
    <video id="v1" src="${video1}" preload="auto" muted></video>
  </div>
  <div class="racer">
    <div class="racer-label">${racer2}</div>
    <video id="v2" src="${video2}" preload="auto" muted></video>
  </div>
</div>

<div class="controls">
  <button class="frame-btn" id="prevFrame" title="Previous frame (←)">&#9664;&#9664;</button>
  <button class="play-btn" id="playBtn">&#9654;</button>
  <button class="frame-btn" id="nextFrame" title="Next frame (→)">&#9654;&#9654;</button>
  <input type="range" class="scrubber" id="scrubber" min="0" max="1000" value="0">
  <span class="time-display" id="timeDisplay">0:00 / 0:00</span>
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
      <tr><th>Measurement</th><th>${racer1}</th><th>${racer2}</th><th>Winner</th><th>Diff</th></tr>
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
  const v1 = document.getElementById('v1');
  const v2 = document.getElementById('v2');
  const playBtn = document.getElementById('playBtn');
  const scrubber = document.getElementById('scrubber');
  const timeDisplay = document.getElementById('timeDisplay');
  const speedSelect = document.getElementById('speedSelect');

  let playing = false;
  let duration = 0;

  function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function onMeta() {
    duration = Math.max(v1.duration || 0, v2.duration || 0);
    timeDisplay.textContent = fmt(0) + ' / ' + fmt(duration);
  }
  v1.addEventListener('loadedmetadata', onMeta);
  v2.addEventListener('loadedmetadata', onMeta);

  playBtn.addEventListener('click', function() {
    if (playing) {
      v1.pause(); v2.pause();
      playBtn.innerHTML = '&#9654;';
    } else {
      v1.play(); v2.play();
      playBtn.innerHTML = '&#9646;&#9646;';
    }
    playing = !playing;
  });

  v1.addEventListener('ended', function() {
    playing = false;
    playBtn.innerHTML = '&#9654;';
  });

  v1.addEventListener('timeupdate', function() {
    if (duration > 0) {
      scrubber.value = (v1.currentTime / duration) * 1000;
      timeDisplay.textContent = fmt(v1.currentTime) + ' / ' + fmt(duration);
    }
  });

  scrubber.addEventListener('input', function() {
    const t = (scrubber.value / 1000) * duration;
    v1.currentTime = t;
    v2.currentTime = t;
  });

  speedSelect.addEventListener('change', function() {
    const rate = parseFloat(speedSelect.value);
    v1.playbackRate = rate;
    v2.playbackRate = rate;
  });

  const FRAME = 1 / 30;
  function stepFrame(delta) {
    if (playing) { v1.pause(); v2.pause(); playing = false; playBtn.innerHTML = '&#9654;'; }
    const t = Math.max(0, Math.min(duration, v1.currentTime + delta));
    v1.currentTime = t;
    v2.currentTime = t;
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
