/* eslint-env browser */
/**
 * config.js — Build-time config injection and DOM bootstrap.
 *
 * Part of the browser-side player runtime. The files in this directory are
 * concatenated (in dependency order, by videoplayer.js) into a single IIFE
 * and injected into the generated HTML via {{placeholder}} replacement.
 * They run in the browser, NOT in Node.js. The {{…}} tokens are replaced
 * with JSON-serialized config before the HTML is written to disk.
 */


// --- Config injected at build time ---
{{videoVars}}
const raceVideos = {{videoArray}};
const raceVideoPaths = {{raceVideoPaths}};
const fullVideoPaths = {{fullVideoPaths}};
const clipTimes = {{clipTimesJson}};
const racerNames = {{racerNamesJson}};
const racerColors = {{racerColorsJson}};
const mergedVideo = document.getElementById('mergedVideo');
const playerContainer = document.getElementById('playerContainer');
const mergedContainer = document.getElementById('mergedContainer');

// Mutable resolved paths — data URIs replaced with seekable Blob URLs on init
let resolvedRacePaths = raceVideoPaths ? raceVideoPaths.slice() : raceVideoPaths;
let resolvedFullPaths = fullVideoPaths ? fullVideoPaths.slice() : fullVideoPaths;

const _embeddedBlobUrls = [];
(async function resolveEmbeddedVideos() {
  async function toBlobUrl(p) {
    if (!p || !p.startsWith('data:')) return p;
    try {
      const resp = await fetch(p);
      if (!resp.ok) return p;
      const url = URL.createObjectURL(await resp.blob());
      _embeddedBlobUrls.push(url);
      return url;
    } catch { return p; }
  }
  const hasData = arr => arr && arr.some(p => p && p.startsWith('data:'));
  const mergedSrc = mergedVideo && mergedVideo.getAttribute('src');
  const mergedIsData = mergedSrc && mergedSrc.startsWith('data:');
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
})();
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
