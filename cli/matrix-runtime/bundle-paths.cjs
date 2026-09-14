/* eslint-env browser */
/**
 * bundle-paths.cjs — pure path plumbing for the report bundler.
 *
 * Deciding what belongs in the ZIP and what it is called inside it is all
 * string work, so it lives here: DOM- and network-free, which lets Node
 * require() it for unit tests. In the browser build the guarded
 * module.exports is a no-op, the same arrangement player-runtime/*.cjs uses.
 */

/**
 * Only same-tree relative paths go in the bundle. A scheme (data:, http:,
 * blob:), a root-relative path or a '..' segment either isn't ours to fetch or
 * would land outside the results directory the ZIP mirrors.
 */
function isBundleablePath(p) {
  if (!p || typeof p !== 'string') return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return false;
  if (p.startsWith('/') || p.startsWith('#') || p.startsWith('?')) return false;
  return !p.split('/').includes('..');
}

/** Dedupe in first-seen order, keeping only the paths that belong in the ZIP. */
function bundleablePaths(paths) {
  const kept = [];
  for (const p of paths) if (isBundleablePath(p) && !kept.includes(p)) kept.push(p);
  return kept;
}

/** The directory a page lives in — '' for a page at the results root. */
function dirName(url) {
  const cut = url.lastIndexOf('/');
  return cut < 0 ? '' : url.slice(0, cut);
}

/** Resolve one of a page's own relative links against that page's directory. */
function joinPath(dir, p) {
  return dir ? dir + '/' + p : p;
}

/**
 * What a URL is called inside the ZIP: the query and hash dropped, and every
 * segment percent-decoded, so `slow-3g%20fast/index.html` unzips to the
 * directory name the results folder actually used.
 */
function zipEntryName(url) {
  return url.split('#')[0].split('?')[0].split('/').map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  }).join('/');
}

/**
 * Every file one condition's results page points at: the Files section's
 * links, the <video> sources, and the video paths in its race config (which
 * the player reads even when a link for them was stripped).
 *
 * @param {{links?: string[], videos?: string[], configJson?: string|null}} page
 * @returns {string[]} bundleable paths, relative to that page, deduped
 */
function assetPathsFrom(page) {
  const paths = (page.links || []).concat(page.videos || []);
  if (page.configJson) {
    try {
      const config = JSON.parse(page.configJson);
      for (const key of ['raceVideoPaths', 'fullVideoPaths']) {
        if (Array.isArray(config[key])) paths.push(...config[key].filter(Boolean));
      }
    } catch { /* an unreadable config still leaves the page's links to bundle */ }
  }
  return bundleablePaths(paths);
}

/** Running total for the progress line, in whichever unit reads shortest. */
function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isBundleablePath, bundleablePaths, dirName, joinPath, zipEntryName, assetPathsFrom, formatSize };
}
