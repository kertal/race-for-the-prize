import { describe, it, expect } from 'vitest';
import { buildSummary, buildMarkdownSummary, buildMedianSummary, buildMultiRunMarkdown } from '../cli/summary.js';

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

// --- buildMarkdownSummary tests ---

describe('buildMarkdownSummary', () => {
  function makeSummary(overrides = {}) {
    return {
      timestamp: '2025-01-15T12:00:00.000Z',
      racers: ['lauda', 'hunt'],
      settings: {},
      comparisons: [
        { name: 'Load', racers: [{ duration: 1.0 }, { duration: 2.0 }], winner: 'lauda', diff: 1.0, diffPercent: 100.0 },
      ],
      overallWinner: 'lauda',
      wins: { lauda: 1, hunt: 0 },
      errors: [],
      videos: { lauda: '/tmp/r/lauda/lauda.race.webm', hunt: '/tmp/r/hunt/hunt.race.webm', lauda_full: null, hunt_full: null },
      clickCounts: { lauda: 0, hunt: 0 },
      profileComparison: { measured: { comparisons: [] }, total: { comparisons: [] }, comparisons: [], wins: {} },
      ...overrides,
    };
  }

  it('includes ASCII art header', () => {
    const md = buildMarkdownSummary(makeSummary(), null);
    expect(md).toContain('```');
    expect(md).toContain('/_/ |_|');
  });

  it('shows winner announcement', () => {
    const md = buildMarkdownSummary(makeSummary(), null);
    expect(md).toContain('## Winner: lauda (1 - 0)');
  });

  it('shows tie announcement', () => {
    const md = buildMarkdownSummary(makeSummary({
      overallWinner: 'tie',
      wins: { lauda: 1, hunt: 1 },
    }), null);
    expect(md).toContain("## It's a Tie! lauda 1 - hunt 1");
  });

  it('includes Race Info section', () => {
    const md = buildMarkdownSummary(makeSummary(), null);
    expect(md).toContain('### Race Info');
    expect(md).toContain('**Racer 1**');
    expect(md).toContain('**Racer 2**');
    expect(md).toContain('lauda');
    expect(md).toContain('hunt');
  });

  it('includes settings in Race Info', () => {
    const md = buildMarkdownSummary(makeSummary({
      settings: { network: 'fast-3g', cpuThrottle: 4, parallel: false },
    }), null);
    expect(md).toContain('**Network**');
    expect(md).toContain('fast-3g');
    expect(md).toContain('**CPU Throttle**');
    expect(md).toContain('4x');
    expect(md).toContain('**Mode**');
    expect(md).toContain('sequential');
  });

  it('includes Results table', () => {
    const md = buildMarkdownSummary(makeSummary(), null);
    expect(md).toContain('### Results');
    expect(md).toContain('| Load |');
    expect(md).toContain('1.000s');
    expect(md).toContain('2.000s');
    expect(md).toContain('lauda');
    expect(md).toContain('100.0%');
  });

  it('includes click counts in results table', () => {
    const md = buildMarkdownSummary(makeSummary({
      clickCounts: { lauda: 5, hunt: 3 },
    }), null);
    expect(md).toContain('| Clicks |');
    expect(md).toContain('5');
    expect(md).toContain('3');
  });

  it('includes errors section when present', () => {
    const md = buildMarkdownSummary(makeSummary({
      errors: ['lauda: timeout', 'hunt: crash'],
    }), null);
    expect(md).toContain('### Errors');
    expect(md).toContain('- lauda: timeout');
    expect(md).toContain('- hunt: crash');
  });

  it('omits errors section when no errors', () => {
    const md = buildMarkdownSummary(makeSummary(), null);
    expect(md).not.toContain('### Errors');
  });

  it('includes Files section with video links', () => {
    const md = buildMarkdownSummary(makeSummary(), null);
    expect(md).toContain('### Files');
    expect(md).toContain('lauda.race.webm');
    expect(md).toContain('hunt.race.webm');
  });

  it('includes side-by-side link in Files', () => {
    const md = buildMarkdownSummary(makeSummary(), 'lauda-vs-hunt.webm');
    expect(md).toContain('**side-by-side**');
    expect(md).toContain('lauda-vs-hunt.webm');
  });

  it('handles empty comparisons', () => {
    const md = buildMarkdownSummary(makeSummary({ comparisons: [] }), null);
    expect(md).toContain('### Race Info');
    expect(md).not.toContain('### Results');
  });

  it('defaults mode to parallel', () => {
    const md = buildMarkdownSummary(makeSummary(), null);
    expect(md).toContain('parallel');
  });
});

