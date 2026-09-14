/* eslint-env browser */
/**
 * fullscreen.js — Fullscreen mode: toggle, auto-hiding controls, and
 * grid-column recomputation for the fullscreen player layout.
 */

// --- Fullscreen mode ---

const fullscreenBtn = document.getElementById('fullscreenBtn');
const fullscreenWrapper = document.getElementById('fullscreenWrapper');

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  if (!fullscreenWrapper) return;
  try {
    if (isFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document)?.catch?.(() => {});
    } else {
      const request = fullscreenWrapper.requestFullscreen || fullscreenWrapper.webkitRequestFullscreen;
      if (request) request.call(fullscreenWrapper)?.catch?.(() => {});
    }
  } catch (_) { /* unsupported */ }
}

let fsHideTimer = null;

function showFsControls() {
  if (!fullscreenWrapper) return;
  fullscreenWrapper.classList.add('fs-controls-visible');
  clearTimeout(fsHideTimer);
  if (isFullscreen()) {
    fsHideTimer = setTimeout(() => {
      fullscreenWrapper.classList.remove('fs-controls-visible');
    }, 2500);
  }
}

function onFullscreenChange() {
  const fs = isFullscreen();
  if (fullscreenBtn) {
    fullscreenBtn.textContent = fs ? '\u2716' : '\u26F6';
    fullscreenBtn.title = fs ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)';
    fullscreenBtn.setAttribute('aria-pressed', String(fs));
    fullscreenBtn.setAttribute('aria-label', fs ? 'Exit fullscreen' : 'Toggle fullscreen');
  }
  if (fs) {
    // Compute optimal grid columns: ceil(sqrt(visibleCount))
    const visibleCount = raceVideos.length - hiddenRacers.size;
    const cols = Math.ceil(Math.sqrt(visibleCount));
    if (playerContainer) playerContainer.style.setProperty('--fs-cols', cols);
    showFsControls();
    fullscreenWrapper.addEventListener('mousemove', showFsControls);
    fullscreenWrapper.addEventListener('click', showFsControls);
  } else {
    clearTimeout(fsHideTimer);
    fullscreenWrapper.classList.remove('fs-controls-visible');
    fullscreenWrapper.removeEventListener('mousemove', showFsControls);
    fullscreenWrapper.removeEventListener('click', showFsControls);
  }
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', toggleFullscreen);
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);
