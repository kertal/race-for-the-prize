/* eslint-env browser */
/**
 * download.js — handing a blob to the browser as a file, and the CSV button
 * that does exactly that with the matrix data embedded in the page.
 *
 * Both download buttons render `hidden` and are revealed here: without the
 * runtime there is nothing to turn page data into a file, and a dead button
 * would be worse than none.
 */

function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same tick can cancel the download before it starts.
  setTimeout(function () { URL.revokeObjectURL(url); }, 0);
}

/** True once the browser can build a file out of data the page holds. */
function canDownloadBlobs() {
  return !!(window.Blob && window.URL && window.URL.createObjectURL);
}

// The CSV is already in the page; downloading is just handing it over.
var csvData = document.getElementById('matrix-csv');
var csvBtn = document.getElementById('download-csv');
if (csvData && csvBtn && canDownloadBlobs()) {
  csvBtn.hidden = false;
  csvBtn.addEventListener('click', function () {
    var blob = new Blob([JSON.parse(csvData.textContent)], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, csvBtn.getAttribute('data-filename'));
  });
}
