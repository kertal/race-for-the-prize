/**
 * cue-timings.cjs — Pure computation of clip segments from detected cue frames.
 *
 * Extracted from runner.cjs so it can be tested without loading Playwright
 * or any heavy dependencies.
 */

'use strict';

/**
 * Group consecutive timestamps that belong to the same visual cue.
 * Frames within `gap` seconds of the previous frame are considered part
 * of the same cue burst. Returns the first timestamp of each cluster.
 */
function clusterCues(cues, gap) {
  if (cues.length === 0) return [];
  const firsts = [cues[0]];
  for (let i = 1; i < cues.length; i++) {
    if (cues[i] - cues[i - 1] > gap) firsts.push(cues[i]);
  }
  return firsts;
}

/**
 * Compute clip timing from detected cue frames.
 * Content starts when a green cue first appears and ends one frame before the
 * next red cue appears. Multiple start/end pairs produce multiple segments,
 * supporting races with several raceRecordingStart/End windows.
 *
 * Consecutive cue frames belonging to the same visual flash are clustered
 * first (using 3× frameDuration as the gap threshold), so multiple frames
 * of the same cue don't produce spurious segments.
 *
 * Returns { segments, calibratedStart } — a single source of truth for both
 * ffmpeg trimming and the video player's build-time calibration.
 */
function cueTimings(startCues, endCues, frameDuration) {
  if (startCues.length === 0 || endCues.length === 0) {
    return { segments: [], calibratedStart: null };
  }
  const dt = frameDuration || 0.04; // default ~25fps
  const gap = dt * 3;

  const starts = clusterCues(startCues, gap);
  const ends = clusterCues(endCues, gap);
  const calibratedStart = starts[0];

  // Pair each start cluster with the next end cluster that follows it
  const segments = [];
  let endIdx = 0;
  for (let s = 0; s < starts.length; s++) {
    while (endIdx < ends.length && ends[endIdx] <= starts[s]) endIdx++;
    if (endIdx >= ends.length) break;
    const end = ends[endIdx] - dt;
    if (end > starts[s]) segments.push({ start: starts[s], end });
    endIdx++;
  }
  return { segments, calibratedStart };
}

module.exports = { cueTimings };
