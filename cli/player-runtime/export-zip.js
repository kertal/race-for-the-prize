/* eslint-env browser */
/**
 * export-zip.js — Self-contained HTML export flows: clones the live DOM,
 * bakes adjusted clip times and embedded video data URIs into the page,
 * and downloads it as a single HTML file or a ZIP (built by zip.cjs)
 * bundling non-video assets.
 */

// Rewrite the cloned #race-config JSON block with calibrated clip times and
// (when embedding) data-URI video paths. Escaping must match videoplayer.js
// serializeRaceConfig (the canonical form) so the exported page can't break
// out of the script/JSON context.
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
  configScript.textContent = JSON.stringify(cfg).replaceAll('<', String.raw`\u003c`);
}

function removeEl(doc, selector) {
  const el = doc.querySelector(selector);
  if (el) el.remove();
}

// Drop a duplicated set of racer cards if runtime state cloned them.
function dedupeRacerCards(doc) {
  const racerCards = Array.from(doc.querySelectorAll('#playerContainer .racer'));
  const expectedRacers = Array.isArray(raceVideoPaths) ? raceVideoPaths.filter(Boolean).length : 0;
  if (expectedRacers > 0 && racerCards.length > expectedRacers) {
    racerCards.slice(expectedRacers).forEach((el) => el.remove());
  }
}

// Remove interactive chrome that has no meaning in an exported file.
function stripExportChrome(doc) {
  removeEl(doc, '#debugPanel');
  removeEl(doc, '#modeDebug');
  doc.querySelectorAll('#exportHtmlBtn, #exportBtn, #exportHtmlOnlyBtn').forEach(el => el.remove());
  doc.querySelectorAll('.run-nav').forEach(el => el.remove());
  doc.querySelectorAll('.export-overlay').forEach(el => el.remove());
}

// Bake current notes into the HTML so they survive without localStorage.
function bakeNotes(doc) {
  const notesEl = doc.querySelector('#notesTextarea');
  if (notesEl && notesTextarea) notesEl.textContent = notesTextarea.value;
}

// Remove file links that point at videos now embedded in the HTML.
function removeEmbeddedFileLinks(doc, pathOverrides) {
  doc.querySelectorAll('.file-links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href && pathOverrides[href]) {
      const li = a.closest('li');
      if (li) li.remove(); else a.remove();
    }
  });
}

// Strip non-essential sections for a minimal single-file export.
function stripSlimSections(doc) {
  doc.querySelectorAll('.file-links').forEach(el => {
    const section = el.closest('details.section') || el.closest('.section');
    if (section) section.remove(); else el.remove();
  });
  removeEl(doc, '#settingsPanel');
  removeEl(doc, '#settingsToggle');
  const shBtn = doc.querySelector('#shareToggle');
  if (shBtn) { const group = shBtn.closest('.header-icon-group'); if (group) group.remove(); else shBtn.remove(); }
}

// Clear dynamically-built UI so the script rebuilds it cleanly on load.
function clearDynamicUi(doc, slim) {
  const racerFilter = doc.querySelector('#racerFilter');
  if (racerFilter) { racerFilter.replaceChildren(); racerFilter.style.display = 'none'; }
  if (!slim) {
    const segNav = doc.querySelector('#segmentNav');
    if (segNav) { segNav.replaceChildren(); segNav.style.display = 'none'; }
  }
}

// Point <video> src attributes at embedded data URIs so playback needs no JS.
function applyVideoOverrides(doc, pathOverrides) {
  raceVideoPaths.forEach((p, i) => {
    if (!p || !pathOverrides[p]) return;
    const vid = doc.querySelector('#v' + i);
    if (vid) vid.setAttribute('src', pathOverrides[p]);
  });
  const mv = doc.querySelector('#mergedVideo');
  if (mv) {
    const mvSrc = mv.getAttribute('src');
    if (mvSrc && pathOverrides[mvSrc]) mv.setAttribute('src', pathOverrides[mvSrc]);
  }
}

function buildExportHtml(pathOverrides = {}, { slim = false } = {}) {
  const doc = document.documentElement.cloneNode(true);
  const hasOverrides = Object.keys(pathOverrides).length > 0;

  dedupeRacerCards(doc);
  stripExportChrome(doc);
  bakeNotes(doc);
  if (hasOverrides) removeEmbeddedFileLinks(doc, pathOverrides);
  if (slim) stripSlimSections(doc);
  clearDynamicUi(doc, slim);
  // Embed videos as data URIs on the elements and in #race-config so
  // resolveEmbeddedVideos can upgrade them to seekable Blob URLs at runtime.
  if (hasOverrides) applyVideoOverrides(doc, pathOverrides);
  bakeRaceConfig(doc, pathOverrides, hasOverrides);

  return '<!DOCTYPE html>\n' + doc.outerHTML;
}

// Create the export progress overlay and its abort controller.
function setupExportOverlay(titleText) {
  const tmpl = document.getElementById('tmpl-export-overlay');
  const overlay = tmpl.content.cloneNode(true).firstElementChild;
  overlay.querySelector('.export-canvas').style.display = 'none';
  overlay.querySelector('h3').textContent = titleText;
  mountExportDialog(overlay);
  const abortCtrl = new AbortController();
  overlay.querySelector('.export-cancel').addEventListener('click', () => { abortCtrl.abort(); overlay.remove(); });
  return {
    overlay,
    abortCtrl,
    progressFill: overlay.querySelector('.export-progress-fill'),
    statusEl: overlay.querySelector('.export-status'),
    actionsEl: overlay.querySelector('.export-actions'),
  };
}

