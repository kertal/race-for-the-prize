/* eslint-env browser */
/**
 * export-video.js — Client-side side-by-side video export: canvas
 * compositing (layout via computeExportLayout in export-layout.cjs),
 * MediaRecorder capture, and ffmpeg.wasm GIF/MOV conversion.
 */

// --- Export: client-side side-by-side video stitching ---

const exportBtn = document.getElementById('exportBtn');

// Layout math lives in export-layout.cjs (computeExportLayout) so Node
// unit tests can exercise it; this wrapper supplies the live aspect ratio.
function getExportLayout(count) {
  const sample = raceVideos.find(v => v && v.videoWidth);
  const aspect = sample ? sample.videoHeight / sample.videoWidth : 9/16;
  return computeExportLayout(count, aspect);
}

function drawExportFrame(ctx, layout, clockTime, visibleIndices) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  // Draw only the visible racers, packed into the layout's slots in order.
  // Indexing positions by the original racer index would leave gaps (and size
  // mismatches) once any racer is hidden, so map the j-th visible racer to the
  // j-th slot while still using the original index for its name/colour.
  const indices = visibleIndices || raceVideos.map((_, i) => i);
  for (let j = 0; j < indices.length; j++) {
    const i = indices[j];
    const v = raceVideos[i];
    const pos = layout.positions[j];
    if (!v || !pos) continue;
    ctx.fillStyle = racerColors[i] || '#e8e0d0';
    ctx.font = 'bold 16px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(racerNames[i] || '', pos.x + layout.targetW / 2, pos.y + layout.labelH - 8);
    try { ctx.drawImage(v, pos.x, pos.y + layout.labelH, layout.targetW, layout.cellH); } catch {}
  }
  // Clock overlay: matches the ffmpeg drawtext style in sidebyside.js
  const t = clockTime != null ? clockTime : (primary ? (primary.currentTime || 0) : 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  const clockText = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  const metrics = ctx.measureText(clockText);
  const tw = metrics.width;
  const th = 22;
  const pad = 4;
  const cx = layout.canvasW / 2;
  const cy = layout.canvasH - th - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(cx - tw / 2 - pad, cy - th + pad, tw + pad * 2, th + pad);
  ctx.fillStyle = '#fff';
  ctx.fillText(clockText, cx, cy + pad);
}

// --- Browser-based format conversion via ffmpeg.wasm ---
let ffmpegInstance = null;

function toBlobURL(url, mimeType) {
  return fetch(url).then(resp => {
    if (!resp.ok) throw new Error('Failed to fetch ' + url + ' (' + resp.status + ')');
    return resp.blob();
  }).then(data => URL.createObjectURL(new Blob([data], { type: mimeType })));
}

function loadFFmpeg() {
  if (ffmpegInstance) return Promise.resolve(ffmpegInstance);
  if (location.protocol === 'file:') {
    return Promise.reject(new Error('Conversion requires HTTP(S) — serve this file via a local server (e.g. npx serve)'));
  }
  return import(ffmpegDir + 'index.js')
    .then(mod => {
      const ff = new mod.FFmpeg();
      return Promise.all([
        toBlobURL(ffmpegDir + 'ffmpeg-core.js', 'text/javascript'),
        toBlobURL(ffmpegDir + 'ffmpeg-core.wasm', 'application/wasm'),
      ]).then(urls => {
        const revoke = () => urls.forEach(u => URL.revokeObjectURL(u));
        return ff.load({ coreURL: urls[0], wasmURL: urls[1] }).then(revoke, err => { revoke(); throw err; });
      }).then(() => {
        ffmpegInstance = ff;
        return ff;
      });
    });
}

let convertCounter = 0;

