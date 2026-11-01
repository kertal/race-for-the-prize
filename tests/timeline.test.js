/**
 * The segment timeline: the pure layout math in timeline.cjs, and the DOM
 * behaviour of timeline.js run against a small fake document.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sectionWinner, timelineSegments, timelinePercent } = require('../cli/player-runtime/timeline.cjs');
const timelineSource = fs.readFileSync(new URL('../cli/player-runtime/timeline.js', import.meta.url), 'utf8');

const COLORS = ['#111111', '#222222', '#333333'];

describe('sectionWinner', () => {
  it('is the fastest racer with a time', () => {
    expect(sectionWinner([2, 1, 3])).toBe(1);
    expect(sectionWinner([2, null, 1])).toBe(2);
  });

  it('is nobody for a dead heat or a section only one racer ran', () => {
    expect(sectionWinner([1, 1])).toBeNull();
    expect(sectionWinner([1, null])).toBeNull();
    expect(sectionWinner([])).toBeNull();
    expect(sectionWinner(undefined)).toBeNull();
  });

  it('follows the summary when two share the fastest time but a third is slower', () => {
    expect(sectionWinner([1, 1, 2])).toBe(0);
  });
});

describe('timelineSegments', () => {
  const results = [
    { name: 'Render', durations: [1, 2] },
    { name: 'Reload', durations: [3, 2] },
    { name: 'Total', isSyntheticTotal: true, durations: [4, 4] },
  ];

  it('places each name at the mean of the racers\' windows, in the given order', () => {
    const segments = timelineSegments([
      { name: 'Render', windows: [{ start: 1, end: 2 }, { start: 1.2, end: 2.4 }] },
      { name: 'Reload', windows: [{ start: 3, end: 4 }, null] },
    ], results, COLORS);
    expect(segments.map(s => s.name)).toEqual(['Render', 'Reload']);
    expect(segments[0].start).toBeCloseTo(1.1);
    expect(segments[0].end).toBeCloseTo(2.2);
    expect(segments[1]).toMatchObject({ start: 3, end: 4 });
  });

  it('leaves out a name no racer could place', () => {
    const segments = timelineSegments([
      { name: 'Ghost', windows: [null, null] },
      { name: 'Render', windows: [{ start: 1, end: 2 }] },
    ], results, COLORS);
    expect(segments.map(s => s.name)).toEqual(['Render']);
  });

  it('colours each section by the racer that won it', () => {
    const segments = timelineSegments([
      { name: 'Render', windows: [{ start: 1, end: 2 }] },
      { name: 'Reload', windows: [{ start: 3, end: 4 }] },
    ], results, COLORS);
    expect(segments.map(s => s.winner)).toEqual([0, 1]);
    expect(segments.map(s => s.color)).toEqual([COLORS[0], COLORS[1]]);
  });

  it('leaves a dead heat, an unknown section and a missing result list uncoloured', () => {
    const windows = [{ start: 1, end: 2 }];
    const tie = timelineSegments([{ name: 'Tie', windows }], [{ name: 'Tie', durations: [2, 2] }], COLORS);
    expect(tie[0]).toMatchObject({ winner: null, color: null });
    const unknown = timelineSegments([{ name: 'Render', windows }], [], COLORS);
    expect(unknown[0]).toMatchObject({ winner: null, color: null });
    const none = timelineSegments([{ name: 'Render', windows }], undefined, COLORS);
    expect(none[0]).toMatchObject({ winner: null, color: null });
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
  // Racer 0 wins the first section, racer 1 the second, and so on round.
  const finishResults = names.map((name, i) => ({ name, durations: [0, 1].map(r => (r === i % 2 ? 1 : 2)) }));
  const ctx = {
    document: { getElementById: id => ids[id] || null, createElement: fakeElement },
    clipTimes: [{ _converted: true, start: 1, end: 10 }],
    raceVideos: [video], raceConfig: { finishResults },
    racerNames: ['lauda', 'hunt'], racerColors: COLORS.slice(0, 2),
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
    expect(labels().map(l => l.textContent)).toEqual(['Render', 'Reload']);
    expect(ids.timelineBar.children.at(-1)).toBe(ids.timelinePlayhead); // playhead stays on top
    expect(ids.raceTimeline.style.display).toBe('');
  });

  it('paints each block and its label in the colour of the racer that won the section', () => {
    const { ctx, blocks, labels } = harness({ names: ['Render', 'Reload'] });
    ctx.buildTimeline();
    expect(blocks().map(b => b.style['--racer-color'])).toEqual([COLORS[0], COLORS[1]]);
    expect(labels().map(l => l.style['--racer-color'])).toEqual([COLORS[0], COLORS[1]]);
    expect(blocks()[1].title).toBe('Reload (2.000s, won by hunt)');
    expect(blocks()[1].attrs['aria-label']).toBe('Play Reload (5.000s – 7.000s, won by hunt)');
  });

  it('leaves a dead heat in the neutral colour', () => {
    const { ctx, blocks } = harness({ names: ['Render'] });
    ctx.raceConfig.finishResults = [{ name: 'Render', durations: [1, 1] }];
    ctx.buildTimeline();
    expect(blocks()[0].style['--racer-color']).toBeUndefined();
    expect(blocks()[0].title).toBe('Render (2.000s)');
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
