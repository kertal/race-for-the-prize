import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// The export flows live in the browser runtime; these tests run the pieces
// that need no DOM inside a vm context, the way playback-stability.test.js does.
const read = f => fs.readFileSync(new URL('../cli/player-runtime/' + f, import.meta.url), 'utf8');
const playback = read('playback.js');
const exportZip = read('export-zip.js');
const exportVideo = read('export-video.js');
const block = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

describe('HTML export bakes the whole race clip', () => {
  function bake({ segment = null, offsets = [0, 0] } = {}) {
    const clipTimes = [
      { start: 1, end: 5, _wcStart: 10, _wcEnd: 14, measurements: [{ name: 'Load' }] },
      { start: 2, end: 6, _wcStart: 10, _wcEnd: 14, measurements: [{ name: 'Load' }] },
    ];
    const ctx = { clipTimes, activeSegmentClipTimes: segment, debugOffsets: offsets, US_PER_SECOND: 1e6 };
    vm.createContext(ctx);
    vm.runInContext(block(playback, 'function adjustClipTimes(', '\nfunction getSegmentClipTimes('), ctx);
    vm.runInContext(block(exportZip, 'function bakeRaceConfig(', '\nfunction removeEl('), ctx);
    const script = { textContent: JSON.stringify({ clipTimes }) };
    ctx.bakeRaceConfig({ querySelector: () => script }, {}, false);
    return JSON.parse(script.textContent);
  }

  it('ignores the segment picked in the dropdown', () => {
    // _wcStart/_wcEnd and the measurements describe the whole race, so a
    // segment window would play only that section as "Race Recording" and
    // put the finish badge in the wrong place.
    const cfg = bake({ segment: [{ start: 2.5, end: 3 }, { start: 3.5, end: 4 }] });
    expect(cfg.clipTimes.map(ct => [ct.start, ct.end])).toEqual([[1, 5], [2, 6]]);
    expect(cfg.calibrationBaked).toBe(true);
  });

  it('keeps each racer\'s calibration offset', () => {
    const cfg = bake({ offsets: [0.08, 0] });
    expect(cfg.clipTimes[0].start).toBeCloseTo(1.08, 6);
    expect(cfg.clipTimes[1].start).toBe(2);
    expect(cfg.clipTimes[0]._wcStart).toBe(10);
    expect(cfg.clipTimes[0].measurements).toEqual([{ name: 'Load' }]);
  });
});

describe('video export clip-end hold', () => {
  function harness(times) {
    const videos = times.map(t => ({ currentTime: t, pause: vi.fn() }));
    const ctx = { raceVideos: videos };
    vm.createContext(ctx);
    vm.runInContext(block(playback, 'function holdAtClipEnd(', '\n// Clamp one video'), ctx);
    vm.runInContext(block(exportVideo, 'function holdExportClips(', '\nasync function startExport('), ctx);
    return { videos, hold: ctx.holdExportClips };
  }

  it('holds a racer with a shorter clip at its own end while the others play on', () => {
    const { videos, hold } = harness([7.2, 7.2]);
    hold([0, 1], [7, 12]);
    expect(videos[0].currentTime).toBe(7);
    expect(videos[0].pause).toHaveBeenCalled();
    expect(videos[1].currentTime).toBe(7.2);
    expect(videos[1].pause).not.toHaveBeenCalled();
  });

  it('pairs clip ends with the visible racers, not the racer order', () => {
    // perVideoEnd is indexed by visible position; with racer 0 hidden the
    // first end belongs to racer 1.
    const { videos, hold } = harness([9, 9, 9]);
    hold([1, 2], [8, 12]);
    expect(videos[0].currentTime).toBe(9);
    expect(videos[1].currentTime).toBe(8);
    expect(videos[2].currentTime).toBe(9);
  });

  it('runs the hold on every export frame, before the clock is read', () => {
    const tick = block(exportVideo, 'function tick()', 'const cur =');
    expect(tick).toContain('holdExportClips(visibleIndices, perVideoEnd)');
  });
});
