import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../cli/player-runtime/finish-display.js', import.meta.url), 'utf8');
const { racerFinishResult } = require('../cli/player-runtime/finish-results.cjs');

const entries = [
  { traceCalibration: { firstFrameTs: 1000000 }, measurements: [{ name: 'Race', startTraceTs: 3000000, endTraceTs: 6000000 }] },
  { traceCalibration: { firstFrameTs: 20000000 }, measurements: [{ name: 'Race', startTraceTs: 24000000, endTraceTs: 26000000 }] },
];

function video(time) {
  const listeners = {};
  const frameCallbacks = [];
  return {
    currentTime: time, paused: false, seeking: false, frameCallbacks,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    emit(name) { (listeners[name] || []).forEach(fn => fn()); },
    requestVideoFrameCallback(fn) { frameCallbacks.push(fn); },
    // Deliver every pending frame callback, as the browser would on decode.
    frame() { const pending = frameCallbacks.splice(0); pending.forEach(fn => fn()); },
  };
}

function harness({ finishResults, clipTimes = entries, times = [2, 2] } = {}) {
  const videos = times.map(video);
  const badges = videos.map(() => ({ hidden: true, textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }));
  const ctx = {
    videos, raceVideos: videos, clipTimes, fullVideoPaths: null, loadedSrcSet: 'race',
    raceConfig: { finishResults }, racerNames: ['A', 'B'], racerFinishResult,
    document: { getElementById: (id) => badges[Number(id.replace('finishResult', ''))] || null },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ...ctx, badges };
}

describe('finish display', () => {
  it('watches frames only while a badge is still ahead, then stops', () => {
    const { videos, badges } = harness({ finishResults: [{ name: 'Race', durations: [3, 2] }] });
    const v = videos[0];
    expect(v.frameCallbacks).toHaveLength(1); // armed at startup, finish is ahead
    v.frame();
    expect(badges[0].hidden).toBe(true);
    expect(v.frameCallbacks).toHaveLength(1); // re-armed: still playing, no badge yet
    v.currentTime = 5;
    v.frame();
    expect(badges[0].hidden).toBe(false);
    expect(badges[0].textContent).toBe('🥈 2nd · 3.000s total');
    expect(v.frameCallbacks).toHaveLength(0); // badge shown: no more per-frame work
  });

  it('never arms the frame watcher when no badge can appear', () => {
    // An incomplete race (a missing duration) yields no result at any time.
    const { videos } = harness({ finishResults: [{ name: 'Race', durations: [null, 2] }] });
    videos.forEach(v => expect(v.frameCallbacks).toHaveLength(0));
    videos[0].emit('play');
    videos[0].emit('seeked');
    expect(videos[0].frameCallbacks).toHaveLength(0);
  });

  it('never arms the frame watcher in ffmpeg mode, where clip times are null', () => {
    const { videos } = harness({ finishResults: [{ name: 'Race', durations: [3, 2] }], clipTimes: null });
    videos.forEach(v => expect(v.frameCallbacks).toHaveLength(0));
  });

  it('hides the badge again when the video seeks back before the finish', () => {
    const { videos, badges } = harness({ finishResults: [{ name: 'Race', durations: [3, 2] }], times: [5, 2] });
    const v = videos[0];
    v.frame();
    expect(badges[0].hidden).toBe(false);
    v.currentTime = 1;
    v.emit('seeked');
    expect(badges[0].hidden).toBe(true);
    expect(v.frameCallbacks).toHaveLength(1); // seeking back re-arms the watcher
  });
});
