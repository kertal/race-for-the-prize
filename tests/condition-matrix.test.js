import { describe, it, expect } from 'vitest';
import { buildConditionMatrix, printConditionMatrix, buildConditionIndexHtml } from '../cli/condition-matrix.js';

/** A condition summary with one total row per racer. `durations` maps racer -> seconds (null = no data). */
const summaryOf = (durations, overallWinner) => {
  const racers = Object.keys(durations);
  return {
    racers,
    overallWinner,
    comparisons: [{
      name: 'Race',
      isSyntheticTotal: true,
      winner: overallWinner === 'tie' ? null : overallWinner,
      racers: racers.map(name => durations[name] == null ? null : { duration: durations[name] }),
    }],
  };
};

/** A full network x cpu grid where every cell is won by `winnerAt(network, cpu)`. */
const gridEntries = (networks, cpus, durationsAt, winnerAt) =>
  networks.flatMap(network => cpus.map(cpu => ({
    label: `${network}-cpu${cpu}x`,
    title: `Network: ${network} · CPU: ${cpu}x`,
    network,
    cpu,
    summary: summaryOf(durationsAt(network, cpu), winnerAt(network, cpu)),
  })));

/** Capture printConditionMatrix output as one plain string (ANSI codes stripped). */
const render = (matrix, width = 200) => {
  let out = '';
  printConditionMatrix(matrix, s => { out += s; }, width);
  // eslint-disable-next-line no-control-regex
  return out.replace(/\[[0-9;]*m/g, '');
};

describe('buildConditionMatrix', () => {
  it('lays network down the side and CPU across the top when both vary', () => {
    const matrix = buildConditionMatrix(gridEntries(
      ['none', 'slow-3g'], [1, 4],
      () => ({ lauda: 1, hunt: 2 }),
      () => 'lauda'
    ));

    expect(matrix.rowHeader).toBe('Network');
    expect(matrix.columns).toEqual(['CPU 1x', 'CPU 4x']);
    expect(matrix.rows.map(r => r.header)).toEqual(['none', 'slow-3g']);
    expect(matrix.rows[0].cells.map(cell => cell.label)).toEqual(['none-cpu1x', 'none-cpu4x']);
  });

  it('collapses to a single column when only the network varies', () => {
    const matrix = buildConditionMatrix(gridEntries(
      ['none', '4g'], [1],
      () => ({ lauda: 1, hunt: 2 }),
      () => 'lauda'
    ));

    expect(matrix.rowHeader).toBe('Network');
    expect(matrix.columns).toEqual(['Result']);
    expect(matrix.rows.map(r => r.header)).toEqual(['none', '4g']);
  });

  it('puts CPU rates down the side when only the CPU varies', () => {
    const matrix = buildConditionMatrix(gridEntries(
      ['none'], [1, 4, 6],
      () => ({ lauda: 1, hunt: 2 }),
      () => 'lauda'
    ));

    expect(matrix.rowHeader).toBe('CPU');
    expect(matrix.columns).toEqual(['Result']);
    expect(matrix.rows.map(r => r.header)).toEqual(['CPU 1x', 'CPU 4x', 'CPU 6x']);
  });

  it('falls back to one row per condition when entries carry no coordinates', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', title: 'Condition A', summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda') },
      { label: 'b', title: 'Condition B', summary: summaryOf({ lauda: 3, hunt: 2 }, 'hunt') },
    ]);

    expect(matrix.rowHeader).toBe('Condition');
    expect(matrix.rows.map(r => r.header)).toEqual(['Condition A', 'Condition B']);
    expect(matrix.rows.every(row => row.cells.length === 1)).toBe(true);
  });

  it('falls back to one row per condition when the grid has a gap', () => {
    // 2 networks x 2 CPUs would be four conditions; only three were raced.
    const matrix = buildConditionMatrix([
      { label: 'none-cpu1x', network: 'none', cpu: 1, summary: summaryOf({ a: 1 }, 'a') },
      { label: 'none-cpu4x', network: 'none', cpu: 4, summary: summaryOf({ a: 2 }, 'a') },
      { label: '4g-cpu1x', network: '4g', cpu: 1, summary: summaryOf({ a: 3 }, 'a') },
    ]);

    expect(matrix.rowHeader).toBe('Condition');
    expect(matrix.rows).toHaveLength(3);
  });

  it('ranks each cell fastest first and flags the winner', () => {
    const [cell] = buildConditionMatrix([
      { label: '4g', network: '4g', cpu: 1, summary: summaryOf({ lauda: 2.5, hunt: 1.5 }, 'hunt') },
    ]).cells;

    expect(cell.racers.map(r => r.name)).toEqual(['hunt', 'lauda']);
    expect(cell.racers[0]).toMatchObject({ isWinner: true, formatted: '1.500s', delta: null });
    expect(cell.racers[1]).toMatchObject({ isWinner: false, formatted: '2.500s', delta: '1.000s' });
    expect(cell.best).toBe(1.5);
  });

  it('marks a tie without crowning a winner', () => {
    const [cell] = buildConditionMatrix([
      { label: '4g', network: '4g', cpu: 1, summary: summaryOf({ lauda: 2, hunt: 2 }, 'tie') },
    ]).cells;

    expect(cell.isTie).toBe(true);
    expect(cell.winner).toBeNull();
    expect(cell.racers.some(r => r.isWinner)).toBe(false);
  });

  it('sums nothing for a racer with no data in a condition', () => {
    const [cell] = buildConditionMatrix([
      { label: '4g', network: '4g', cpu: 1, summary: summaryOf({ lauda: 2, hunt: null }, 'lauda') },
    ]).cells;

    // Missing values sort last and carry no formatted time.
    expect(cell.racers.map(r => r.name)).toEqual(['lauda', 'hunt']);
    expect(cell.racers[1].formatted).toBeNull();
  });

  it('prefers the synthetic total over the individual sections', () => {
    const [cell] = buildConditionMatrix([{
      label: '4g',
      network: '4g',
      cpu: 1,
      summary: {
        racers: ['lauda', 'hunt'],
        overallWinner: 'lauda',
        comparisons: [
          { name: 'load', winner: 'lauda', racers: [{ duration: 1 }, { duration: 2 }] },
          { name: 'Race', isSyntheticTotal: true, winner: 'lauda', racers: [{ duration: 4 }, { duration: 9 }] },
        ],
      },
    }]).cells;

    expect(cell.racers.map(r => r.duration)).toEqual([4, 9]);
  });

  it('matches racers by name when a condition lists them in a different order', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda') },
      // Same two racers, opposite order — the durations must not swap cells.
      { label: 'b', network: 'none', cpu: 4, summary: summaryOf({ hunt: 8, lauda: 4 }, 'lauda') },
    ]);

    const durations = Object.fromEntries(matrix.cells[1].racers.map(r => [r.name, r.duration]));
    expect(durations).toEqual({ lauda: 4, hunt: 8 });
  });

  it('uses the only section when there is no synthetic total', () => {
    const [cell] = buildConditionMatrix([{
      label: '4g',
      network: '4g',
      cpu: 1,
      summary: {
        racers: ['lauda'],
        overallWinner: 'lauda',
        comparisons: [{ name: 'load', winner: 'lauda', racers: [{ duration: 1.25 }] }],
      },
    }]).cells;

    expect(cell.racers[0].duration).toBe(1.25);
  });

  it('tallies condition wins and ties, and the slowest time for bar scaling', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda') },
      { label: 'b', network: 'none', cpu: 4, summary: summaryOf({ lauda: 8, hunt: 4 }, 'hunt') },
      { label: 'c', network: '4g', cpu: 1, summary: summaryOf({ lauda: 3, hunt: 3 }, 'tie') },
      { label: 'd', network: '4g', cpu: 4, summary: summaryOf({ lauda: 5, hunt: 6 }, 'lauda') },
    ]);

    expect(matrix.wins).toEqual({ lauda: 2, hunt: 1 });
    expect(matrix.ties).toBe(1);
    expect(matrix.maxDuration).toBe(8);
  });

  it('survives a condition that recorded no measurements', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: null },
      { label: 'b', network: '4g', cpu: 1, summary: { racers: ['lauda'], overallWinner: null, comparisons: [] } },
    ]);

    expect(matrix.cells[0].racers.every(r => r.duration === null)).toBe(true);
    expect(matrix.cells[1].best).toBeNull();
    expect(matrix.maxDuration).toBe(0);
  });
});

