/**
 * Behavioral tests for the pure planning logic behind the condition-matrix
 * film (cli/matrix-runtime/film-plan.cjs). The file is concatenated into the
 * overview page's IIFE for the browser and exposes a guarded module.exports so
 * Node can require() it directly.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CARD_SECONDS, filmClipWindow, buildFilmCard, buildFilmPlan } = require('../cli/matrix-runtime/film-plan.cjs');

/** A condition as the page embeds it. */
const conditionOf = (label, overrides = {}) => ({
  label,
  title: `Network: none · CPU: 1x (${label})`,
  racers: [{ name: 'lauda', color: '#e74c3c', src: `${label}/lauda/lauda.race.webm`, clip: null }],
  metrics: {
    duration: {
      name: 'Total Time',
      verdict: '🏆 lauda',
      rows: [
        { medal: '🏆', name: 'lauda', color: '#e74c3c', value: '1.200s', delta: null, fraction: 0.8, win: true },
        { medal: '', name: 'hunt', color: '#3498db', value: '1.500s', delta: '0.300s', fraction: 1, win: false },
      ],
    },
  },
  ...overrides,
});

describe('filmClipWindow', () => {
  it('plays the whole recording when there is no clip (--ffmpeg trimmed it already)', () => {
    expect(filmClipWindow(null, 12)).toEqual({ start: 0, end: 12 });
  });

  it('returns nothing when neither a clip nor a duration is known', () => {
    expect(filmClipWindow(null, undefined)).toBeNull();
    // Chrome reports Infinity for a Playwright recording until the duration is
    // forced; a window of 0 would end that part of the film before it started.
    expect(filmClipWindow(null, Number.POSITIVE_INFINITY)).toBeNull();
    expect(filmClipWindow(null, Number.NaN)).toBeNull();
  });

  it('uses the raw clip times when the recording carries no trace calibration', () => {
    expect(filmClipWindow({ start: 1.5, end: 4 }, 10)).toEqual({ start: 1.5, end: 4 });
  });

  it('moves the window onto the video timeline with trace calibration', () => {
    // recordingStart is 2s past the first captured frame, so the race starts at
    // PTS 2 and keeps its own 2.5s length.
    const clip = {
      start: 0.4,
      end: 2.9,
      traceCalibration: { recordingStartTs: 3_000_000, firstFrameTs: 1_000_000 },
    };
    expect(filmClipWindow(clip, 10)).toEqual({ start: 2, end: 4.5 });
  });

  it('never runs the window past the end of the recording', () => {
    const clip = {
      start: 0,
      end: 6,
      traceCalibration: { recordingStartTs: 2_000_000, firstFrameTs: 1_000_000 },
    };
    expect(filmClipWindow(clip, 4)).toEqual({ start: 1, end: 4 });
  });

  it('falls back to the raw times when calibration puts the frame after the recording', () => {
    const clip = {
      start: 0.5,
      end: 2,
      traceCalibration: { recordingStartTs: 1_000_000, firstFrameTs: 3_000_000 },
    };
    expect(filmClipWindow(clip, 10)).toEqual({ start: 0.5, end: 2 });
  });

  it('collapses a clip that starts after the recording ended to an empty window at the end', () => {
    // Raw times past the end (a truncated recording)…
    expect(filmClipWindow({ start: 12, end: 14 }, 10)).toEqual({ start: 10, end: 10 });
    // …and a calibration that lands the start past the end.
    const clip = {
      start: 0,
      end: 2,
      traceCalibration: { recordingStartTs: 20_000_000, firstFrameTs: 1_000_000 },
    };
    expect(filmClipWindow(clip, 10)).toEqual({ start: 10, end: 10 });
  });

  it('ignores a clip whose times are not usable', () => {
    expect(filmClipWindow({ start: 3, end: 1 }, 8)).toEqual({ start: 0, end: 8 });
    expect(filmClipWindow({ start: null, end: 2 }, 8)).toEqual({ start: 0, end: 8 });
  });
});

