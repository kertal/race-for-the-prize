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
  doc.querySelectorAll('#exportHtmlBtn, #exportBtn, #exportHtmlOnlyBtn, #exportAnalysisBtn').forEach(el => el.remove());
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
  if (racerFilter) { racerFilter.innerHTML = ''; racerFilter.style.display = 'none'; }
  if (!slim) {
    const segNav = doc.querySelector('#segmentNav');
    if (segNav) { segNav.innerHTML = ''; segNav.style.display = 'none'; }
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
  document.body.appendChild(overlay);
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
    ui.progressFill.style.width = (fetched / total * maxProgress).toFixed(0) + '%';
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

// Fetch non-video assets and add them as separate ZIP entries. Each entry is a
// plain path (zipped under the same name) or a { srcPath, zipPath, onAdded }
// object for renamed entries. Returns the running fetched count, or null if aborted.
async function bundleOtherFiles(entries, zipBuilder, ctx) {
  const { failedFiles, optionalPaths, ui, total, maxProgress = 80 } = ctx;
  let fetched = ctx.fetched;
  for (const entry of entries) {
    const srcPath = typeof entry === 'string' ? entry : entry.srcPath;
    const zipPath = typeof entry === 'string' ? entry : entry.zipPath;
    if (ui.abortCtrl.signal.aborted) return null;
    fetched++;
    ui.statusEl.textContent = 'Fetching ' + srcPath + ' (' + fetched + '/' + total + ')';
    ui.progressFill.style.width = (fetched / total * maxProgress).toFixed(0) + '%';
    try {
      const resp = await fetch(srcPath, { signal: ui.abortCtrl.signal });
      if (resp.ok) {
        zipBuilder.addFile(zipPath, new Uint8Array(await resp.arrayBuffer()));
        if (typeof entry !== 'string' && entry.onAdded) entry.onAdded();
      } else if (!optionalPaths.has(srcPath)) {
        failedFiles.push(srcPath);
      }
    } catch (e) {
      if (e.name === 'AbortError') return null;
      if (!optionalPaths.has(srcPath)) failedFiles.push(srcPath);
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
  ui.progressFill.style.width = '100%';
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
  ui.progressFill.style.width = '90%';
  zipBuilder.addFile('index.html', new TextEncoder().encode(buildExportHtml(pathOverrides)));

  ui.statusEl.textContent = 'Creating ZIP...';
  ui.progressFill.style.width = '95%';
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
  ui.progressFill.style.width = '95%';
  const blob = new Blob([buildExportHtml(pathOverrides, { slim: true })], { type: 'text/html' });
  offerDownload(ui, blob, exportBaseName() + '.html', 'Download HTML', failedFiles);
}

const exportHtmlOnlyBtn = document.getElementById('exportHtmlOnlyBtn');
if (exportHtmlOnlyBtn) {
  exportHtmlOnlyBtn.addEventListener('click', startHtmlOnlyExport);
}

// --- Performance data export -------------------------------------------------
// Bundles everything needed for deeper performance analysis in external tools:
// per-racer DevTools traces, HAR files, summary.json, a flat metrics.csv, and
// a README explaining how to load each file.

// Quote a CSV cell when it contains a comma, quote, or newline.
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

// Flatten race timings and profile metrics into one CSV table (raw values, one column per racer).
function buildMetricsCsv(summaryData) {
  const racers = summaryData.racers || racerNames || [];
  const rows = [['scope', 'category', 'metric', ...racers, 'winner', 'diff_percent']];
  for (const comp of (summaryData.comparisons || [])) {
    rows.push([
      'race', 'timing', comp.name + ' (s)',
      ...racers.map((_, i) => comp.racers && comp.racers[i] ? comp.racers[i].duration : ''),
      comp.winner || '',
      comp.diffPercent != null ? comp.diffPercent.toFixed(1) : '',
    ]);
  }
  const profileComps = summaryData.profileComparison?.comparisons || [];
  for (const comp of profileComps) {
    rows.push([
      comp.scope || '', comp.category || '', comp.name,
      ...racers.map((_, i) => comp.values && comp.values[i] != null ? comp.values[i] : ''),
      comp.winner || '',
      comp.diffPercent != null ? comp.diffPercent.toFixed(1) : '',
    ]);
  }
  if (rows.length === 1) return null;
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

// Describe the bundle contents and how to load each file into external analysis tools.
function buildAnalysisReadme(bundled) {
  const lines = [
    '# Performance Analysis Bundle',
    '',
    'Exported from the Race for the Prize player: ' + document.title,
    '',
    '## Contents',
  ];
  if (bundled.traces) lines.push('- `traces/<racer>.trace.json` — Chrome DevTools performance trace per racer');
  if (bundled.hars) lines.push('- `har/<racer>.har` — HTTP Archive of network activity per racer');
  if (bundled.summary) lines.push('- `summary.json` — full race results: timings, raw profile metrics, comparisons');
  if (bundled.csv) lines.push('- `metrics.csv` — flat metric table, one row per metric, one raw-value column per racer');
  lines.push(
    '',
    '## How to analyze',
    '- **Traces**: drop a `.trace.json` into https://ui.perfetto.dev, or load it in the',
    '  Chrome DevTools Performance panel ("Load profile…"). The `race:recording:*` and',
    '  `race:measure:*` markers bracket the recorded and measured periods.',
    '- **HAR**: import into the DevTools Network panel or any HAR viewer to inspect',
    '  individual requests, timings, and headers.',
    '- **metrics.csv**: open in a spreadsheet. All metrics are "lower is better";',
    '  `scope` is `measured` (between raceStart/raceEnd) or `total` (whole session).',
    '- **summary.json**: `profileMetrics` holds raw per-racer values;',
    '  `profileComparison` holds computed winners, diffs, and rankings.',
    ''
  );
  return lines.join('\n');
}

// Export a performance-analysis ZIP: DevTools traces, HARs, summary.json, metrics.csv, and a README.
async function startAnalysisExport() {
  const ui = setupExportOverlay('Exporting Performance Data');

  // Per-racer analysis files, in the same (placement) order as racerNames
  const bundled = { traces: false, hars: false, summary: false, csv: false };
  const racerFiles = [];
  const addRacerFiles = (paths, dir, ext, kind) => (paths || []).forEach((p, i) => {
    if (p && !p.startsWith('data:')) {
      racerFiles.push({
        srcPath: p,
        zipPath: dir + '/' + (racerNames[i] || 'racer' + i) + ext,
        onAdded: () => { bundled[kind] = true; },
      });
    }
  });
  addRacerFiles(tracePaths, 'traces', '.trace.json', 'traces');
  addRacerFiles(harPaths, 'har', '.har', 'hars');

  const zipBuilder = createZipBuilder();
  const failedFiles = [];
  const total = racerFiles.length + 1; // +1 for summary.json

  ui.statusEl.textContent = 'Fetching summary.json (1/' + total + ')';
  try {
    const resp = await fetch('summary.json', { signal: ui.abortCtrl.signal });
    if (resp.ok) {
      const text = await resp.text();
      zipBuilder.addFile('summary.json', new TextEncoder().encode(text));
      bundled.summary = true;
      try {
        const csv = buildMetricsCsv(JSON.parse(text));
        if (csv) {
          zipBuilder.addFile('metrics.csv', new TextEncoder().encode(csv));
          bundled.csv = true;
        }
      } catch { /* unparsable summary — raw file is still in the ZIP */ }
    } else {
      failedFiles.push('summary.json');
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    failedFiles.push('summary.json');
  }
  ui.progressFill.style.width = (1 / total * 90).toFixed(0) + '%';

  const afterRacerFiles = await bundleOtherFiles(racerFiles, zipBuilder,
    { failedFiles, optionalPaths: new Set(), ui, total, maxProgress: 90, fetched: 1 });
  if (afterRacerFiles === null) return;

  if (!bundled.traces && !bundled.hars && !bundled.summary) {
    ui.statusEl.textContent = 'No performance data could be loaded. If this page was opened from disk, serve the results directory over HTTP and retry.';
    ui.progressFill.style.width = '100%';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => ui.overlay.remove());
    ui.actionsEl.replaceChildren(closeBtn);
    return;
  }

  ui.statusEl.textContent = 'Creating ZIP...';
  ui.progressFill.style.width = '95%';
  zipBuilder.addFile('README.md', new TextEncoder().encode(buildAnalysisReadme(bundled)));
  offerDownload(ui, zipBuilder.toBlob(), exportBaseName() + '-performance-data.zip', 'Download ZIP', failedFiles);
}

const exportAnalysisBtn = document.getElementById('exportAnalysisBtn');
if (exportAnalysisBtn) {
  exportAnalysisBtn.addEventListener('click', startAnalysisExport);
}
