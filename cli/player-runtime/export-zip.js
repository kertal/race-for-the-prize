/* eslint-env browser */
/**
 * export-zip.js — Self-contained HTML export flows: clones the live DOM,
 * bakes adjusted clip times and embedded video data URIs into the page,
 * and downloads it as a single HTML file or a ZIP (built by zip.cjs)
 * bundling non-video assets.
 */

// Rewrite the cloned #race-config JSON block with calibrated clip times and
// (when embedding) data-URI video paths. Escaping must match videoplayer.js
// serializeRaceConfig (the canonical form) so exports stay </script>-safe.
function bakeRaceConfig(doc, pathOverrides, hasOverrides) {
  const configScript = doc.querySelector('#race-config');
  if (!configScript) return;
  let cfg = null;
  try { cfg = JSON.parse(configScript.textContent); } catch { cfg = null; }
  if (!cfg) return;

  const adj = getAdjustedClipTimes();
  if (adj && clipTimes) {
    cfg.clipTimes = adj.map((ct, i) => {
      if (!ct) return null;
      const orig = clipTimes[i] || {};
      return {
        start: ct.start,
        end: ct.end,
        _converted: true,
        calibratedStart: ct.start,
        calibratedEnd: ct.end,
        _wcStart: orig._wcStart != null ? orig._wcStart : ct.start,
        _wcEnd: orig._wcEnd != null ? orig._wcEnd : ct.end,
        wallClockDuration: orig.wallClockDuration || 0,
        recordingOffset: orig.recordingOffset || 0,
        measurements: orig.measurements || [],
      };
    });
  }
  if (hasOverrides) {
    const mapPath = p => (p && pathOverrides[p]) ? pathOverrides[p] : p;
    if (Array.isArray(cfg.raceVideoPaths)) cfg.raceVideoPaths = cfg.raceVideoPaths.map(mapPath);
    if (Array.isArray(cfg.fullVideoPaths)) cfg.fullVideoPaths = cfg.fullVideoPaths.map(mapPath);
  }
  configScript.textContent = JSON.stringify(cfg).replaceAll('<', '\\u003c');
}

function buildExportHtml(pathOverrides = {}, { slim = false } = {}) {
  const doc = document.documentElement.cloneNode(true);

  // Defensive cleanup: if runtime state duplicated racer cards, keep one set.
  const racerCards = Array.from(doc.querySelectorAll('#playerContainer .racer'));
  const expectedRacers = Array.isArray(raceVideoPaths) ? raceVideoPaths.filter(Boolean).length : 0;
  if (expectedRacers > 0 && racerCards.length > expectedRacers) {
    racerCards.slice(expectedRacers).forEach((el) => el.remove());
  }

  // Remove debug/calibration panel and button
  const dp = doc.querySelector('#debugPanel');
  if (dp) dp.remove();
  const calBtn = doc.querySelector('#modeDebug');
  if (calBtn) calBtn.remove();

  // Remove export buttons (HTML export already done, video export needs ffmpeg assets not in ZIP)
  doc.querySelectorAll('#exportHtmlBtn, #exportBtn, #exportHtmlOnlyBtn').forEach(el => el.remove());

  // Remove run navigation links (they point to sibling result dirs not included in export)
  doc.querySelectorAll('.run-nav').forEach(el => el.remove());

  // Remove any active export overlays
  doc.querySelectorAll('.export-overlay').forEach(el => el.remove());

  // Bake current notes into the exported HTML so they appear without localStorage
  const notesEl = doc.querySelector('#notesTextarea');
  if (notesEl && notesTextarea) {
    notesEl.textContent = notesTextarea.value;
  }

  // Remove file links pointing to embedded videos (they're in the HTML, not as separate files)
  if (Object.keys(pathOverrides).length > 0) {
    doc.querySelectorAll('.file-links a').forEach(a => {
      const href = a.getAttribute('href');
      if (href && pathOverrides[href]) {
        const li = a.closest('li');
        if (li) li.remove(); else a.remove();
      }
    });
  }

  // In slim mode, strip non-essential sections for a minimal self-contained page
  if (slim) {
    doc.querySelectorAll('.file-links').forEach(el => {
      const section = el.closest('details.section') || el.closest('.section');
      if (section) section.remove(); else el.remove();
    });
    // Remove settings panel (segment nav, mode toggle, calibration)
    const sp = doc.querySelector('#settingsPanel');
    if (sp) sp.remove();
    const stBtn = doc.querySelector('#settingsToggle');
    if (stBtn) stBtn.remove();
    // Remove share menu and toggle
    const shBtn = doc.querySelector('#shareToggle');
    if (shBtn) { const group = shBtn.closest('.header-icon-group'); if (group) group.remove(); else shBtn.remove(); }
  }

  // Clear dynamically-built UI so the script rebuilds it cleanly on load
  // (cloneNode captures live DOM state; without clearing, buttons are doubled)
  const racerFilter = doc.querySelector('#racerFilter');
  if (racerFilter) { racerFilter.innerHTML = ''; racerFilter.style.display = 'none'; }
  if (!slim) {
    const segNav = doc.querySelector('#segmentNav');
    if (segNav) { segNav.innerHTML = ''; segNav.style.display = 'none'; }
  }

  // Embed video paths: set data URIs directly on <video> src attributes so videos
  // play immediately without JavaScript, and patch the JS config so resolveEmbeddedVideos
  // can still upgrade them to seekable Blob URLs at runtime.
  const hasOverrides = Object.keys(pathOverrides).length > 0;
  if (hasOverrides) {
    // Race video elements: raceVideoPaths[i] maps to <video id="v{i}">
    raceVideoPaths.forEach((p, i) => {
      if (!p || !pathOverrides[p]) return;
      const vid = doc.querySelector('#v' + i);
      if (vid) vid.setAttribute('src', pathOverrides[p]);
    });
    // Merged video element
    const mv = doc.querySelector('#mergedVideo');
    if (mv) {
      const mvSrc = mv.getAttribute('src');
      if (mvSrc && pathOverrides[mvSrc]) mv.setAttribute('src', pathOverrides[mvSrc]);
    }
  }

  // Bake adjusted clip times and video path overrides into the #race-config
  // JSON block so the exported page loads with calibrated clips and (when
  // embedding) data-URI sources that resolveEmbeddedVideos upgrades to Blob URLs.
  bakeRaceConfig(doc, pathOverrides, hasOverrides);

  return '<!DOCTYPE html>\n' + doc.outerHTML;
}