describe('buildFilmCard', () => {
  it('reports the chosen metric, with the winner first and deltas signed', () => {
    const card = buildFilmCard(conditionOf('a'), 'duration', 2, 3);

    expect(card.metricName).toBe('Total Time');
    expect(card.verdict).toBe('🏆 lauda');
    expect(card.subtitle).toBe('Total Time · 🏆 lauda');
    expect(card.footer).toBe('2 / 3');
    expect(card.rows).toEqual([
      { medal: '🏆', name: 'lauda', color: '#e74c3c', value: '1.200s', delta: '', fraction: 0.8, win: true },
      { medal: '', name: 'hunt', color: '#3498db', value: '1.500s', delta: '+0.300s', fraction: 1, win: false },
    ]);
  });

  it('falls back to the first metric when the picker names one it does not carry', () => {
    const card = buildFilmCard(conditionOf('a'), 'total.lcp', 1, 1);
    expect(card.metricName).toBe('Total Time');
  });

  it('survives a condition with no metrics at all', () => {
    const card = buildFilmCard({ title: 'x', metrics: {} }, 'duration', 1, 1);
    expect(card).toMatchObject({ title: 'x', metricName: '', verdict: '', subtitle: '', rows: [] });
  });

  it('keeps a bar fraction inside the track it is drawn in', () => {
    const odd = conditionOf('a', { metrics: { duration: { name: 'Total Time', verdict: '', rows: [
      { name: 'over', value: '9s', fraction: 1.4 },
      { name: 'under', value: '1s', fraction: -0.2 },
      { name: 'unknown', value: '—', fraction: null },
    ] } } });

    expect(buildFilmCard(odd, 'duration', 1, 1).rows.map(r => r.fraction)).toEqual([1, 0, null]);
  });
});

describe('buildFilmPlan', () => {
  it('keeps the conditions in matrix order and numbers their cards', () => {
    const plan = buildFilmPlan({ conditions: [conditionOf('a'), conditionOf('b')] }, 'duration');

    expect(plan.conditions.map(c => c.label)).toEqual(['a', 'b']);
    expect(plan.conditions.map(c => c.card.footer)).toEqual(['1 / 2', '2 / 2']);
    expect(plan.maxRacers).toBe(1);
  });

  it('drops a condition with no recordings, and numbers around it', () => {
    const noVideo = conditionOf('b', { racers: [{ name: 'lauda', src: null }] });
    const plan = buildFilmPlan({ conditions: [conditionOf('a'), noVideo, conditionOf('c')] }, 'duration');

    expect(plan.conditions.map(c => c.label)).toEqual(['a', 'c']);
    expect(plan.conditions.map(c => c.card.footer)).toEqual(['1 / 2', '2 / 2']);
  });

  it('drops racers with no recording but keeps the condition', () => {
    const mixed = conditionOf('a', {
      racers: [
        { name: 'lauda', src: 'a/lauda/lauda.race.webm' },
        { name: 'hunt', src: null },
      ],
    });
    const plan = buildFilmPlan({ conditions: [mixed] }, 'duration');

    expect(plan.conditions[0].racers.map(r => r.name)).toEqual(['lauda']);
    expect(plan.maxRacers).toBe(1);
  });

  it('sizes the frame for the fullest condition', () => {
    const four = conditionOf('b', {
      racers: ['a', 'b', 'c', 'd'].map(name => ({ name, src: `b/${name}.webm` })),
    });
    expect(buildFilmPlan({ conditions: [conditionOf('a'), four] }, 'duration').maxRacers).toBe(4);
  });

  it('plans nothing from an empty or missing config', () => {
    expect(buildFilmPlan(null, 'duration')).toEqual({ conditions: [], maxRacers: 0 });
    expect(buildFilmPlan({ conditions: [] }, 'duration')).toEqual({ conditions: [], maxRacers: 0 });
  });

  it('holds each card long enough to read a full field', () => {
    expect(CARD_SECONDS).toBeGreaterThanOrEqual(4);
  });
});
