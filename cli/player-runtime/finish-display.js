/* Placement is computed from final results, including sequential recordings. */
function finishResultForVideo(i) {
  if (videos !== raceVideos || (fullVideoPaths && loadedSrcSet === 'full')) return null;
  return racerFinishResult(clipTimes, raceConfig.finishResults, i, raceVideos[i]?.currentTime);
}

function updateFinishDisplay(i) {
  const video = raceVideos[i];
  const badge = document.getElementById('finishResult' + i);
  if (!badge) return null;
  const result = video?.seeking ? null : finishResultForVideo(i);
  badge.hidden = !result;
  badge.textContent = result?.label || '';
  badge.setAttribute('aria-label', result ? `${racerNames[i]}: ${result.name}, ${result.label}` : '');
  return result;
}

function updateFinishDisplays() {
  raceVideos.forEach((_, i) => updateFinishDisplay(i));
}

raceVideos.forEach((video, i) => {
  if (!video) return;
  video.addEventListener('seeked', () => updateFinishDisplay(i));
  video.addEventListener('timeupdate', () => updateFinishDisplay(i));
  if (!video.requestVideoFrameCallback) return;
  // Frame-accurate badge: watch frames only while this video is playing toward
  // a finish not yet on screen. Once it shows, or while paused, the seeked and
  // timeupdate listeners above are enough — no per-frame work at rest.
  let watching = false;
  const onFrame = () => {
    watching = false;
    if (!updateFinishDisplay(i) && !video.paused) watch();
  };
  const watch = () => {
    if (watching) return;
    watching = true;
    video.requestVideoFrameCallback(onFrame);
  };
  video.addEventListener('play', watch);
  video.addEventListener('seeked', watch);
  watch();
});