async function startHtmlExport() {
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }

  const tmpl = document.getElementById('tmpl-export-overlay');
  const overlay = tmpl.content.cloneNode(true).firstElementChild;
  const canvas = overlay.querySelector('.export-canvas');
  canvas.style.display = 'none';
  const titleEl = overlay.querySelector('h3');
  titleEl.textContent = 'Exporting HTML';
  document.body.appendChild(overlay);

  const progressFill = overlay.querySelector('.export-progress-fill');
  const statusEl = overlay.querySelector('.export-status');
  const actionsEl = overlay.querySelector('.export-actions');

  const abortCtrl = new AbortController();
  overlay.querySelector('.export-cancel').addEventListener('click', () => {
    abortCtrl.abort();
    overlay.remove();
  });

  // Collect video paths to embed and non-video paths to bundle as separate ZIP entries
  const videoPaths = new Set();
  raceVideoPaths.forEach(p => { if (p && !p.startsWith('data:')) videoPaths.add(p); });
  if (fullVideoPaths) fullVideoPaths.forEach(p => { if (p && !p.startsWith('data:')) videoPaths.add(p); });
  if (mergedVideo) {
    const mp = mergedVideo.getAttribute('src');
    if (mp && !mp.startsWith('data:')) videoPaths.add(mp);
  }

  const otherPaths = new Set();
  const optionalPaths = new Set(['summary.json']);
  document.querySelectorAll('.file-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('http') && !href.startsWith('//') && !href.startsWith('data:') && !videoPaths.has(href)) {
      otherPaths.add(href);
    }
  });
  otherPaths.add('summary.json');

  const total = videoPaths.size + otherPaths.size;
  const failedFiles = [];
  let fetched = 0;

  // Embed videos as data URIs directly in the exported HTML
  const pathOverrides = {};
  for (const vPath of videoPaths) {
    if (abortCtrl.signal.aborted) return;
    fetched++;
    statusEl.textContent = 'Embedding ' + vPath + ' (' + fetched + '/' + total + ')';
    progressFill.style.width = (fetched / total * 80).toFixed(0) + '%';
    try {
      const resp = await fetch(vPath, { signal: abortCtrl.signal });
      if (resp.ok) {
        pathOverrides[vPath] = await blobToDataUri(await resp.blob());
      } else {
        failedFiles.push(vPath);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      failedFiles.push(vPath);
    }
  }

  // Bundle non-video assets (trace files, summary, etc.) as separate ZIP entries
  const zipBuilder = createZipBuilder();
  for (const filePath of otherPaths) {
    if (abortCtrl.signal.aborted) return;
    fetched++;
    statusEl.textContent = 'Fetching ' + filePath + ' (' + fetched + '/' + total + ')';
    progressFill.style.width = (fetched / total * 80).toFixed(0) + '%';
    try {
      const resp = await fetch(filePath, { signal: abortCtrl.signal });
      if (resp.ok) {
        zipBuilder.addFile(filePath, new Uint8Array(await resp.arrayBuffer()));
      } else {
        if (!optionalPaths.has(filePath)) failedFiles.push(filePath);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (!optionalPaths.has(filePath)) failedFiles.push(filePath);
    }
  }

  if (abortCtrl.signal.aborted) return;

  statusEl.textContent = 'Building HTML...';
  progressFill.style.width = '90%';
  const html = buildExportHtml(pathOverrides);
  zipBuilder.addFile('index.html', new TextEncoder().encode(html));

  statusEl.textContent = 'Creating ZIP...';
  progressFill.style.width = '95%';
  const blob = zipBuilder.toBlob();
  const url = URL.createObjectURL(blob);

  let statusMsg = 'Export complete! (' + (blob.size / (1024 * 1024)).toFixed(1) + ' MB)';
  if (failedFiles.length > 0) {
    statusMsg += '\nSkipped ' + failedFiles.length + ' file(s): ' + failedFiles.join(', ');
  }
  statusEl.textContent = statusMsg;
  progressFill.style.width = '100%';

  const dlLink = document.createElement('a');
  dlLink.href = url;
  const zipName = document.title.replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_').toLowerCase();
  dlLink.download = (zipName || 'race-export') + '.zip';
  dlLink.textContent = 'Download ZIP';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { URL.revokeObjectURL(url); overlay.remove(); });
  actionsEl.replaceChildren(dlLink, closeBtn);
}