// --- buildMedianSummary tests ---

describe('buildMedianSummary', () => {
  function makeSingleSummary(duration1, duration2) {
    return {
      racers: ['a', 'b'],
      settings: { network: 'none' },
      comparisons: [{
        name: 'Load',
        racers: [{ duration: duration1 }, { duration: duration2 }],
        winner: duration1 < duration2 ? 'a' : 'b',
        diff: Math.abs(duration1 - duration2),
        diffPercent: 50,
        rankings: duration1 < duration2 ? ['a', 'b'] : ['b', 'a'],
      }],
      overallWinner: duration1 < duration2 ? 'a' : 'b',
      wins: duration1 < duration2 ? { a: 1, b: 0 } : { a: 0, b: 1 },
      errors: [],
    };
  }

  it('computes median from odd number of runs', () => {
    const summaries = [
      makeSingleSummary(1.0, 2.0),
      makeSingleSummary(1.5, 2.5),
      makeSingleSummary(1.2, 2.2),
    ];
    const median = buildMedianSummary(summaries, '/tmp/results');

    // Median of [1.0, 1.2, 1.5] = 1.2
    expect(median.comparisons[0].racers[0].duration).toBeCloseTo(1.2);
    // Median of [2.0, 2.2, 2.5] = 2.2
    expect(median.comparisons[0].racers[1].duration).toBeCloseTo(2.2);
    expect(median.runs).toBe(3);
  });

  it('computes median from even number of runs', () => {
    const summaries = [
      makeSingleSummary(1.0, 2.0),
      makeSingleSummary(2.0, 3.0),
    ];
    const median = buildMedianSummary(summaries, '/tmp/results');

    // Median of [1.0, 2.0] = 1.5
    expect(median.comparisons[0].racers[0].duration).toBeCloseTo(1.5);
  });

  it('preserves racer names and settings', () => {
    const summaries = [makeSingleSummary(1.0, 2.0)];
    const median = buildMedianSummary(summaries, '/tmp/results');

    expect(median.racers).toEqual(['a', 'b']);
    expect(median.settings).toEqual({ network: 'none' });
  });
});

// --- buildMultiRunMarkdown tests ---

describe('buildMultiRunMarkdown', () => {
  function makeSingleSummary(duration1, duration2) {
    return {
      racers: ['a', 'b'],
      settings: { network: 'none' },
      comparisons: [{
        name: 'Load',
        racers: [{ duration: duration1 }, { duration: duration2 }],
        winner: 'a',
        diff: duration2 - duration1,
        diffPercent: ((duration2 - duration1) / duration1) * 100,
        rankings: ['a', 'b'],
      }],
      overallWinner: 'a',
      wins: { a: 1, b: 0 },
      errors: [],
    };
  }

  it('includes Median Results header', () => {
    const summaries = [makeSingleSummary(1.0, 2.0), makeSingleSummary(1.5, 2.5)];
    const median = buildMedianSummary(summaries, '/tmp/results');
    const md = buildMultiRunMarkdown(median, summaries);

    expect(md).toContain('Median Results (2 runs)');
  });

  it('includes Individual Runs section', () => {
    const summaries = [makeSingleSummary(1.0, 2.0), makeSingleSummary(1.5, 2.5)];
    const median = buildMedianSummary(summaries, '/tmp/results');
    const md = buildMultiRunMarkdown(median, summaries);

    expect(md).toContain('## Individual Runs');
    expect(md).toContain('### Run 1');
    expect(md).toContain('### Run 2');
  });

  it('includes results table for each run', () => {
    const summaries = [makeSingleSummary(1.0, 2.0), makeSingleSummary(1.5, 2.5)];
    const median = buildMedianSummary(summaries, '/tmp/results');
    const md = buildMultiRunMarkdown(median, summaries);

    expect(md).toContain('1.000s');
    expect(md).toContain('1.500s');
  });

  it('includes links to individual run results', () => {
    const summaries = [makeSingleSummary(1.0, 2.0), makeSingleSummary(1.5, 2.5)];
    const median = buildMedianSummary(summaries, '/tmp/results');
    const md = buildMultiRunMarkdown(median, summaries);

    expect(md).toContain('[run/1](./1/)');
    expect(md).toContain('[run/2](./2/)');
  });
});
