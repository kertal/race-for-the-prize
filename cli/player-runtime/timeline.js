/* eslint-env browser */
/**
 * timeline.js — The segment timeline under the videos: one bar for the whole
 * recording, the race clip marked on it, and a block per measurement. Clicking
 * a block (or its label) plays that segment; clicking the bar itself seeks
 * freely to that moment of the recording. A playhead tracks the transport.
 *
 * The bar is scaled to the race-mode reference video. Without --ffmpeg that
 * file is the whole recording, which is what the bar is for; with --ffmpeg it
 * is the physically trimmed clip, so the bar then spans the clip instead.
 */

const timelineEl = document.getElementById('raceTimeline');
const timelineBar = document.getElementById('timelineBar');
const timelineLabels = document.getElementById('timelineLabels');
const timelinePlayhead = document.getElementById('timelinePlayhead');

// Seconds the bar spans, fixed when it is built: the playhead keeps reading
// against it even if a source swap later changes the reference video's
// duration, so it never jumps scale mid-page.
let timelineExtent = 0;
let timelineListenersBound = false;

// The racer the bar is drawn against: the first with calibrated clip times.
function timelineReferenceVideo() {
  const idx = clipTimes ? clipTimes.findIndex(ct => ct?._converted) : -1;
  return idx < 0 ? null : raceVideos[idx];
}

function setTimelineVisible(on) {
  if (timelineEl) timelineEl.style.display = on && timelineExtent > 0 ? '' : 'none';
}

function updateTimelineActive(name) {
  if (!timelineBar || !timelineLabels) return;
  for (const el of timelineBar.querySelectorAll('.timeline-segment')) {
    el.classList.toggle('active', el.dataset.segmentName === name);
  }
  for (const el of timelineLabels.querySelectorAll('.timeline-label')) {
    const isActive = el.dataset.segmentName === name;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }
}

function updateTimelinePlayhead() {
  if (!timelinePlayhead || timelineExtent <= 0) return;
  const v = timelineReferenceVideo();
  if (!v) return;
  timelinePlayhead.style.left = timelinePercent(v.currentTime, timelineExtent) + '%';
}

// Play one measurement: the same path the segment dropdown takes, which keeps
// the two in step. The dropdown only lists names when there are several, so
// a single-measurement race is selected here without an option to mirror.
function activateTimelineSegment(name) {
  pausePlayback();
  setActiveSegment(name, getSegmentClipTimes(name));
  if (segmentNav && Array.from(segmentNav.options).some(o => o.value === name)) segmentNav.value = name;
  updateTimelineActive(name);
  ensureRaceMode(seekToActiveClipStart);
}

// Jump to a moment of the recording, outside any clip window. The loaded
// videos are kept: in race mode they already hold the whole recording, and
// the full-recording files (--ffmpeg only) run on a different time base than
// the bar was drawn against.
function seekTimelineTo(seconds) {
  pausePlayback();
  setActiveSegment('__full__', null);
  if (segmentNav) segmentNav.value = '__full__';
  updateTimelineActive(null);
  activeClip = null;
  seekAll(seconds);
  scrubber.value = duration > 0 ? (seconds / duration) * SCRUBBER_MAX : 0;
  updateTimeDisplay();
}

function onTimelineBarClick(e) {
  const segEl = e.target.closest('.timeline-segment');
  if (segEl) {
    activateTimelineSegment(segEl.dataset.segmentName);
    return;
  }
  const rect = timelineBar.getBoundingClientRect();
  const fraction = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
  seekTimelineTo(fraction * timelineExtent);
}

function onTimelineLabelClick(e) {
  const label = e.target.closest('.timeline-label');
  if (label) activateTimelineSegment(label.dataset.segmentName);
}

function segmentButton(className, seg) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.dataset.segmentName = seg.name;
  btn.style.setProperty('--segment-color', seg.color);
  return btn;
}

function buildTimelineBar(segments, clip, extent) {
  const region = document.createElement('div');
  region.className = 'timeline-region-clip';
  region.style.left = timelinePercent(clip.start, extent) + '%';
  region.style.width = timelinePercent(clip.end - clip.start, extent) + '%';
  region.title = 'Race Recording (' + (clip.end - clip.start).toFixed(2) + 's)';
  const blocks = segments.map(seg => {
    const btn = segmentButton('timeline-segment', seg);
    btn.style.left = timelinePercent(seg.start, extent) + '%';
    btn.style.width = timelinePercent(seg.end - seg.start, extent) + '%';
    btn.title = seg.name + ' (' + (seg.end - seg.start).toFixed(3) + 's)';
    btn.setAttribute('aria-label', 'Play ' + seg.name + ' (' + seg.start.toFixed(3) + 's – ' + seg.end.toFixed(3) + 's)');
    return btn;
  });
  // The playhead is the one static child and must stay on top of the blocks.
  timelineBar.replaceChildren(region, ...blocks, timelinePlayhead);
}

function buildTimelineLabels(segments) {
  timelineLabels.replaceChildren(...segments.map(seg => {
    const btn = segmentButton('timeline-label', seg);
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = seg.name;
    return btn;
  }));
}

// Built by buildSegmentNav once every clip is calibrated; rebuilding later
// only redraws, the click handling is bound once.
function buildTimeline() {
  if (!timelineEl || !timelineBar || !timelineLabels || !timelinePlayhead) return;
  const ref = timelineReferenceVideo();
  const extent = ref && Number.isFinite(ref.duration) ? ref.duration : 0;
  const clip = resolveClip();
  if (!(extent > 0) || !clip) return;
  const segments = timelineSegments(collectSegmentNames().map(name => ({ name, windows: getSegmentClipTimes(name) })));
  if (segments.length === 0) return;

  timelineExtent = extent;
  buildTimelineBar(segments, clip, extent);
  buildTimelineLabels(segments);
  if (!timelineListenersBound) {
    timelineListenersBound = true;
    timelineBar.addEventListener('click', onTimelineBarClick);
    timelineLabels.addEventListener('click', onTimelineLabelClick);
  }
  updateTimelineActive(activeSegmentName);
  updateTimelinePlayhead();
  setTimelineVisible(true);
}
