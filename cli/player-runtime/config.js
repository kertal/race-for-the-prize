/* eslint-env browser */
/**
 * config.js — Config load and DOM bootstrap.
 *
 * Part of the browser-side player runtime. The files in this directory are
 * concatenated (in dependency order, by videoplayer.js) into a single IIFE.
 * They run in the browser, NOT in Node.js. Config is read at runtime from the
 * <script id="race-config" type="application/json"> block embedded in the HTML.
 */


// --- Config read from the embedded #race-config JSON block ---
const _raceConfigEl = document.getElementById('race-config');
const raceConfig = JSON.parse(_raceConfigEl?.textContent || '{}');
const raceVideoPaths = raceConfig.raceVideoPaths;
const fullVideoPaths = raceConfig.fullVideoPaths;
const clipTimes = raceConfig.clipTimes;
const racerNames = raceConfig.racerNames;
const racerColors = raceConfig.racerColors;
const ffmpegDir = raceConfig.ffmpegDir;
const raceVideos = Array.from({ length: raceConfig.videoCount }, (_, i) => document.getElementById('v' + i));
const mergedVideo = document.getElementById('mergedVideo');
const playerContainer = document.getElementById('playerContainer');
const mergedContainer = document.getElementById('mergedContainer');

// Mutable resolved paths — data URIs replaced with seekable Blob URLs on init
let resolvedRacePaths = raceVideoPaths ? raceVideoPaths.slice() : raceVideoPaths;
let resolvedFullPaths = fullVideoPaths ? fullVideoPaths.slice() : fullVideoPaths;

const _embeddedBlobUrls = [];
async function toBlobUrl(p) {
  if (!p?.startsWith('data:')) return p;
  try {
    const resp = await fetch(p);
    if (!resp.ok) return p;
    const url = URL.createObjectURL(await resp.blob());
    _embeddedBlobUrls.push(url);
    return url;
  } catch { return p; }
}
async function resolveEmbeddedVideos() {
  const hasData = arr => arr?.some(p => p?.startsWith('data:'));
  const mergedSrc = mergedVideo?.getAttribute('src');
  const mergedIsData = mergedSrc?.startsWith('data:');
  if (!hasData(raceVideoPaths) && !hasData(fullVideoPaths) && !mergedIsData) return;
  [resolvedRacePaths, resolvedFullPaths] = await Promise.all([
    raceVideoPaths ? Promise.all(raceVideoPaths.map(toBlobUrl)) : Promise.resolve(raceVideoPaths),
    fullVideoPaths ? Promise.all(fullVideoPaths.map(toBlobUrl)) : Promise.resolve(fullVideoPaths),
  ]);
  // Update video src attributes with seekable blob: URLs
  raceVideos.forEach((v, i) => {
    if (!v) return;
    const resolved = loadedSrcSet === 'full' && resolvedFullPaths ? resolvedFullPaths[i] : resolvedRacePaths[i];
    if (resolved && resolved !== v.getAttribute('src')) v.src = resolved;
  });
  if (mergedIsData) mergedVideo.src = await toBlobUrl(mergedSrc);
}
resolveEmbeddedVideos();
window.addEventListener('pagehide', () => { _embeddedBlobUrls.forEach(u => URL.revokeObjectURL(u)); });

// Convert a Blob to a base64 data URI (used when embedding videos in ZIP export)
function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