// Collect non-embedded (http/relative) video paths from config and the merged element.
function collectEmbeddableVideoPaths() {
  const videoPaths = new Set();
  const add = p => { if (p && !p.startsWith('data:')) videoPaths.add(p); };
  raceVideoPaths.forEach(add);
  if (fullVideoPaths) fullVideoPaths.forEach(add);
  if (mergedVideo) add(mergedVideo.getAttribute('src'));
  return videoPaths;
}

// Fetch each video and store a data URI in pathOverrides. Returns the running
// fetched count, or null if the export was aborted.
async function embedVideos(videoPaths, ctx) {
  const { pathOverrides, failedFiles, ui, total, maxProgress } = ctx;
  let fetched = ctx.fetched;
  for (const vPath of videoPaths) {
    if (ui.abortCtrl.signal.aborted) return null;
    fetched++;
    ui.statusEl.textContent = 'Embedding ' + vPath + ' (' + fetched + '/' + total + ')';
    setExportProgress(ui.progressFill, fetched / total * maxProgress);
    try {
      const resp = await fetch(vPath, { signal: ui.abortCtrl.signal });
      if (resp.ok) pathOverrides[vPath] = await blobToDataUri(await resp.blob());
      else failedFiles.push(vPath);
    } catch (e) {
      if (e.name === 'AbortError') return null;
      failedFiles.push(vPath);
    }
  }
  return fetched;
}

// Fetch non-video assets and add them as separate ZIP entries. Returns null if aborted.
async function bundleOtherFiles(otherPaths, zipBuilder, ctx) {
  const { failedFiles, optionalPaths, ui, total } = ctx;
  let fetched = ctx.fetched;
  for (const filePath of otherPaths) {
    if (ui.abortCtrl.signal.aborted) return null;
    fetched++;
    ui.statusEl.textContent = 'Fetching ' + filePath + ' (' + fetched + '/' + total + ')';
    setExportProgress(ui.progressFill, fetched / total * 80);
    try {
      const resp = await fetch(filePath, { signal: ui.abortCtrl.signal });
      if (resp.ok) zipBuilder.addFile(filePath, new Uint8Array(await resp.arrayBuffer()));
      else if (!optionalPaths.has(filePath)) failedFiles.push(filePath);
    } catch (e) {
      if (e.name === 'AbortError') return null;
      if (!optionalPaths.has(filePath)) failedFiles.push(filePath);
    }
  }
  return fetched;
}

// Slugify the document title into a safe download filename base.
function exportBaseName() {
  return document.title.replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_').toLowerCase() || 'race-export';
}

// Finish the overlay with a completion message and a download button.
function offerDownload(ui, blob, filename, label, failedFiles) {
  const url = URL.createObjectURL(blob);
  let statusMsg = 'Export complete! (' + (blob.size / (1024 * 1024)).toFixed(1) + ' MB)';
  if (failedFiles.length > 0) {
    statusMsg += '\nSkipped ' + failedFiles.length + ' file(s): ' + failedFiles.join(', ');
  }
  ui.statusEl.textContent = statusMsg;
  setExportProgress(ui.progressFill, 100);
  const dlLink = document.createElement('a');
  dlLink.href = url;
  dlLink.download = filename;
  dlLink.textContent = label;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { URL.revokeObjectURL(url); ui.overlay.remove(); });
  ui.actionsEl.replaceChildren(dlLink, closeBtn);
}

async function startHtmlExport() {
  pausePlayback();
  const ui = setupExportOverlay('Exporting HTML');

  // Embed videos in the HTML; bundle other assets (traces, summary) as ZIP entries.
  const videoPaths = collectEmbeddableVideoPaths();
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
  const pathOverrides = {};
  const afterVideos = await embedVideos(videoPaths, { pathOverrides, failedFiles, ui, total, maxProgress: 80, fetched: 0 });
  if (afterVideos === null) return;

  const zipBuilder = createZipBuilder();
  const afterOthers = await bundleOtherFiles(otherPaths, zipBuilder, { failedFiles, optionalPaths, ui, total, fetched: afterVideos });
  if (afterOthers === null) return;

  ui.statusEl.textContent = 'Building HTML...';
  setExportProgress(ui.progressFill, 90);
  zipBuilder.addFile('index.html', new TextEncoder().encode(buildExportHtml(pathOverrides)));

  ui.statusEl.textContent = 'Creating ZIP...';
  setExportProgress(ui.progressFill, 95);
  offerDownload(ui, zipBuilder.toBlob(), exportBaseName() + '.zip', 'Download ZIP', failedFiles);
}

const exportHtmlBtn = document.getElementById('exportHtmlBtn');
if (exportHtmlBtn) {
  exportHtmlBtn.addEventListener('click', startHtmlExport);
}

/** Export a single self-contained HTML file (no ZIP, no extra assets). */
async function startHtmlOnlyExport() {
  pausePlayback();
  const ui = setupExportOverlay('Exporting HTML');

  const videoPaths = collectEmbeddableVideoPaths();
  const failedFiles = [];
  const pathOverrides = {};
  const afterVideos = await embedVideos(videoPaths, { pathOverrides, failedFiles, ui, total: videoPaths.size, maxProgress: 90, fetched: 0 });
  if (afterVideos === null) return;

  ui.statusEl.textContent = 'Building HTML...';
  setExportProgress(ui.progressFill, 95);
  const blob = new Blob([buildExportHtml(pathOverrides, { slim: true })], { type: 'text/html' });
  offerDownload(ui, blob, exportBaseName() + '.html', 'Download HTML', failedFiles);
}

const exportHtmlOnlyBtn = document.getElementById('exportHtmlOnlyBtn');
if (exportHtmlOnlyBtn) {
  exportHtmlOnlyBtn.addEventListener('click', startHtmlOnlyExport);
}
