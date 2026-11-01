/**
 * The segment timeline: the pure layout math in timeline.cjs, and the DOM
 * behaviour of timeline.js run against a small fake document.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SEGMENT_COLORS, timelineSegments, timelinePercent } = require('../cli/player-runtime/timeline.cjs');
const timelineSource = fs.readFileSync(new URL('../cli/player-runtime/timeline.js', import.meta.url), 'utf8');

describe('timelineSegments', () => {
  it('places each name at the mean of the racers\' windows, in the given order', () => {
    const segments = timelineSegments([
      { name: 'Render', windows: [{ start: 1, end: 2 }, { start: 1.2, end: 2.4 }] },
      { name: 'Reload', windows: [{ start: 3, end: 4 }, null] },
    ]);
    expect(segments.map(s => s.name)).toEqual(['Render', 'Reload']);
    expect(segments[0].start).toBeCloseTo(1.1);
    expect(segments[0].end).toBeCloseTo(2.2);
    expect(segments[1]).toMatchObject({ start: 3, end: 4 });
  });

  it('leaves out a name no racer could place', () => {
    const segments = timelineSegments([
      { name: 'Ghost', windows: [null, null] },
      { name: 'Render', windows: [{ start: 1, end: 2 }] },
    ]);
    expect(segments.map(s => s.name)).toEqual(['Render']);
  });

  it('colours by first-seen position and wraps the palette', () => {
    const many = Array.from({ length: SEGMENT_COLORS.length + 1 }, (_, i) => ({ name: 's' + i, windows: [{ start: i, end: i + 1 }] }));
    const segments = timelineSegments(many);
    expect(segments[0].color).toBe(SEGMENT_COLORS[0]);
    expect(segments[SEGMENT_COLORS.length].color).toBe(SEGMENT_COLORS[0]);
    expect(segments[1].color).toBe(SEGMENT_COLORS[1]);
  });
});

describe('timelinePercent', () => {
  it('maps seconds onto the bar and clamps to its edges', () => {
    expect(timelinePercent(5, 20)).toBe(25);
    expect(timelinePercent(-1, 20)).toBe(0);
    expect(timelinePercent(30, 20)).toBe(100);
  });

  it('sits at the left edge when the bar has no extent or the moment is unknown', () => {
    expect(timelinePercent(5, 0)).toBe(0);
    expect(timelinePercent(NaN, 20)).toBe(0);
  });
});

// --- A fake document, just enough for timeline.js ---

function fakeElement(tagName = 'div') {
  const el = {
    tagName, className: '', title: '', textContent: '', parent: null, children: [],
    dataset: {}, attrs: {}, classes: new Set(), listeners: new Map(),
    style: { display: '', setProperty(k, v) { this[k] = v; } },
    classList: { toggle(c, on) { if (on) el.classes.add(c); else el.classes.delete(c); return on; } },
    setAttribute(k, v) { el.attrs[k] = v; },
    append(...nodes) { for (const n of nodes) { if (typeof n === 'string') el.textContent += n; else { n.parent = el; el.children.push(n); } } },
    replaceChildren(...nodes) { el.children = []; el.append(...nodes); },
    querySelectorAll(sel) { return el.children.filter(c => c.className === sel.slice(1)); },
    closest(sel) { for (let n = el; n; n = n.parent) if (n.className === sel.slice(1)) return n; return null; },
    addEventListener(name, fn) { el.listeners.set(name, [...(el.listeners.get(name) || []), fn]); },
    getBoundingClientRect() { return { left: 100, width: 200 }; },
    // Bubbles like the real thing: the timeline delegates clicks to the bar.
    click(clientX = 0) { for (let n = el; n; n = n.parent) n.listeners.get('click')?.forEach(fn => fn({ target: el, clientX })); },
  };
  return el;
}

function harness({ names = ['Render'], extent = 20, options = ['__full__', '__all__'] } = {}) {
  const ids = Object.fromEntries(['raceTimeline', 'timelineBar', 'timelineLabels', 'timelinePlayhead'].map(id => [id, fakeElement()]));
  ids.timelineBar.className = 'timeline-bar';
  ids.timelineLabels.className = 'timeline-labels';
  const video = { currentTime: 0, duration: extent };
  const windows = Object.fromEntries(names.map((name, i) => [name, [{ start: 2 + i * 3, end: 4 + i * 3 }]]));
  const ctx = {
    document: { getElementById: id => ids[id] || null, createElement: fakeElement },
    clipTimes: [{ _converted: true, start: 1, end: 10 }],
    raceVideos: [video],
    segmentNav: { value: '__all__', options: options.map(value => ({ value })) },
    activeSegmentName: null, activeClip: { start: 1, end: 10 }, duration: extent,
    scrubber: { value: 0 }, SCRUBBER_MAX: 1000,
    collectSegmentNames: () => names,
    getSegmentClipTimes: name => windows[name] || null,
    resolveClip: () => ({ start: 1, end: 10 }),
    pausePlayback: vi.fn(), setActiveSegment: vi.fn(), seekAll: vi.fn(), updateTimeDisplay: vi.fn(),
    ensureRaceMode: vi.fn(cb => cb()), seekToActiveClipStart: vi.fn(),
    timelineSegments, timelinePercent,
  };
  vm.createContext(ctx);
  vm.runInContext(timelineSource, ctx);
  return { ctx, ids, video, blocks: () => ids.timelineBar.querySelectorAll('.timeline-segment'), labels: () => ids.timelineLabels.querySelectorAll('.timeline-label') };
}

describe('timeline.js', () => {
  it('draws the race clip and one block per measurement, scaled to the recording', () => {
    const { ctx, ids, blocks, labels } = harness({ names: ['Render', 'Reload'], extent: 20 });
    ctx.buildTimeline();
    const region = ids.timelineBar.children[0];
    expect(region.className).toBe('timeline-region-clip');
    expect(region.style.left).toBe('5%');   // clip start 1s of 20s
    expect(region.style.width).toBe('45%'); // clip length 9s of 20s
    expect(blocks().map(b => b.style.left)).toEqual(['10%', '25%']);
    expect(blocks().map(b => b.style['--segment-color'])).toEqual(SEGMENT_COLORS.slice(0, 2));
    expect(labels().map(l => l.textContent)).toEqual(['Render', 'Reload']);
    expect(ids.timelineBar.children.at(-1)).toBe(ids.timelinePlayhead); // playhead stays on top
    expect(ids.raceTimeline.style.display).toBe('');
  });

  it('plays a clicked segment even when the dropdown has no option for it', () => {
    const { ctx, blocks } = harness({ names: ['Render'] }); // one measurement: no per-name options
    ctx.buildTimeline();
    blocks()[0].click();
    expect(ctx.setActiveSegment).toHaveBeenCalledWith('Render', [{ start: 2, end: 4 }]);
    expect(ctx.seekToActiveClipStart).toHaveBeenCalled();
    expect(ctx.segmentNav.value).toBe('__all__'); // nothing to mirror, nothing broken
    expect(blocks()[0].classes.has('active')).toBe(true);
  });

  it('mirrors the pick into the dropdown when it lists the segment', () => {
    const { ctx, labels } = harness({ names: ['Render', 'Reload'], options: ['__full__', '__all__', 'Render', 'Reload'] });
    ctx.buildTimeline();
    labels()[1].click();
    expect(ctx.segmentNav.value).toBe('Reload');
    expect(ctx.setActiveSegment).toHaveBeenCalledWith('Reload', [{ start: 5, end: 7 }]);
    expect(labels()[1].attrs['aria-pressed']).toBe('true');
    expect(labels()[0].attrs['aria-pressed']).toBe('false');
  });

  it('seeks freely to a clicked moment of the recording, leaving the clip window', () => {
    const { ctx, ids } = harness({ extent: 20 });
    ctx.buildTimeline();
    ids.timelineBar.click(200); // half way along a 200px bar that starts at 100px
    expect(ctx.seekAll).toHaveBeenCalledWith(10);
    expect(ctx.setActiveSegment).toHaveBeenCalledWith('__full__', null);
    expect(ctx.activeClip).toBeNull();
    expect(ctx.segmentNav.value).toBe('__full__');
    expect(ctx.scrubber.value).toBe(500);
    expect(ctx.updateTimeDisplay).toHaveBeenCalled();
  });

  it('binds its click handling once however often it is redrawn', () => {
    const { ctx, ids, blocks } = harness();
    ctx.buildTimeline();
    ctx.buildTimeline();
    expect(ids.timelineBar.listeners.get('click')).toHaveLength(1);
    expect(blocks()).toHaveLength(1);
    blocks()[0].click();
    expect(ctx.setActiveSegment).toHaveBeenCalledTimes(1);
  });

  it('keeps the playhead on the scale the bar was drawn at', () => {
    const { ctx, ids, video } = harness({ extent: 20 });
    ctx.buildTimeline();
    video.currentTime = 5;
    ctx.updateTimelinePlayhead();
    expect(ids.timelinePlayhead.style.left).toBe('25%');
    video.duration = 40; // a source swap reports another length
    ctx.updateTimelinePlayhead();
    expect(ids.timelinePlayhead.style.left).toBe('25%');
  });

  it('stays hidden until it has been built', () => {
    const { ctx, ids } = harness();
    ctx.setTimelineVisible(true);
    expect(ids.raceTimeline.style.display).toBe('none');
    ctx.buildTimeline();
    ctx.setTimelineVisible(false);
    expect(ids.raceTimeline.style.display).toBe('none');
    ctx.setTimelineVisible(true);
    expect(ids.raceTimeline.style.display).toBe('');
  });

  it('draws nothing without a calibrated reference video', () => {
    const { ctx, ids } = harness({ extent: Infinity });
    ctx.buildTimeline();
    expect(ids.timelineBar.children).toHaveLength(0);
    expect(ids.raceTimeline.style.display).toBe('');
    expect(ids.timelineBar.listeners.size).toBe(0);
  });
});
