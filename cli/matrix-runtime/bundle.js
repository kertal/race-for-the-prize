/* eslint-env browser */
/**
 * bundle.js — "Download full report" for the condition overview.
 *
 * The overview is the top of a tree: it links one results page per condition,
 * and each of those links its own videos, traces, HARs and scripts. This walks
 * that tree — this page, every condition page, every file those pages link —
 * and packs it into one ZIP whose entries keep their relative paths, so it
 * unzips into a working copy of the results directory: open index.html, click
 * through to a condition, play the videos.
 *
 * Everything but this page is fetched, so the report has to be served over
 * HTTP — which is what `race.js` does when a race finishes. Opened straight
 * off disk, the browser refuses the requests and the status line says so.
 */

var bundleBtn = document.getElementById('download-zip');
var bundleStatus = document.getElementById('bundle-status');
var bundleLabel = bundleBtn ? bundleBtn.textContent : '';
var bundleAbort = null;

function setBundleStatus(text) {
  if (bundleStatus) bundleStatus.textContent = text;
}

/** Every condition page the matrix links to, in document order. */
function conditionPageUrls() {
  var hrefs = [];
  var links = document.querySelectorAll('td a[href]');
  for (var i = 0; i < links.length; i++) hrefs.push(links[i].getAttribute('href'));
  return bundleablePaths(hrefs);
}

/** The files one fetched condition page points at, relative to that page. */
function assetPathsInPage(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var attrOf = function (selector, attr) {
    var found = [];
    var nodes = doc.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) found.push(nodes[i].getAttribute(attr));
    return found;
  };
  var config = doc.getElementById('race-config');
  return assetPathsFrom({
    links: attrOf('.file-links a[href]', 'href'),
    videos: attrOf('video[src]', 'src'),
    configJson: config ? config.textContent : null,
  });
}

async function fetchBytes(url, signal) {
  var response = await fetch(url, { signal: signal });
  if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Fetch every page and file into a ZIP builder.
 *
 * One unreachable file is not worth losing the archive over — it is recorded
 * and the bundle goes on without it — so the result carries what was skipped
 * for the caller to report.
 *
 * @param {string} pageHtml - this page, snapshotted before the run touched it
 * @returns {Promise<{blob: Blob, pages: number, pagesFailed: number, skipped: string[], bytes: number}>}
 */
async function collectReport(pageHtml, signal, onProgress) {
  var zip = createZipBuilder();
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var skipped = [];
  var pagesFailed = 0;
  var bytes = 0;

  var add = function (name, data) {
    zip.addFile(name, data);
    bytes += data.length;
  };

  // The overview itself is already in memory: no request, nothing to fail.
  add('index.html', encoder.encode(pageHtml));

  var pages = conditionPageUrls();
  var assets = [];
  for (var p = 0; p < pages.length; p++) {
    onProgress('Fetching page ' + (p + 1) + '/' + pages.length, bytes);
    try {
      var pageBytes = await fetchBytes(pages[p], signal);
      add(zipEntryName(pages[p]), pageBytes);
      var dir = dirName(pages[p]);
      assetPathsInPage(decoder.decode(pageBytes)).forEach(function (asset) {
        assets.push(joinPath(dir, asset));
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      pagesFailed++;
      skipped.push(pages[p]);
    }
  }

  // Two conditions can name the same file (a shared race script, settings).
  assets = bundleablePaths(assets);
  for (var a = 0; a < assets.length; a++) {
    onProgress('Bundling ' + (a + 1) + '/' + assets.length + ' — ' + assets[a], bytes);
    try {
      add(zipEntryName(assets[a]), await fetchBytes(assets[a], signal));
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      skipped.push(assets[a]);
    }
  }

  return { blob: zip.toBlob(), pages: pages.length, pagesFailed: pagesFailed, skipped: skipped, bytes: bytes };
}

/** Nothing behind the links could be read — so there is no report to hand over. */
function reachedNothing(report) {
  return report.pages > 0 && report.pagesFailed === report.pages;
}

/** What to say once the run is over. */
function bundleSummary(report) {
  if (reachedNothing(report)) {
    // Almost always a report opened from a file:// path, where the browser
    // refuses to read the sibling pages.
    return 'Could not read the condition pages. Serve the results over HTTP — race.js does that '
      + 'when a race finishes — rather than opening index.html straight from disk.';
  }
  var done = 'Downloaded ' + formatSize(report.bytes) + '.';
  if (report.skipped.length === 0) return done;
  return done + ' Skipped ' + report.skipped.length + ' file(s): '
    + report.skipped.slice(0, 3).join(', ') + (report.skipped.length > 3 ? ', …' : '');
}

async function runBundle() {
  // Snapshot before the run dresses the button and status line, so the copy in
  // the ZIP is the page as it was, not one frozen mid-download.
  setBundleStatus('');
  var pageHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

  bundleAbort = new AbortController();
  bundleBtn.textContent = 'Cancel';
  try {
    var report = await collectReport(pageHtml, bundleAbort.signal, function (step, bytes) {
      setBundleStatus(step + ' (' + formatSize(bytes) + ')');
    });
    if (!reachedNothing(report)) downloadBlob(report.blob, bundleBtn.getAttribute('data-filename'));
    setBundleStatus(bundleSummary(report));
  } catch (e) {
    setBundleStatus(e.name === 'AbortError' ? 'Cancelled.' : 'Download failed: ' + e.message);
  } finally {
    bundleAbort = null;
    bundleBtn.textContent = bundleLabel;
  }
}

if (bundleBtn && canDownloadBlobs() && window.fetch && window.DOMParser && window.AbortController) {
  bundleBtn.hidden = false;
  bundleBtn.addEventListener('click', function () {
    if (bundleAbort) bundleAbort.abort();
    else runBundle();
  });
}