const exportHtmlBtn = document.getElementById('exportHtmlBtn');
if (exportHtmlBtn) {
  exportHtmlBtn.addEventListener('click', startHtmlExport);
}

/** Export a single self-contained HTML file (no ZIP, no extra assets). */
async function startHtmlOnlyExport() {
  if (playing) { videos.forEach(v => v?.pause()); playing = false; setPlayState(false); }

  const tmpl = document.getElementById('tmpl-export-overlay');
  const overlay = tmpl.content.cloneNode(true).firstElementChild;
  const canvas = overlay.querySelector('.export-canvas');
  canvas.style.display = 'none';
  const titleEl = overlay.querySelector('h3');
  titleEl.textContent = 'Exporting HTML';
  document.body.appendChild(overlay);

  const progressFill = overlay.querySelector('.export-progress-fill');
  const statusEl = overlay.querySelector('.export-status');
  const actionsEl = overlay.querySelector('.export-actions');

  const abortCtrl = new AbortController();
  overlay.querySelector('.export-cancel').addEventListener('click', () => {
    abortCtrl.abort();
    overlay.remove();
  });

  // Collect video paths to embed as data URIs
  const videoPaths = new Set();
  raceVideoPaths.forEach(p => { if (p && !p.startsWith('data:')) videoPaths.add(p); });
  if (fullVideoPaths) fullVideoPaths.forEach(p => { if (p && !p.startsWith('data:')) videoPaths.add(p); });
  if (mergedVideo) {
    const mp = mergedVideo.getAttribute('src');
    if (mp && !mp.startsWith('data:')) videoPaths.add(mp);
  }

  const total = videoPaths.size;
  const failedFiles = [];
  let fetched = 0;

  const pathOverrides = {};
  for (const vPath of videoPaths) {
    if (abortCtrl.signal.aborted) return;
    fetched++;
    statusEl.textContent = 'Embedding ' + vPath + ' (' + fetched + '/' + total + ')';
    progressFill.style.width = (fetched / total * 90).toFixed(0) + '%';
    try {
      const resp = await fetch(vPath, { signal: abortCtrl.signal });
      if (resp.ok) {
        pathOverrides[vPath] = await blobToDataUri(await resp.blob());
      } else {
        failedFiles.push(vPath);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      failedFiles.push(vPath);
    }
  }

  if (abortCtrl.signal.aborted) return;

  statusEl.textContent = 'Building HTML...';
  progressFill.style.width = '95%';
  const html = buildExportHtml(pathOverrides, { slim: true });
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  let statusMsg = 'Export complete! (' + (blob.size / (1024 * 1024)).toFixed(1) + ' MB)';
  if (failedFiles.length > 0) {
    statusMsg += '\nSkipped ' + failedFiles.length + ' file(s): ' + failedFiles.join(', ');
  }
  statusEl.textContent = statusMsg;
  progressFill.style.width = '100%';

  const dlLink = document.createElement('a');
  dlLink.href = url;
  const baseName = document.title.replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_').toLowerCase();
  dlLink.download = (baseName || 'race-export') + '.html';
  dlLink.textContent = 'Download HTML';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { URL.revokeObjectURL(url); overlay.remove(); });
  actionsEl.replaceChildren(dlLink, closeBtn);
}

const exportHtmlOnlyBtn = document.getElementById('exportHtmlOnlyBtn');
if (exportHtmlOnlyBtn) {
  exportHtmlOnlyBtn.addEventListener('click', startHtmlOnlyExport);
}
