/* Placement is computed from final results, including sequential recordings.
   With --ffmpeg the videos are physically trimmed and clipTimes is null, so
   no badge is shown in that mode — by design, not a gap. */
function finishResultForVideo(i, videoTime = raceVideos[i]?.currentTime) {
  if (!clipTimes) return null;
  if (videos !== raceVideos || (fullVideoPaths && loadedSrcSet === 'full')) return null;
  return racerFinishResult(clipTimes, raceConfig.finishResults, i, videoTime);
}

// Whether this racer's badge can appear at all in the current mode: an
// incomplete race or a missing clip entry never yields one, however far the
// video plays, so there is nothing to watch frames for.
function finishAhead(i) {
  return finishResultForVideo(i, Number.MAX_VALUE) !== null;
}

// Last settled answer per racer, so a seek in flight has something to hold.
const lastFinishResult = raceVideos.map(() => null);

function updateFinishDisplay(i) {
  const video = raceVideos[i];
  const badge = document.getElementById('finishResult' + i);
  if (!badge) return null;
  // While a seek is in flight currentTime already names the destination, but
  // the frame on screen is still the old one — so the answer here would be
  // guesswork. It used to blank the badge for the duration of every seek,
  // which strobed through a scrub and flickered on each frame step, and left
  // the badge gone for good when the video was paused (no timeupdate follows a
  // paused seek to put it back). Hold the last settled answer instead; the
  // seeked listener below refreshes it the moment the picture catches up.
  if (video?.seeking) return lastFinishResult[i];
  const result = finishResultForVideo(i);
  lastFinishResult[i] = result;
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
  // a finish not yet on screen. Once it shows, while paused, or when no badge
  // can ever appear, the seeked and timeupdate listeners above are enough — no
  // per-frame work at rest.
  let watching = false;
  const onFrame = () => {
    watching = false;
    if (!updateFinishDisplay(i) && !video.paused) watch();
  };
  const watch = () => {
    if (watching || !finishAhead(i)) return;
    watching = true;
    video.requestVideoFrameCallback(onFrame);
  };
  video.addEventListener('play', watch);
  video.addEventListener('seeked', watch);
  watch();
});
