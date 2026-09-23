import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const playback = fs.readFileSync(new URL('../cli/player-runtime/playback.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../cli/player-runtime/main.js', import.meta.url), 'utf8');
const block = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
function video(time) {
  const listeners = new Map();
  return { currentTime: time, duration: 20, seeking: false, ended: false, paused: true,
    pause: vi.fn(),
    addEventListener(name, fn) {
      const fns = listeners.get(name) || new Set();
      listeners.set(name, fns);
      fns.add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { const callbacks = [...(listeners.get(name) || [])]; listeners.delete(name); callbacks.forEach(fn => fn()); },
    listeners,
  };
}
function harness(times = [2]) {
  const videos = times.map(video);
  const clips = times.map(() => ({ start: 2, end: 12 }));
  const ctx = { videos, raceVideos: videos, clipTimes: clips, hiddenRacers: new Set(),
    activeClip: { start: 2, end: 12 }, duration: 20, playing: true, scrubber: { value: 0 },
    pendingSeekVerifications: new Map(),
    getAdjustedClipTimes: () => clips, isValidClipEntry: c => !!c,
    updateFramePositions() {}, updateTimeDisplay() {}, setPlayState: vi.fn(),
    clipOffset: () => 2, clipDuration: () => 10,
    SEEK_SNAP_TOLERANCE: .15, MAX_SEEK_RETRIES: 10, ZERO_START_THRESHOLD: .001,
  };
  vm.createContext(ctx);
  vm.runInContext(block(playback, 'function cancelSeekVerifications()', '\n// --- Formatting'), ctx);
  vm.runInContext(block(playback, 'function videoTargetTime(', '\n// --- Metadata'), ctx);
  vm.runInContext(block(playback, 'function videoClipElapsed(', '\nfunction onEnded()'), ctx);
  vm.runInContext(block(main, 'function nudgePaint(', '\nfunction seekAllWithVerify('), ctx);
  vm.runInContext(block(main, 'function seekAllWithVerify(', '\nif (clipTimes)'), ctx);
  return ctx;
}
describe('playback stability', () => {
  it('removes both startup listeners after a successful seek', () => {
    const ctx = harness(); const v = ctx.videos[0];
    ctx.seekAllWithVerify(2);
    v.emit('seeked');
    v.currentTime = 7;
    v.emit('canplay');
    expect(v.currentTime).toBe(7);
    expect(ctx.pendingSeekVerifications.size).toBe(0);
  });
  it('cancels in-flight startup retries on a new user seek', () => {
    const ctx = harness(); const v = ctx.videos[0];
    ctx.seekAllWithVerify(2);
    ctx.seekAll(7);
    v.emit('seeked'); v.emit('canplay');
    expect(v.currentTime).toBe(7);
    expect(ctx.pendingSeekVerifications.size).toBe(0);
  });
  it('still retries a dropped initial seek and cleans up at the retry limit', () => {
    const ctx = harness(); const v = ctx.videos[0];
    ctx.seekAllWithVerify(2);
    v.currentTime = 0; v.emit('canplay');
    expect(v.currentTime).toBe(2);
    for (let i = 0; i < 12; i++) { v.currentTime = 0; v.emit('seeked'); }
    expect(ctx.pendingSeekVerifications.size).toBe(0);
  });
  it('does not skip a lagging racer to the finish', () => {
    const ctx = harness([12, 10]);
    ctx.onTimeUpdate();
    expect(ctx.playing).toBe(true);
    expect(ctx.videos[1].currentTime).toBe(10);
    expect(ctx.videos[1].pause).not.toHaveBeenCalled();
    ctx.videos[1].currentTime = 12;
    ctx.onTimeUpdate();
    expect(ctx.playing).toBe(false);
    expect(ctx.videos[1].pause).toHaveBeenCalled();
  });
  it('waits for seeks, supports different clip ends, and ignores hidden racers', () => {
    const ctx = harness([7, 12, 3]);
    ctx.clipTimes[0].end = 7;
    ctx.hiddenRacers.add(2);
    ctx.videos[1].seeking = true;
    expect(ctx.allClipsFinished(ctx.clipTimes)).toBe(false);
    ctx.videos[1].seeking = false;
    expect(ctx.allClipsFinished(ctx.clipTimes)).toBe(true);
  });
  it('repaints a paused video after a verified seek, and leaves a playing one alone', () => {
    const ctx = harness(); const v = ctx.videos[0];
    ctx.seekAllWithVerify(2);
    v.emit('seeked');
    expect(v.currentTime).toBeCloseTo(1.999, 6);

    const playing = harness(); const p = playing.videos[0];
    p.paused = false;
    playing.seekAllWithVerify(2);
    p.emit('seeked');
    expect(p.currentTime).toBe(2);
  });
  it('does not nudge a seek that exhausted its retries off-target', () => {
    const ctx = harness(); const v = ctx.videos[0];
    ctx.seekAllWithVerify(2);
    for (let i = 0; i < 12; i++) { v.currentTime = 1; v.emit('seeked'); }
    expect(v.currentTime).toBe(1);
    expect(ctx.pendingSeekVerifications.size).toBe(0);
  });
  it('treats a racer with no clip in this segment as not on the track', () => {
    // computeSegmentClipTimes yields null for a racer that lacks the named
    // measurement; resolveClipWindow leaves it out, so completion must too.
    const ctx = harness([12, 3]);
    ctx.clipTimes[1] = null;
    expect(ctx.allClipsFinished(ctx.clipTimes)).toBe(true);
  });
  it('ignores the hidden set in merged mode, where videos is not raceVideos', () => {
    const ctx = harness([12]);
    ctx.hiddenRacers.add(0);
    ctx.videos = [ctx.raceVideos[0]];
    expect(ctx.maxClipElapsed(ctx.clipTimes)).toBe(10);
    expect(ctx.allClipsFinished(ctx.clipTimes)).toBe(true);
  });

  it('puts a racer whose start seek was dropped back on its clip before playing', () => {
    // iOS Safari buffers nothing before the user presses play, so the one-shot
    // load seek can be lost and that racer would play from 0.
    const ctx = harness([2, 0]);
    ctx.clipTimes[1] = { start: 3.5, end: 13.5 };
    ctx.alignForPlay();
    expect(ctx.videos[0].currentTime).toBe(2);
    expect(ctx.videos[1].currentTime).toBe(3.5);
  });
  it('aligns to the scrubber on resume, and leaves racers already in place alone', () => {
    const ctx = harness([7.05, 0]);
    ctx.scrubber.value = 500; // 5s into the 10s clip
    ctx.alignForPlay();
    expect(ctx.videos[0].currentTime).toBe(7.05); // within tolerance: no seek, no stutter
    expect(ctx.videos[1].currentTime).toBe(7);
  });
  it('does not align outside a clip window (whole recording, merged video)', () => {
    const ctx = harness([0]);
    ctx.activeClip = null;
    ctx.alignForPlay();
    expect(ctx.videos[0].currentTime).toBe(0);
  });
});

describe('duration probe', () => {
  function durationHarness() {
    const ctx = { onMeta: vi.fn(), setTimeout, Date };
    vm.createContext(ctx);
    vm.runInContext(block(playback, 'const _durationForced', '\n// video → { srcKey, at }: when we first'), ctx);
    const v = { ...video(0), duration: Infinity, readyState: 1, src: 'blob:a' };
    ctx.videos = [v];
    return { ctx, v };
  }
  it('stops waiting for a durationchange that never comes', () => {
    // Safari does not rescan a WebM without a Duration element, so the 1e10
    // seek never produces durationchange; the start seek must still run.
    vi.useFakeTimers();
    try {
      const { ctx, v } = durationHarness();
      expect(ctx.ensureFiniteDurations()).toBe(false);
      expect(v.currentTime).toBe(1e10);
      vi.advanceTimersByTime(2100); // past DURATION_SETTLE_MS
      expect(ctx.onMeta).toHaveBeenCalledTimes(1);
      expect(ctx.ensureFiniteDurations()).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('does not re-run the metadata pass once the scan has resolved the duration', () => {
    vi.useFakeTimers();
    try {
      const { ctx, v } = durationHarness();
      ctx.ensureFiniteDurations();
      v.duration = 12;
      vi.advanceTimersByTime(2100); // past DURATION_SETTLE_MS
      expect(ctx.onMeta).not.toHaveBeenCalled();
      expect(ctx.ensureFiniteDurations()).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
