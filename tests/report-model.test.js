import { describe, it, expect } from 'vitest';
import {
  isSyntheticTotal,
  getSectionComparisons,
  sortComparisonsForDisplay,
  formatDuration,
  buildValueCell,
  buildDurationCell,
  buildComparisonCells,
  buildBestOfCells,
  rankEntries,
  rankComparisonDurations,
  buildResultsModel,
  buildRunComparisonModel,
} from '../cli/report-model.js';
import { PROFILE_METRICS } from '../cli/profile-analysis.js';

describe('isSyntheticTotal / getSectionComparisons', () => {
  it('detects synthetic totals only via the explicit flag', () => {
    expect(isSyntheticTotal({ isSyntheticTotal: true })).toBe(true);
    expect(isSyntheticTotal({ isSyntheticTotal: false })).toBe(false);
    expect(isSyntheticTotal({ name: 'Race' })).toBe(false);
    expect(isSyntheticTotal(null)).toBe(false);
    expect(isSyntheticTotal(undefined)).toBe(false);
  });

  it('filters synthetic totals out of section comparisons', () => {
    const comps = [
      { name: 'Load' },
      { name: 'Race', isSyntheticTotal: true },
      { name: 'Render' },
    ];
    expect(getSectionComparisons(comps).map(c => c.name)).toEqual(['Load', 'Render']);
  });
});

