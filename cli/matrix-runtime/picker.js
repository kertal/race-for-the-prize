/* eslint-env browser */
/**
 * picker.js — the Compare picker on the condition overview.
 *
 * Every metric is rendered into the page at build time; switching metrics only
 * flips which block is visible, so the matrix still reads without JavaScript.
 */

var picker = document.getElementById('metric');

function showSelectedMetric() {
  var blocks = document.querySelectorAll('.m[data-metric]');
  for (var i = 0; i < blocks.length; i++) {
    blocks[i].hidden = blocks[i].getAttribute('data-metric') !== picker.value;
  }
}

picker.addEventListener('change', showSelectedMetric);
// Browsers restore the previous selection on reload, so sync once at startup
// rather than trusting the server-rendered default to still match.
showSelectedMetric();