function convertWithFFmpeg(blob, format, statusEl, progressFill, actionsEl, overlay, downloadName, clipRange) {
  const runId = ++convertCounter;
  const inFile = 'input_' + runId + '.webm';
  const outFile = 'output_' + runId + '.' + format;
  const outFilename = (downloadName || 'race-side-by-side') + '.' + format;
  const buttons = actionsEl.querySelectorAll('button');
  buttons.forEach(b => { b.disabled = true; });
  let cancelled = false;
  let outUrl = null;

  function revokeOutUrl() { if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; } }

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Cancel';
  dismissBtn.addEventListener('click', () => { cancelled = true; revokeOutUrl(); overlay.remove(); });
  actionsEl.appendChild(dismissBtn);
  statusEl.textContent = 'Loading ffmpeg.wasm (~25 MB)...';
  progressFill.style.width = '0%';

  window.addEventListener('pagehide', revokeOutUrl, { once: true });

  loadFFmpeg().then(ff => {
    if (cancelled) return;
    statusEl.textContent = 'Converting to ' + format.toUpperCase() + '...';
    progressFill.style.width = '30%';

    return blob.arrayBuffer().then(buf => {
      if (cancelled) return;
      return ff.writeFile(inFile, new Uint8Array(buf));
    }).then(() => {
      if (cancelled) return;
      let trimArgs = [];
      if (clipRange) {
        trimArgs = ['-ss', clipRange.start.toFixed(3), '-t', (clipRange.end - clipRange.start).toFixed(3)];
      }
      let args;
      if (format === 'gif') {
        args = trimArgs.concat(['-i', inFile, '-filter_complex',
          'fps=10,scale=640:-2,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
          outFile]);
      } else {
        args = trimArgs.concat(['-i', inFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outFile]);
      }
      progressFill.style.width = '50%';
      return ff.exec(args, 300000);
    }).then(exitCode => {
      if (cancelled) return;
      if (exitCode == null || exitCode !== 0) throw new Error('ffmpeg exited with code ' + exitCode + ' — conversion failed');
      progressFill.style.width = '90%';
      return ff.readFile(outFile);
    }).then(data => {
      if (cancelled || !data) return;
      const mType = format === 'gif' ? 'image/gif' : 'video/quicktime';
      const outBlob = new Blob([data], { type: mType });
      outUrl = URL.createObjectURL(outBlob);

      statusEl.textContent = 'Conversion complete! (' + (outBlob.size / (1024 * 1024)).toFixed(1) + ' MB)';
      progressFill.style.width = '100%';

      const dlLink = document.createElement('a');
      dlLink.href = outUrl;
      dlLink.download = outFilename;
      dlLink.textContent = 'Download ' + format.toUpperCase();

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => { revokeOutUrl(); overlay.remove(); });

      actionsEl.innerHTML = '';
      actionsEl.appendChild(dlLink);
      actionsEl.appendChild(closeBtn);

      ff.deleteFile(inFile).catch(e => { console.warn('ffmpeg cleanup:', e.message); });
      ff.deleteFile(outFile).catch(e => { console.warn('ffmpeg cleanup:', e.message); });
    });
  }).catch(err => {
    revokeOutUrl();
    // Terminate the ffmpeg worker on failure/timeout so it doesn't stay hung.
    // Setting ffmpegInstance to null forces a fresh load on the next attempt.
    if (ffmpegInstance) {
      ffmpegInstance.deleteFile(inFile).catch(() => {});
      ffmpegInstance.deleteFile(outFile).catch(() => {});
      try { ffmpegInstance.terminate(); } catch {}
      ffmpegInstance = null;
    }
    statusEl.textContent = 'Conversion failed: ' + err.message;
    buttons.forEach(b => { b.disabled = false; });
    if (dismissBtn.parentNode) dismissBtn.remove();
  });
}