describe('sortComparisonsForDisplay', () => {
  it('moves the synthetic total first and keeps section order stable', () => {
    const comps = [
      { name: 'Load' },
      { name: 'Render' },
      { name: 'Race', isSyntheticTotal: true },
      { name: 'Paint' },
    ];
    const sorted = sortComparisonsForDisplay(comps);
    expect(sorted.map(c => c.name)).toEqual(['Race', 'Load', 'Render', 'Paint']);
    // Original array is not mutated
    expect(comps.map(c => c.name)).toEqual(['Load', 'Render', 'Race', 'Paint']);
  });

  it('leaves order untouched when there is no synthetic total', () => {
    const comps = [{ name: 'B' }, { name: 'A' }, { name: 'C' }];
    expect(sortComparisonsForDisplay(comps).map(c => c.name)).toEqual(['B', 'A', 'C']);
  });

  it('handles an empty list', () => {
    expect(sortComparisonsForDisplay([])).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('formats with three decimals and an s suffix', () => {
    expect(formatDuration(1.5)).toBe('1.500s');
    expect(formatDuration(0)).toBe('0.000s');
    expect(formatDuration(2.0004)).toBe('2.000s');
  });
});

describe('buildValueCell / buildDurationCell', () => {
  it('returns a null cell for missing values', () => {
    expect(buildDurationCell(null, 1.0, false)).toEqual({ value: null, formatted: null, isWinner: false, delta: null });
    expect(buildDurationCell(undefined, null, false)).toEqual({ value: null, formatted: null, isWinner: false, delta: null });
  });

  it('flags the winner without a delta', () => {
    const cell = buildDurationCell(1.0, 1.0, true);
    expect(cell).toEqual({ value: 1.0, formatted: '1.000s', isWinner: true, delta: null });
  });

  it('computes a formatted delta against the best value for losers', () => {
    const cell = buildDurationCell(2.5, 1.0, false);
    expect(cell.formatted).toBe('2.500s');
    expect(cell.delta).toBe('1.500s');
    expect(cell.isWinner).toBe(false);
  });

  it('produces a +0.000s-style delta for exact ties against the winner', () => {
    const cell = buildDurationCell(2.0, 2.0, false);
    expect(cell.delta).toBe('0.000s');
  });

  it('omits the delta when there is no best value', () => {
    const cell = buildDurationCell(2.0, null, false);
    expect(cell.delta).toBeNull();
    expect(cell.formatted).toBe('2.000s');
  });

  it('uses the supplied format function', () => {
    const cell = buildValueCell(300, 100, false, v => `${v}ms`);
    expect(cell.formatted).toBe('300ms');
    expect(cell.delta).toBe('200ms');
  });
});

describe('buildComparisonCells', () => {
  const racers = ['a', 'b', 'c'];

  it('marks the declared winner and deltas relative to its duration', () => {
    const comp = { name: 'Load', winner: 'b', racers: [{ duration: 2.0 }, { duration: 1.0 }, { duration: 3.5 }] };
    const cells = buildComparisonCells(comp, racers);
    expect(cells.map(c => c.isWinner)).toEqual([false, true, false]);
    expect(cells[0].delta).toBe('1.000s');
    expect(cells[1].delta).toBeNull();
    expect(cells[2].delta).toBe('2.500s');
  });

  it('handles a missing racer entry as a null cell', () => {
    const comp = { name: 'Load', winner: 'a', racers: [{ duration: 1.0 }, null, { duration: 2.0 }] };
    const cells = buildComparisonCells(comp, racers);
    expect(cells[1]).toEqual({ value: null, formatted: null, isWinner: false, delta: null });
    expect(cells[2].delta).toBe('1.000s');
  });

  it('shows plain values when there is no winner', () => {
    const comp = { name: 'Load', winner: null, racers: [{ duration: 1.0 }, { duration: 2.0 }, null] };
    const cells = buildComparisonCells(comp, racers);
    expect(cells.every(c => !c.isWinner)).toBe(true);
    expect(cells[0].delta).toBeNull();
    expect(cells[1].delta).toBeNull();
  });
});

describe('buildBestOfCells', () => {
  const fmt = v => `${v}ms`;

  it('flags the single lowest value as winner and deltas for the rest', () => {
    const cells = buildBestOfCells([300, 100, 200], fmt);
    expect(cells.map(c => c.isWinner)).toEqual([false, true, false]);
    expect(cells[0].delta).toBe('200ms');
    expect(cells[2].delta).toBe('100ms');
  });

  it('declares no winner when all values are equal', () => {
    const cells = buildBestOfCells([100, 100], fmt);
    expect(cells.every(c => !c.isWinner)).toBe(true);
    expect(cells.every(c => c.delta === null)).toBe(true);
    expect(cells.map(c => c.formatted)).toEqual(['100ms', '100ms']);
  });

  it('declares no winner with fewer than two data points (single racer)', () => {
    const cells = buildBestOfCells([100, null], fmt);
    expect(cells[0].isWinner).toBe(false);
    expect(cells[0].delta).toBeNull();
    expect(cells[1].value).toBeNull();
  });

  it('picks the first racer on an exact tie for best when a third differs', () => {
    const cells = buildBestOfCells([100, 100, 200], fmt);
    expect(cells.map(c => c.isWinner)).toEqual([true, false, false]);
    // The tying racer still gets a zero delta, the slower one a real delta
    expect(cells[1].delta).toBe('0ms');
    expect(cells[2].delta).toBe('100ms');
  });

  it('handles all-null rows', () => {
    const cells = buildBestOfCells([null, null], fmt);
    expect(cells).toHaveLength(2);
    expect(cells.every(c => c.value === null && !c.isWinner)).toBe(true);
  });
});

describe('rankEntries', () => {
  const fmt = v => `${v}u`;

  it('compares two missing values as equal (comparator contract)', () => {
    // cmp(a,b) must equal -cmp(b,a); returning 1 for an equal pair makes the
    // ordering of valueless racers engine-dependent.
    const { entries, bestValue, maxValue } = rankEntries(
      ['a', 'b', 'c'],
      i => ({ val: i === 1 ? 5 : null }),
      fmt
    );
    expect(entries.map(e => e.name)).toEqual(['b', 'a', 'c']);
    expect(entries.map(e => e.delta)).toEqual([null, null, null]);
    expect(bestValue).toBe(5);
    expect(maxValue).toBe(5);
  });

  it('treats undefined like null instead of producing NaN comparisons', () => {
    const { entries, maxValue } = rankEntries(
      ['a', 'b', 'c'],
      i => ({ val: [undefined, 3, 1][i] }),
      fmt
    );
    expect(entries.map(e => e.name)).toEqual(['c', 'b', 'a']);
    expect(entries.map(e => e.delta)).toEqual([null, '2u', null]);
    expect(maxValue).toBe(3);
  });

  it('returns all-missing entries without deltas or a NaN max', () => {
    const { entries, bestValue, maxValue } = rankEntries(
      ['a', 'b'],
      () => ({ val: null }),
      fmt
    );
    expect(entries.map(e => e.delta)).toEqual([null, null]);
    expect(bestValue).toBeNull();
    expect(maxValue).toBe(0);
  });

  it('sorts ascending with nulls last and computes deltas from the best', () => {
    const values = [30, null, 10, 20];
    const { entries, bestValue, maxValue } = rankEntries(
      ['a', 'b', 'c', 'd'],
      i => ({ val: values[i], formatted: values[i] !== null ? `${values[i]}u` : '-' }),
      fmt
    );
    expect(entries.map(e => e.name)).toEqual(['c', 'd', 'a', 'b']);
    expect(entries.map(e => e.index)).toEqual([2, 3, 0, 1]);
    expect(bestValue).toBe(10);
    expect(maxValue).toBe(30);
    expect(entries.map(e => e.delta)).toEqual([null, '10u', '20u', null]);
  });

  it('gives no deltas when values tie with the best', () => {
    const values = [10, 10];
    const { entries } = rankEntries(['a', 'b'], i => ({ val: values[i] }), fmt);
    expect(entries.every(e => e.delta === null)).toBe(true);
  });

  it('handles a single racer', () => {
    const { entries, bestValue, maxValue } = rankEntries(['solo'], () => ({ val: 5 }), fmt);
    expect(entries).toHaveLength(1);
    expect(entries[0].delta).toBeNull();
    expect(bestValue).toBe(5);
    expect(maxValue).toBe(5);
  });

  it('reports maxValue 0 when no racer has data', () => {
    const { entries, maxValue } = rankEntries(['a', 'b'], () => ({ val: null }), fmt);
    expect(maxValue).toBe(0);
    expect(entries.every(e => e.delta === null)).toBe(true);
  });

  it('carries extra entry fields through', () => {
    const { entries } = rankEntries(['a'], () => ({ val: 1, formatted: '1u', tag: 'x' }), fmt);
    expect(entries[0].formatted).toBe('1u');
    expect(entries[0].tag).toBe('x');
  });
});

describe('rankComparisonDurations', () => {
  it('formats durations and dashes for missing racers', () => {
    const comp = { racers: [{ duration: 2.0 }, null, { duration: 1.0 }] };
    const { entries } = rankComparisonDurations(comp, ['a', 'b', 'c']);
    expect(entries.map(e => e.name)).toEqual(['c', 'a', 'b']);
    expect(entries.map(e => e.formatted)).toEqual(['1.000s', '2.000s', '-']);
    expect(entries.map(e => e.delta)).toEqual([null, '1.000s', null]);
  });
});

describe('buildResultsModel', () => {
  const racers = ['a', 'b'];

  it('orders the synthetic total first and counts sections', () => {
    const comps = [
      { name: 'Load', winner: 'a', racers: [{ duration: 1.0 }, { duration: 2.0 }] },
      { name: 'Render', winner: 'b', racers: [{ duration: 0.5 }, { duration: 0.4 }] },
      { name: 'Race', winner: 'a', isSyntheticTotal: true, racers: [{ duration: 1.5 }, { duration: 2.4 }] },
    ];
    const model = buildResultsModel(comps, racers);
    expect(model.rows.map(r => r.name)).toEqual(['Race', 'Load', 'Render']);
    expect(model.rows.map(r => r.isTotal)).toEqual([true, false, false]);
    expect(model.sectionCount).toBe(2);
  });

  it('provides winner-relative cells and best-relative rankings per row', () => {
    const comps = [{ name: 'Load', winner: 'a', racers: [{ duration: 1.0 }, { duration: 2.5 }] }];
    const [row] = buildResultsModel(comps, racers).rows;
    expect(row.winner).toBe('a');
    expect(row.cells[0]).toMatchObject({ formatted: '1.000s', isWinner: true, delta: null });
    expect(row.cells[1]).toMatchObject({ formatted: '2.500s', isWinner: false, delta: '1.500s' });
    expect(row.ranking.entries.map(e => e.name)).toEqual(['a', 'b']);
    expect(row.ranking.maxValue).toBe(2.5);
  });

  it('handles an empty comparison list', () => {
    const model = buildResultsModel([], racers);
    expect(model.rows).toEqual([]);
    expect(model.sectionCount).toBe(0);
  });

  it('handles a comparison with a single racer having data', () => {
    const comps = [{ name: 'Load', winner: null, racers: [{ duration: 1.0 }, null] }];
    const [row] = buildResultsModel(comps, racers).rows;
    expect(row.cells[0]).toMatchObject({ formatted: '1.000s', isWinner: false, delta: null });
    expect(row.cells[1].value).toBeNull();
  });
});

describe('buildRunComparisonModel', () => {
  const racers = ['a', 'b'];

  function makeSummaries() {
    return [
      { comparisons: [{ name: 'Load', winner: 'a', racers: [{ duration: 1.0 }, { duration: 3.0 }] }], profileMetrics: null },
      { comparisons: [{ name: 'Load', winner: 'a', racers: [{ duration: 2.0 }, { duration: 4.0 }] }], profileMetrics: null },
      { comparisons: [{ name: 'Load', winner: 'a', racers: [{ duration: 3.0 }, { duration: 5.0 }] }], profileMetrics: null },
    ];
  }
  const median = { comparisons: [{ name: 'Load', winner: 'a', racers: [{ duration: 2.0 }, { duration: 4.0 }] }] };

  it('is empty with no measurements and no profile data', () => {
    const model = buildRunComparisonModel(
      [{ comparisons: [], profileMetrics: null }, { comparisons: [], profileMetrics: null }],
      { comparisons: [] }, racers, PROFILE_METRICS
    );
    expect(model.isEmpty).toBe(true);
    expect(model.measurements).toEqual([]);
    expect(model.profileScopes).toEqual([]);
  });

  it('builds labeled run rows plus median and average rows', () => {
    const model = buildRunComparisonModel(makeSummaries(), median, racers, PROFILE_METRICS);
    expect(model.isEmpty).toBe(false);
    expect(model.measurements).toHaveLength(1);
    const m = model.measurements[0];
    expect(m.name).toBe('Load');
    expect(m.runRows.map(r => r.label)).toEqual(['1', '2', '3']);
    expect(m.runRows[0].cells[0]).toMatchObject({ formatted: '1.000s', isWinner: true });
    expect(m.runRows[0].cells[1]).toMatchObject({ formatted: '3.000s', delta: '2.000s' });
    // Median row mirrors the median summary comparison
    expect(m.medianRow.cells[0]).toMatchObject({ formatted: '2.000s', isWinner: true });
    // Average: a = (1+2+3)/3 = 2, b = (3+4+5)/3 = 4
    expect(m.averageRow.cells[0]).toMatchObject({ formatted: '2.000s', isWinner: true, delta: null });
    expect(m.averageRow.cells[1]).toMatchObject({ formatted: '4.000s', isWinner: false, delta: '2.000s' });
  });

  it('emits dash rows for runs missing a measurement and averages over present runs only', () => {
    const summaries = makeSummaries();
    summaries[1] = { comparisons: [], profileMetrics: null };
    const model = buildRunComparisonModel(summaries, median, racers, PROFILE_METRICS);
    const m = model.measurements[0];
    expect(m.runRows[1].cells.every(c => c.value === null)).toBe(true);
    // Average over runs 1 and 3: a = 2, b = 4
    expect(m.averageRow.cells[0].formatted).toBe('2.000s');
    expect(m.averageRow.cells[1].formatted).toBe('4.000s');
  });

  it('flags every racer tying the best average as a winner', () => {
    const summaries = [
      { comparisons: [{ name: 'Load', winner: 'a', racers: [{ duration: 1.0 }, { duration: 3.0 }] }], profileMetrics: null },
      { comparisons: [{ name: 'Load', winner: 'b', racers: [{ duration: 3.0 }, { duration: 1.0 }] }], profileMetrics: null },
    ];
    const model = buildRunComparisonModel(summaries, { comparisons: [] }, racers, PROFILE_METRICS);
    const m = model.measurements[0];
    expect(m.medianRow).toBeNull();
    // Both average to 2.0 — both are flagged winners (historical behavior)
    expect(m.averageRow.cells.map(c => c.isWinner)).toEqual([true, true]);
  });

  it('omits the average row when no racer has data and keeps missing-median null', () => {
    const summaries = [
      { comparisons: [{ name: 'Load', winner: null, racers: [null, null] }], profileMetrics: null },
      { comparisons: [], profileMetrics: null },
    ];
    const model = buildRunComparisonModel(summaries, { comparisons: [] }, racers, PROFILE_METRICS);
    const m = model.measurements[0];
    expect(m.averageRow).toBeNull();
    expect(m.medianRow).toBeNull();
  });

  it('keeps measurement tables in first-seen order across runs', () => {
    // Note: measurement names are collected into a Set and the synthetic-total
    // flag is not carried onto the name wrappers, so ordering here is first-seen
    // order — matching the historical run-by-run section behavior.
    const summaries = [
      {
        comparisons: [
          { name: 'Load', winner: 'a', racers: [{ duration: 1.0 }, { duration: 2.0 }] },
          { name: 'Race', winner: 'a', isSyntheticTotal: true, racers: [{ duration: 1.0 }, { duration: 2.0 }] },
        ],
        profileMetrics: null,
      },
      { comparisons: [{ name: 'Render', winner: null, racers: [{ duration: 0.5 }, null] }], profileMetrics: null },
    ];
    const model = buildRunComparisonModel(summaries, { comparisons: [] }, racers, PROFILE_METRICS);
    expect(model.measurements.map(m => m.name)).toEqual(['Load', 'Race', 'Render']);
  });

  it('builds profile scopes only for metrics with data, in measured/total order', () => {
    const summaries = [
      {
        comparisons: [],
        profileMetrics: [
          { measured: { scriptDuration: 100 }, total: { fcp: 800 } },
          { measured: { scriptDuration: 200 }, total: { fcp: 900 } },
        ],
      },
      {
        comparisons: [],
        profileMetrics: [
          { measured: { scriptDuration: 120 }, total: {} },
          { measured: { scriptDuration: 180 }, total: { fcp: 950 } },
        ],
      },
    ];
    const medianWithProfiles = {
      comparisons: [],
      profileMetrics: [
        { measured: { scriptDuration: 110 }, total: { fcp: 800 } },
        { measured: { scriptDuration: 190 }, total: { fcp: 925 } },
      ],
    };
    const model = buildRunComparisonModel(summaries, medianWithProfiles, racers, PROFILE_METRICS);
    expect(model.isEmpty).toBe(false);
    expect(model.profileScopes.map(s => s.scope)).toEqual(['measured', 'total']);
    expect(model.profileScopes[0].title).toBe('Race');
    expect(model.profileScopes[1].title).toBe('Total Recording (Including Pre and Post race)');

    const script = model.profileScopes[0].metrics[0];
    expect(script.name).toBe('Script Execution');
    expect(script.runRows).toHaveLength(2);
    // Run 1: a=100 wins, b=200 delta formatted via metric.format (formatMs)
    expect(script.runRows[0].cells[0]).toMatchObject({ formatted: '100.0ms', isWinner: true });
    expect(script.runRows[0].cells[1]).toMatchObject({ formatted: '200.0ms', delta: '100.0ms' });
    // Median from the median summary's profile metrics
    expect(script.medianRow.cells[0]).toMatchObject({ formatted: '110.0ms', isWinner: true });
    // Average: a = 110, b = 190
    expect(script.averageRow.cells[0]).toMatchObject({ formatted: '110.0ms', isWinner: true });
    expect(script.averageRow.cells[1]).toMatchObject({ formatted: '190.0ms', delta: '80.0ms' });

    const fcp = model.profileScopes[1].metrics.find(m => m.name.includes('First Contentful Paint'));
    // Run 2 has fcp only for racer b -> single data point, no winner
    expect(fcp.runRows[1].cells[0].value).toBeNull();
    expect(fcp.runRows[1].cells[1]).toMatchObject({ isWinner: false, delta: null });
    // Average for a uses only run 1 (800); b averages 900 and 950 -> 925
    expect(fcp.averageRow.cells[0].formatted).toBe('800.0ms');
    expect(fcp.averageRow.cells[1].formatted).toBe('925.0ms');
  });

  it('omits profile median/average rows when the median summary has no profile data', () => {
    const summaries = [
      { comparisons: [], profileMetrics: [{ measured: { scriptDuration: 100 }, total: {} }, { measured: {}, total: {} }] },
      { comparisons: [], profileMetrics: [{ measured: { scriptDuration: 120 }, total: {} }, { measured: {}, total: {} }] },
    ];
    const model = buildRunComparisonModel(summaries, { comparisons: [], profileMetrics: null }, racers, PROFILE_METRICS);
    const script = model.profileScopes[0].metrics[0];
    expect(script.medianRow).toBeNull();
    // Only racer a has data -> average row exists but has no winner (single data point)
    expect(script.averageRow.cells[0]).toMatchObject({ formatted: '110.0ms', isWinner: false, delta: null });
    expect(script.averageRow.cells[1].value).toBeNull();
  });

  it('declares no profile winner when values are identical across racers', () => {
    const summaries = [
      { comparisons: [], profileMetrics: [{ measured: { scriptDuration: 100 }, total: {} }, { measured: { scriptDuration: 100 }, total: {} }] },
      { comparisons: [], profileMetrics: [{ measured: { scriptDuration: 100 }, total: {} }, { measured: { scriptDuration: 100 }, total: {} }] },
    ];
    const model = buildRunComparisonModel(summaries, { comparisons: [], profileMetrics: null }, racers, PROFILE_METRICS);
    const script = model.profileScopes[0].metrics[0];
    expect(script.runRows[0].cells.every(c => !c.isWinner && c.delta === null)).toBe(true);
    expect(script.averageRow.cells.every(c => !c.isWinner)).toBe(true);
  });

  it('supports a single racer end to end', () => {
    const solo = ['only'];
    const summaries = [
      { comparisons: [{ name: 'Load', winner: null, racers: [{ duration: 1.0 }] }], profileMetrics: null },
      { comparisons: [{ name: 'Load', winner: null, racers: [{ duration: 2.0 }] }], profileMetrics: null },
    ];
    const model = buildRunComparisonModel(
      summaries,
      { comparisons: [{ name: 'Load', winner: null, racers: [{ duration: 1.5 }] }] },
      solo, PROFILE_METRICS
    );
    const m = model.measurements[0];
    expect(m.runRows[0].cells).toHaveLength(1);
    expect(m.runRows[0].cells[0]).toMatchObject({ formatted: '1.000s', isWinner: false, delta: null });
    // Average of a single racer: no best (needs >= 2 racers with data), plain value
    expect(m.averageRow.cells[0]).toMatchObject({ formatted: '1.500s', isWinner: false, delta: null });
  });
});