describe('printConditionMatrix', () => {
  const twoByTwo = () => buildConditionMatrix(gridEntries(
    ['none', 'slow-3g'], [1, 4],
    (network, cpu) => ({ lauda: cpu, hunt: cpu * (network === 'none' ? 2 : 0.5) }),
    network => (network === 'none' ? 'lauda' : 'hunt')
  ));

  it('renders headers, row labels and every racer time', () => {
    const out = render(twoByTwo());

    expect(out).toContain('Performance Matrix');
    expect(out).toContain('Network');
    expect(out).toContain('CPU 1x');
    expect(out).toContain('CPU 4x');
    expect(out).toMatch(/^ {2}none/m);
    expect(out).toContain('1.000s');
    expect(out).toContain('4.000s');
  });

  it('aligns every cell in a column to the same width', () => {
    const lines = render(twoByTwo()).split('\n').filter(line => line.includes('lauda'));
    const columnStarts = lines.map(line => line.indexOf('hunt') >= 0 ? -1 : line.indexOf('lauda'));
    // Every racer line starts at the same offset regardless of row label length.
    expect(new Set(columnStarts.filter(i => i >= 0)).size).toBe(1);
  });

  it('crowns the winner and marks ties', () => {
    const out = render(buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda') },
      { label: 'b', network: 'none', cpu: 4, summary: summaryOf({ lauda: 2, hunt: 2 }, 'tie') },
    ]));

    expect(out).toContain('🏆');
    expect(out).toContain('🤝');
    expect(out).toContain('Conditions won: lauda 1 · 1 tie');
  });

  it('stacks conditions instead of wrapping when the grid is too wide', () => {
    const out = render(twoByTwo(), 20);

    expect(out).toContain('Network: none · CPU: 1x');
    expect(out).toContain('Network: slow-3g · CPU: 4x');
    // The stacked layout has no column header row.
    expect(out).not.toMatch(/^ {2}Network {2}/m);
  });

  it('shows a placeholder for a racer with no data', () => {
    const out = render(buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: summaryOf({ lauda: 1, hunt: null }, 'lauda') },
    ]));

    expect(out).toMatch(/hunt\s+-/);
  });

  it('prints nothing for an empty matrix', () => {
    expect(render(buildConditionMatrix([]))).toBe('');
  });
});