async function startExport() {
  if (!HTMLCanvasElement.prototype.captureStream || !window.MediaRecorder) {
    alert('Export requires a browser that supports Canvas.captureStream and MediaRecorder (Chrome, Firefox, or Edge).');
    return;
  }
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }

  // Respect the racer filter: hidden racers must not be baked into the export.
  const visibleIndices = raceVideos.map((_, i) => i).filter(i => raceVideos[i] && !hiddenRacers.has(i));
  if (visibleIndices.length === 0) {
    alert('No visible racers to export — unhide at least one racer first.');
    return;
  }
  const layout = getExportLayout(visibleIndices.length);

  const tmpl = document.getElementById('tmpl-export-overlay');
  const overlay = tmpl.content.cloneNode(true).firstElementChild;
  const canvas = overlay.querySelector('.export-canvas');
  canvas.width = layout.canvasW;
  canvas.height = layout.canvasH;
  document.body.appendChild(overlay);

  const ctx = canvas.getContext('2d');
  const progressFill = overlay.querySelector('.export-progress-fill');
  const statusEl = overlay.querySelector('.export-status');
  const actionsEl = overlay.querySelector('.export-actions');

  const startTime = activeClip ? activeClip.start : 0;
  const endTime = activeClip ? activeClip.end : duration;
  const totalDur = endTime - startTime;

  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  // Drive seek/play/progress/completion from the visible racers only, so a
  // hidden racer can't skew the clock, extend the export, or block completion.
  // perVideoEnd is indexed by visible position j (parallel to visibleIndices).
  const perVideoEnd = visibleIndices.map((i) => {
    const v = raceVideos[i];
    if (!v) return endTime;
    return (activeClip && ct && ct[i]) ? ct[i].end : endTime;
  });

  const seekPromises = visibleIndices.map((i) => {
    const v = raceVideos[i];
    if (!v) return Promise.resolve();
    return new Promise((resolve) => {
      let target = startTime;
      if (activeClip && ct && ct[i]) {
        const elapsed = startTime - activeClip.start;
        target = ct[i].start + elapsed;
        target = Math.max(ct[i].start, Math.min(ct[i].end, target));
      }
      v.currentTime = Math.min(target, v.duration || target);
      v.onseeked = () => { v.onseeked = null; resolve(); };
    });
  });

  let cancelled = false;
  let recorder = null;
  let rafId = null;

  overlay.querySelector('.export-cancel').addEventListener('click', () => {
    cancelled = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (rafId) cancelAnimationFrame(rafId);
    visibleIndices.forEach(i => raceVideos[i]?.pause());
    overlay.remove();
  });

  await Promise.all(seekPromises);
  if (cancelled) return;
  statusEl.textContent = 'Recording...';

  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    if (cancelled) return;
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    statusEl.textContent = 'Export complete!';
    progressFill.style.width = '100%';
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'race-side-by-side.webm';
    downloadLink.textContent = 'Download';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => { URL.revokeObjectURL(url); overlay.remove(); });
    const convertRow = document.createElement('div');
    convertRow.className = 'export-convert-row';
    const gifBtn = document.createElement('button');
    gifBtn.textContent = 'Convert to GIF';
    gifBtn.addEventListener('click', () => { convertWithFFmpeg(blob, 'gif', statusEl, progressFill, actionsEl, overlay); });
    const movBtn = document.createElement('button');
    movBtn.textContent = 'Convert to MOV';
    movBtn.addEventListener('click', () => { convertWithFFmpeg(blob, 'mov', statusEl, progressFill, actionsEl, overlay); });
    convertRow.appendChild(gifBtn);
    convertRow.appendChild(movBtn);
    actionsEl.replaceChildren(downloadLink, convertRow, closeBtn);
  };

  recorder.start();
  const exportRate = parseFloat(speedSelect.value) || 1;
  visibleIndices.forEach(i => { const v = raceVideos[i]; if (v) { v.playbackRate = exportRate; v.play(); } });
  const speedLabel = exportRate !== 1 ? ' (' + exportRate + 'x)' : '';

  let exportTimeOffset = null;
  function tick() {
    if (cancelled) return;
    const cur = Math.max(...visibleIndices.map(i => raceVideos[i]?.currentTime || 0));
    if (exportTimeOffset === null) exportTimeOffset = cur;
    const elapsed = cur - exportTimeOffset;
    drawExportFrame(ctx, layout, elapsed, visibleIndices);
    const progress = totalDur > 0 ? Math.min(1, elapsed / totalDur) : 0;
    progressFill.style.width = (progress * 100).toFixed(1) + '%';
    statusEl.textContent = 'Recording' + speedLabel + '... ' + Math.round(progress * 100) + '%';
    const allDone = visibleIndices.every((i, j) => {
      const v = raceVideos[i];
      return !v || v.currentTime >= perVideoEnd[j] || v.ended;
    });
    if (allDone) {
      visibleIndices.forEach(i => raceVideos[i]?.pause());
      if (recorder.state !== 'inactive') recorder.stop();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

if (exportBtn) {
  if (raceVideos.length < 2) exportBtn.style.display = 'none';
  exportBtn.addEventListener('click', startExport);
}
