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

describe('buildMarkdownSummary', () => {
  function makeSummary(overrides = {}) {
    return {
      racers: ['lauda', 'hunt'],
      comparisons: [
        {
          name: 'Load',
          racers: [{ duration: 1.0 }, { duration: 2.0 }],
          winner: 'lauda',
          diff: 1.0,
          diffPercent: 100.0,
        },
      ],
      overallWinner: 'lauda',
      wins: { lauda: 1, hunt: 0 },
      errors: [],
      videos: { lauda: '/tmp/results/lauda.race.webm', hunt: '/tmp/results/hunt.race.webm' },
      clickCounts: { lauda: 3, hunt: 1 },
      settings: { parallel: true },
      timestamp: '2025-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('includes ASCII art header', () => {
    const md = buildMarkdownSummary(makeSummary());
    expect(md).toContain('Race');
    expect(md).toContain('```');
  });

  it('includes winner announcement', () => {
    const md = buildMarkdownSummary(makeSummary());
    expect(md).toContain('## Winner: lauda (1 - 0)');
  });

  it('shows tie when applicable', () => {
    const md = buildMarkdownSummary(makeSummary({ overallWinner: 'tie' }));
    expect(md).toContain("It's a Tie!");
  });

  it('includes results table with measurements', () => {
    const md = buildMarkdownSummary(makeSummary());
    expect(md).toContain('| Load | 1.000s | 2.000s | lauda | 100.0% |');
  });

  it('includes click counts row', () => {
    const md = buildMarkdownSummary(makeSummary());
    expect(md).toContain('| Clicks | 3 | 1 |');
  });

  it('includes video file links', () => {
    const md = buildMarkdownSummary(makeSummary());
    expect(md).toContain('lauda.race.webm');
    expect(md).toContain('hunt.race.webm');
  });

  it('includes side-by-side link when provided', () => {
    const md = buildMarkdownSummary(makeSummary(), 'sidebyside.webm');
    expect(md).toContain('side-by-side');
    expect(md).toContain('sidebyside.webm');
  });

  it('includes errors section when present', () => {
    const md = buildMarkdownSummary(makeSummary({ errors: ['lauda: timeout'] }));
    expect(md).toContain('### Errors');
    expect(md).toContain('- lauda: timeout');
  });

  it('includes settings info', () => {
    const md = buildMarkdownSummary(makeSummary({ settings: { parallel: false, network: 'fast-3g', cpuThrottle: 4 } }));
    expect(md).toContain('sequential');
    expect(md).toContain('fast-3g');
    expect(md).toContain('4x');
  });

  it('handles missing measurement for one racer', () => {
    const summary = makeSummary({
      comparisons: [{
        name: 'Load',
        racers: [{ duration: 1.5 }, null],
        winner: null,
        diff: null,
        diffPercent: null,
      }],
    });
    const md = buildMarkdownSummary(summary);
    expect(md).toContain('| Load | 1.500s | - | - | - |');
  });
});

