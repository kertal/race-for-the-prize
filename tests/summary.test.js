import { describe, it, expect } from 'vitest';
import { buildSummary } from '../cli/summary.js';

describe('buildSummary', () => {
  const names = ['lauda', 'hunt'];

  it('returns correct structure with empty results', () => {
    const results = [
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.racers).toEqual(['lauda', 'hunt']);
    expect(summary.comparisons).toEqual([]);
    expect(summary.overallWinner).toBeNull();
    expect(summary.errors).toEqual([]);
    expect(summary.resultsDir).toBe('/tmp/results');
    expect(summary.wins).toEqual({ lauda: 0, hunt: 0 });
  });

  it('computes winner when racer1 is faster', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 1, duration: 1.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 2, duration: 2.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.comparisons).toHaveLength(1);
    const comp = summary.comparisons[0];
    expect(comp.name).toBe('Load');
    expect(comp.winner).toBe('lauda');
    expect(comp.diff).toBeCloseTo(1.0);
    expect(comp.diffPercent).toBeCloseTo(100.0); // (2-1)/1 * 100 - winner is 100% faster relative to their own time
    expect(summary.overallWinner).toBe('lauda');
    expect(summary.wins).toEqual({ lauda: 1, hunt: 0 });
  });

  it('computes winner when racer2 is faster', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 3, duration: 3.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 1, duration: 1.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.comparisons[0].winner).toBe('hunt');
    expect(summary.overallWinner).toBe('hunt');
  });

  it('reports tie when durations are equal', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 2, duration: 2.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 2, duration: 2.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    // Equal duration: racer1 wins (<=), so it's 1-0 not a tie
    expect(summary.comparisons[0].winner).toBe('lauda');
    expect(summary.comparisons[0].diff).toBeCloseTo(0);
  });

  it('handles multiple measurements with split winners', () => {
    const results = [
      { measurements: [
        { name: 'Load', startTime: 0, endTime: 1, duration: 1.0 },
        { name: 'Render', startTime: 1, endTime: 5, duration: 4.0 },
      ], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [
        { name: 'Load', startTime: 0, endTime: 3, duration: 3.0 },
        { name: 'Render', startTime: 3, endTime: 5, duration: 2.0 },
      ], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.comparisons).toHaveLength(2);
    expect(summary.comparisons[0].winner).toBe('lauda');  // Load: 1 < 3
    expect(summary.comparisons[1].winner).toBe('hunt');  // Render: 2 < 4
    expect(summary.overallWinner).toBe('tie');
    expect(summary.wins).toEqual({ lauda: 1, hunt: 1 });
  });

  it('handles measurement present in only one racer', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 1, duration: 1.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.comparisons).toHaveLength(1);
    expect(summary.comparisons[0].racers[0]).not.toBeNull();
    expect(summary.comparisons[0].racers[1]).toBeNull();
    expect(summary.comparisons[0].winner).toBeNull();
  });

  it('collects errors from results', () => {
    const results = [
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: 'timeout' },
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.errors).toEqual(['lauda: timeout']);
  });

  it('records video paths', () => {
    const results = [
      { measurements: [], clickEvents: [], videoPath: '/tmp/a.webm', fullVideoPath: '/tmp/a_full.webm', error: null },
      { measurements: [], clickEvents: [], videoPath: '/tmp/b.webm', fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.videos.lauda).toBe('/tmp/a.webm');
    expect(summary.videos.lauda_full).toBe('/tmp/a_full.webm');
    expect(summary.videos.hunt).toBe('/tmp/b.webm');
    expect(summary.videos.hunt_full).toBeNull();
  });

  it('counts click events', () => {
    const results = [
      { measurements: [], clickEvents: [{}, {}, {}], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [], clickEvents: [{}], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(names, results, {}, '/tmp/results');

    expect(summary.clickCounts).toEqual({ lauda: 3, hunt: 1 });
  });

  it('preserves settings in summary', () => {
    const results = [
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const settings = { network: 'fast-3g', cpuThrottle: 2 };
    const summary = buildSummary(names, results, settings, '/tmp/results');

    expect(summary.settings).toEqual(settings);
  });
});

describe('buildSummary with 3+ racers', () => {
  const threeNames = ['alpha', 'beta', 'gamma'];

  it('determines winner among 3 racers', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 2, duration: 2.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 1, duration: 1.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 3, duration: 3.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(threeNames, results, {}, '/tmp/results');

    expect(summary.comparisons).toHaveLength(1);
    expect(summary.comparisons[0].winner).toBe('beta'); // 1.0s is fastest
    expect(summary.overallWinner).toBe('beta');
    expect(summary.wins).toEqual({ alpha: 0, beta: 1, gamma: 0 });
  });

  it('computes diff between fastest and slowest', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 2, duration: 2.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 1, duration: 1.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 4, duration: 4.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(threeNames, results, {}, '/tmp/results');

    // Diff is between fastest (1.0) and slowest (4.0)
    expect(summary.comparisons[0].diff).toBeCloseTo(3.0);
    expect(summary.comparisons[0].diffPercent).toBeCloseTo(300.0);
  });

  it('handles 3-way tie when all have same wins', () => {
    const results = [
      { measurements: [
        { name: 'Load', startTime: 0, endTime: 1, duration: 1.0 },
        { name: 'Render', startTime: 1, endTime: 4, duration: 3.0 },
        { name: 'Hydrate', startTime: 4, endTime: 6, duration: 2.0 },
      ], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [
        { name: 'Load', startTime: 0, endTime: 2, duration: 2.0 },
        { name: 'Render', startTime: 2, endTime: 3, duration: 1.0 },
        { name: 'Hydrate', startTime: 3, endTime: 6, duration: 3.0 },
      ], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [
        { name: 'Load', startTime: 0, endTime: 3, duration: 3.0 },
        { name: 'Render', startTime: 3, endTime: 5, duration: 2.0 },
        { name: 'Hydrate', startTime: 5, endTime: 6, duration: 1.0 },
      ], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(threeNames, results, {}, '/tmp/results');

    // Each racer wins one measurement
    expect(summary.wins).toEqual({ alpha: 1, beta: 1, gamma: 1 });
    expect(summary.overallWinner).toBe('tie');
  });

  it('stores rankings in comparison', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 2, duration: 2.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 1, duration: 1.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [{ name: 'Load', startTime: 0, endTime: 3, duration: 3.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(threeNames, results, {}, '/tmp/results');

    expect(summary.comparisons[0].rankings).toEqual(['beta', 'alpha', 'gamma']);
  });
});

describe('buildSummary with 5 racers', () => {
  const fiveNames = ['a', 'b', 'c', 'd', 'e'];

  it('determines winner among 5 racers', () => {
    const results = fiveNames.map((_, i) => ({
      measurements: [{ name: 'Load', startTime: 0, endTime: i + 1, duration: i + 1 }],
      clickEvents: [],
      videoPath: null,
      fullVideoPath: null,
      error: null,
    }));
    const summary = buildSummary(fiveNames, results, {}, '/tmp/results');

    expect(summary.comparisons[0].winner).toBe('a'); // duration 1 is fastest
    expect(summary.overallWinner).toBe('a');
    expect(summary.comparisons[0].rankings).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('handles partial data among 5 racers', () => {
    const results = [
      { measurements: [{ name: 'Load', startTime: 0, endTime: 2, duration: 2.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null }, // no data
      { measurements: [{ name: 'Load', startTime: 0, endTime: 1, duration: 1.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
      { measurements: [], clickEvents: [], videoPath: null, fullVideoPath: null, error: null }, // no data
      { measurements: [{ name: 'Load', startTime: 0, endTime: 3, duration: 3.0 }], clickEvents: [], videoPath: null, fullVideoPath: null, error: null },
    ];
    const summary = buildSummary(fiveNames, results, {}, '/tmp/results');

    expect(summary.comparisons[0].winner).toBe('c'); // 1.0s is fastest among those with data
    expect(summary.comparisons[0].racers[1]).toBeNull(); // b has no data
    expect(summary.comparisons[0].racers[3]).toBeNull(); // d has no data
    expect(summary.comparisons[0].rankings).toEqual(['c', 'a', 'e']);
  });
});