describe('buildConditionIndexHtml matrix', () => {
  it('renders a network x CPU table linking every cell to its results', () => {
    const html = buildConditionIndexHtml('lauda vs hunt', gridEntries(
      ['none', 'slow-3g'], [1, 4],
      () => ({ lauda: 1, hunt: 2 }),
      () => 'lauda'
    ));

    expect(html).toContain('<th scope="col">Network</th>');
    expect(html).toContain('<th scope="col">CPU 1x</th>');
    expect(html).toContain('<th scope="row">none</th>');
    expect(html).toContain('href="none-cpu1x/index.html"');
    expect(html).toContain('href="slow-3g-cpu4x/index.html"');
    expect(html).toContain('🏆 lauda');
    expect(html).toContain('Conditions won: lauda 4');
  });

  it('scales the bars against the slowest time in the whole matrix', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'fast', network: 'none', cpu: 1, summary: summaryOf({ a: 5, b: 10 }, 'a') },
      { label: 'slow', network: 'none', cpu: 4, summary: summaryOf({ a: 10, b: 20 }, 'a') },
    ]);

    expect(html).toContain('width:25.0%');   // 5s of a 20s worst case
    expect(html).toContain('width:100.0%');  // the 20s worst case itself
  });

  it('escapes racer and condition names', () => {
    const html = buildConditionIndexHtml('<script>', [
      { label: 'a&b', title: '<b>net</b>', summary: summaryOf({ '<img>': 1 }, '<img>') },
    ]);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img>');
    expect(html).toContain('&lt;b&gt;net&lt;/b&gt;');
    expect(html).toContain(`href="${encodeURIComponent('a&b')}/index.html"`);
  });

  it('omits the tally when no condition produced a winner', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'x', summary: summaryOf({ a: 1, b: 1 }, null) },
    ]);

    expect(html).not.toContain('Conditions won');
  });
});