describe('buildMedianSummary', () => {
  function makeSummaries() {
    return [
      {
        racers: ['a', 'b'],
        settings: { parallel: true },
        comparisons: [
          { name: 'Load', racers: [{ duration: 1.0 }, { duration: 3.0 }], winner: 'a' },
        ],
        errors: [],
      },
      {
        racers: ['a', 'b'],
        settings: { parallel: true },
        comparisons: [
          { name: 'Load', racers: [{ duration: 2.0 }, { duration: 4.0 }], winner: 'a' },
        ],
        errors: [],
      },
      {
        racers: ['a', 'b'],
        settings: { parallel: true },
        comparisons: [
          { name: 'Load', racers: [{ duration: 3.0 }, { duration: 5.0 }], winner: 'a' },
        ],
        errors: [],
      },
    ];
  }

  it('computes median durations across runs', () => {
    const median = buildMedianSummary(makeSummaries(), '/tmp/results');
    expect(median.comparisons[0].racers[0].duration).toBe(2.0);
    expect(median.comparisons[0].racers[1].duration).toBe(4.0);
  });

  it('computes winner from median values', () => {
    const median = buildMedianSummary(makeSummaries(), '/tmp/results');
    expect(median.comparisons[0].winner).toBe('a');
    expect(median.overallWinner).toBe('a');
  });

  it('records the number of runs', () => {
    const median = buildMedianSummary(makeSummaries(), '/tmp/results');
    expect(median.runs).toBe(3);
  });

  it('handles even number of runs (averages two middle values)', () => {
    const summaries = makeSummaries().slice(0, 2);
    const median = buildMedianSummary(summaries, '/tmp/results');
    expect(median.comparisons[0].racers[0].duration).toBe(1.5);
    expect(median.comparisons[0].racers[1].duration).toBe(3.5);
  });

  it('preserves settings from first run', () => {
    const median = buildMedianSummary(makeSummaries(), '/tmp/results');
    expect(median.settings).toEqual({ parallel: true });
  });

  it('collects errors from all runs', () => {
    const summaries = makeSummaries();
    summaries[0].errors = ['a: timeout'];
    summaries[2].errors = ['b: crash'];
    const median = buildMedianSummary(summaries, '/tmp/results');
    expect(median.errors).toEqual(['a: timeout', 'b: crash']);
  });

  it('returns null racer when no data across runs', () => {
    const summaries = [
      { racers: ['a', 'b'], settings: {}, comparisons: [{ name: 'Load', racers: [{ duration: 1.0 }, null] }], errors: [] },
      { racers: ['a', 'b'], settings: {}, comparisons: [{ name: 'Load', racers: [{ duration: 2.0 }, null] }], errors: [] },
    ];
    const median = buildMedianSummary(summaries, '/tmp/results');
    expect(median.comparisons[0].racers[1]).toBeNull();
    expect(median.comparisons[0].winner).toBeNull();
  });
});

describe('buildMultiRunMarkdown', () => {
  it('includes median header and individual run details', () => {
    const medianSummary = {
      racers: ['a', 'b'],
      comparisons: [{ name: 'Load', racers: [{ duration: 2.0 }, { duration: 4.0 }], winner: 'a', diff: 2.0, diffPercent: 100.0 }],
      overallWinner: 'a',
      wins: { a: 1, b: 0 },
      errors: [],
      videos: {},
      clickCounts: { a: 0, b: 0 },
      settings: { parallel: true },
      timestamp: '2025-01-01T00:00:00.000Z',
      runs: 3,
    };
    const summaries = [
      { racers: ['a', 'b'], comparisons: [{ name: 'Load', racers: [{ duration: 1.0 }, { duration: 3.0 }], winner: 'a', diffPercent: 200 }], errors: [] },
      { racers: ['a', 'b'], comparisons: [{ name: 'Load', racers: [{ duration: 2.0 }, { duration: 4.0 }], winner: 'a', diffPercent: 100 }], errors: [] },
      { racers: ['a', 'b'], comparisons: [{ name: 'Load', racers: [{ duration: 3.0 }, { duration: 5.0 }], winner: 'a', diffPercent: 66.7 }], errors: [] },
    ];

    const md = buildMultiRunMarkdown(medianSummary, summaries);
    expect(md).toContain('Median Results (3 runs)');
    expect(md).toContain('### Run 1');
    expect(md).toContain('### Run 2');
    expect(md).toContain('### Run 3');
    expect(md).toContain('1.000s');
    expect(md).toContain('5.000s');
  });

  it('includes errors from individual runs', () => {
    const medianSummary = {
      racers: ['a', 'b'],
      comparisons: [],
      overallWinner: null,
      wins: { a: 0, b: 0 },
      errors: [],
      videos: {},
      clickCounts: { a: 0, b: 0 },
      settings: {},
      timestamp: '2025-01-01T00:00:00.000Z',
      runs: 2,
    };
    const summaries = [
      { racers: ['a', 'b'], comparisons: [], errors: ['a: timeout'] },
      { racers: ['a', 'b'], comparisons: [], errors: [] },
    ];
    const md = buildMultiRunMarkdown(medianSummary, summaries);
    expect(md).toContain('a: timeout');
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
