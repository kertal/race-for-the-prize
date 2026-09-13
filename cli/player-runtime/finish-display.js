/* Placement is computed from final results, including sequential recordings. */
function finishResultForVideo(i) {
  if (videos !== raceVideos || (fullVideoPaths && loadedSrcSet === 'full')) return null;
  return racerFinishResult(clipTimes, raceConfig.finishResults, i, raceVideos[i]?.currentTime);
}

function updateFinishDisplays() {
  raceVideos.forEach((video, i) => {
    const badge = document.getElementById('finishResult' + i);
    if (!badge) return;
    const result = video?.seeking ? null : finishResultForVideo(i);
    badge.hidden = !result;
    badge.textContent = result?.label || '';
    badge.setAttribute('aria-label', result ? `${racerNames[i]}: ${result.name}, ${result.label}` : '');
  });
}

raceVideos.forEach(video => {
  if (!video) return;
  video.addEventListener('seeked', updateFinishDisplays);
  video.addEventListener('timeupdate', updateFinishDisplays);
  if (video.requestVideoFrameCallback) {
    const onFrame = () => {
      updateFinishDisplays();
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }
});
