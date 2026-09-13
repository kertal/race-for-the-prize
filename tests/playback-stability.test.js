import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const playback = fs.readFileSync(new URL('../cli/player-runtime/playback.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../cli/player-runtime/main.js', import.meta.url), 'utf8');
const block = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
function video(time) {
  const listeners = new Map();
  return { currentTime: time, duration: 20, seeking: false, ended: false,
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
  vm.runInContext(block(playback, 'function seekAll(t)', '\n// --- Metadata'), ctx);
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
});
