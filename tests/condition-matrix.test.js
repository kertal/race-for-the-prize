import { describe, it, expect } from 'vitest';
import { buildConditionMatrix, printConditionMatrix, buildConditionIndexHtml, TOTAL_TIME_METRIC } from '../cli/condition-matrix.js';

const DURATION = TOTAL_TIME_METRIC.key;

/** A condition summary with one total row per racer. `durations` maps racer -> seconds (null = no data). */
const summaryOf = (durations, overallWinner, profileMetrics) => {
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
    ...(profileMetrics ? { profileMetrics } : {}),
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

/** The metric series of a cell (total time unless another metric is named). */
const seriesOf = (cell, metric = DURATION) => cell.metrics[metric];

/** Capture printConditionMatrix output as one plain string (ANSI codes stripped). */
const render = (matrix, options = {}) => {
  let out = '';
  printConditionMatrix(matrix, { write: s => { out += s; }, width: 200, ...options });
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u001b\[[0-9;]*m/g, '');
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

  it('falls back to one row per condition when coordinates repeat', () => {
    // Four conditions over 2 networks x 2 CPUs matches a full grid by count,
    // but two share a coordinate — so two pairs are missing. Laid out as a
    // grid, the duplicates would be rendered once and the conditions they
    // displaced would vanish behind empty cells.
    const matrix = buildConditionMatrix([
      { label: 'none-cpu1x', network: 'none', cpu: 1, summary: summaryOf({ a: 1 }, 'a') },
      { label: 'none-cpu1x-again', network: 'none', cpu: 1, summary: summaryOf({ a: 2 }, 'a') },
      { label: '4g-cpu4x', network: '4g', cpu: 4, summary: summaryOf({ a: 3 }, 'a') },
      { label: '4g-cpu4x-again', network: '4g', cpu: 4, summary: summaryOf({ a: 4 }, 'a') },
    ]);

    expect(matrix.rowHeader).toBe('Condition');
    expect(matrix.rows).toHaveLength(4);
    expect(matrix.rows.every(row => row.cells[0] !== null)).toBe(true);
  });

  it('ranks each cell fastest first and flags the winner', () => {
    const [cell] = buildConditionMatrix([
      { label: '4g', network: '4g', cpu: 1, summary: summaryOf({ lauda: 2.5, hunt: 1.5 }, 'hunt') },
    ]).cells;

    expect(seriesOf(cell).racers.map(r => r.name)).toEqual(['hunt', 'lauda']);
    expect(seriesOf(cell).racers[0]).toMatchObject({ isWinner: true, formatted: '1.500s', delta: null });
    expect(seriesOf(cell).racers[1]).toMatchObject({ isWinner: false, formatted: '2.500s', delta: '1.000s' });
    expect(seriesOf(cell).best).toBe(1.5);
  });

  it('marks a tie without crowning a winner', () => {
    const [cell] = buildConditionMatrix([
      { label: '4g', network: '4g', cpu: 1, summary: summaryOf({ lauda: 2, hunt: 2 }, 'tie') },
    ]).cells;

    expect(seriesOf(cell).isTie).toBe(true);
    expect(seriesOf(cell).winner).toBeNull();
    expect(seriesOf(cell).racers.some(r => r.isWinner)).toBe(false);
  });

  it('sums nothing for a racer with no data in a condition', () => {
    const [cell] = buildConditionMatrix([
      { label: '4g', network: '4g', cpu: 1, summary: summaryOf({ lauda: 2, hunt: null }, 'lauda') },
    ]).cells;

    // Missing values sort last and carry no formatted time.
    expect(seriesOf(cell).racers.map(r => r.name)).toEqual(['lauda', 'hunt']);
    expect(seriesOf(cell).racers[1].formatted).toBeNull();
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

    expect(seriesOf(cell).racers.map(r => r.value)).toEqual([4, 9]);
  });

  it('matches racers by name when a condition lists them in a different order', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda') },
      // Same two racers, opposite order — the durations must not swap cells.
      { label: 'b', network: 'none', cpu: 4, summary: summaryOf({ hunt: 8, lauda: 4 }, 'lauda') },
    ]);

    const values = Object.fromEntries(seriesOf(matrix.cells[1]).racers.map(r => [r.name, r.value]));
    expect(values).toEqual({ lauda: 4, hunt: 8 });
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

    expect(seriesOf(cell).racers[0].value).toBe(1.25);
  });

  it('tallies condition wins and ties, and the slowest time for bar scaling', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda') },
      { label: 'b', network: 'none', cpu: 4, summary: summaryOf({ lauda: 8, hunt: 4 }, 'hunt') },
      { label: 'c', network: '4g', cpu: 1, summary: summaryOf({ lauda: 3, hunt: 3 }, 'tie') },
      { label: 'd', network: '4g', cpu: 4, summary: summaryOf({ lauda: 5, hunt: 6 }, 'lauda') },
    ]);

    expect(matrix.aggregates[DURATION].wins).toEqual({ lauda: 2, hunt: 1 });
    expect(matrix.aggregates[DURATION].ties).toBe(1);
    expect(matrix.aggregates[DURATION].max).toBe(8);
  });

  it('survives a condition that recorded no measurements', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: null },
      { label: 'b', network: '4g', cpu: 1, summary: { racers: ['lauda'], overallWinner: null, comparisons: [] } },
    ]);

    expect(seriesOf(matrix.cells[0]).racers.every(r => r.value === null)).toBe(true);
    expect(seriesOf(matrix.cells[1]).best).toBeNull();
    expect(matrix.aggregates[DURATION].max).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Profile metrics
// ---------------------------------------------------------------------------

/** Per-racer CDP profile data: { racer: { scope: { metric: value } } } in racer order. */
const profilesOf = (...perRacer) => perRacer;

describe('buildConditionMatrix profile metrics', () => {
  const withProfiles = () => buildConditionMatrix([
    {
      label: 'none',
      network: 'none',
      cpu: 1,
      summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda', profilesOf(
        { measured: { networkTransferSize: 1000 }, total: { lcp: 900 } },
        { measured: { networkTransferSize: 5000 }, total: { lcp: 1800 } },
      )),
    },
    {
      label: 'slow-3g',
      network: 'slow-3g',
      cpu: 1,
      summary: summaryOf({ lauda: 2, hunt: 9 }, 'lauda', profilesOf(
        { measured: { networkTransferSize: 1000 }, total: { lcp: 2400 } },
        { measured: { networkTransferSize: 5000 }, total: { lcp: 9000 } },
      )),
    },
  ]);

  it('offers total time first, then every captured profile metric', () => {
    const matrix = withProfiles();

    expect(matrix.metrics[0].key).toBe(DURATION);
    expect(matrix.metrics.map(m => m.key)).toContain('measured.networkTransferSize');
    expect(matrix.metrics.map(m => m.key)).toContain('total.lcp');
  });

  it('omits metrics no condition captured', () => {
    const keys = withProfiles().metrics.map(m => m.key);

    expect(keys).not.toContain('total.cls');
    expect(keys).not.toContain('measured.scriptDuration');
  });

  it('offers only total time when no profile data was captured', () => {
    const matrix = buildConditionMatrix([
      { label: 'a', network: 'none', cpu: 1, summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda') },
    ]);

    expect(matrix.metrics).toHaveLength(1);
    expect(matrix.metrics[0].key).toBe(DURATION);
  });

  it('ranks and formats each metric in its own units', () => {
    const [cell] = withProfiles().cells;
    const bytes = seriesOf(cell, 'measured.networkTransferSize');

    expect(bytes.racers.map(r => r.name)).toEqual(['lauda', 'hunt']);
    expect(bytes.racers[0].formatted).toBe('1000.0 B');
    expect(bytes.racers[1].formatted).toBe('4.9 KB');
    expect(seriesOf(cell, 'total.lcp').racers[0].formatted).toBe('900.0ms');
  });

  it('scales each metric against its own worst value', () => {
    const matrix = withProfiles();

    expect(matrix.aggregates['total.lcp'].max).toBe(9000);
    expect(matrix.aggregates['measured.networkTransferSize'].max).toBe(5000);
    expect(matrix.aggregates[DURATION].max).toBe(9);
  });

  it('tallies wins per metric independently', () => {
    const matrix = buildConditionMatrix([
      {
        label: 'a',
        network: 'none',
        cpu: 1,
        // lauda is faster overall, but ships more bytes.
        summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda', profilesOf(
          { measured: { networkTransferSize: 9000 } },
          { measured: { networkTransferSize: 1000 } },
        )),
      },
    ]);

    expect(matrix.aggregates[DURATION].wins).toEqual({ lauda: 1, hunt: 0 });
    expect(matrix.aggregates['measured.networkTransferSize'].wins).toEqual({ lauda: 0, hunt: 1 });
  });

  it('treats a difference below the metric significance threshold as a tie', () => {
    // LCP is a 'loading' metric: under 2.5% apart is noise, not a win.
    const matrix = buildConditionMatrix([
      {
        label: 'a',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda', profilesOf(
          { total: { lcp: 1000 } },
          { total: { lcp: 1010 } },
        )),
      },
    ]);
    const lcp = seriesOf(matrix.cells[0], 'total.lcp');

    expect(lcp.winner).toBeNull();
    expect(lcp.isTie).toBe(true);
    expect(matrix.aggregates['total.lcp'].ties).toBe(1);
  });

  it('crowns a winner once the difference clears the threshold', () => {
    const matrix = buildConditionMatrix([
      {
        label: 'a',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda', profilesOf(
          { total: { lcp: 1000 } },
          { total: { lcp: 1500 } },
        )),
      },
    ]);

    expect(seriesOf(matrix.cells[0], 'total.lcp').winner).toBe('lauda');
  });

  it('does not call a single measured racer a tie', () => {
    const matrix = buildConditionMatrix([
      {
        label: 'a',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda', profilesOf(
          { total: { lcp: 1000 } },
          { total: {} },
        )),
      },
    ]);
    const lcp = seriesOf(matrix.cells[0], 'total.lcp');

    expect(lcp.winner).toBeNull();
    expect(lcp.isTie).toBe(false);
  });

  it('accepts a custom metric definition set', () => {
    const matrix = buildConditionMatrix([
      {
        label: 'a',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ lauda: 1 }, 'lauda', profilesOf({ total: { widgets: 3 } })),
      },
    ], { 'total.widgets': { name: 'Widgets', scope: 'total', category: 'network', format: v => `${v}w` } });

    expect(matrix.metrics.map(m => m.key)).toEqual([DURATION, 'total.widgets']);
    expect(seriesOf(matrix.cells[0], 'total.widgets').racers[0].formatted).toBe('3w');
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
    const out = render(twoByTwo(), { width: 20 });

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

  it('can print a profile metric instead of total time', () => {
    const matrix = buildConditionMatrix([
      {
        label: 'a',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ lauda: 1, hunt: 2 }, 'lauda', profilesOf(
          { measured: { networkTransferSize: 9000 } },
          { measured: { networkTransferSize: 1000 } },
        )),
      },
    ]);
    const out = render(matrix, { metric: 'measured.networkTransferSize' });

    expect(out).toContain('8.8 KB');
    expect(out).toContain('1000.0 B');
    expect(out).not.toContain('1.000s');
    // hunt ships fewer bytes, so it wins this metric even though lauda won the race.
    expect(out).toContain('Conditions won: hunt 1');
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
    const html = buildConditionIndexHtml('<script>alert(1)</script>', [
      { label: 'a&b', title: '<b>net</b>', summary: summaryOf({ '<img>': 1 }, '<img>') },
    ]);

    // The payload survives as inert text; what matters is that it never
    // reaches the page as markup.
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img>');
    expect(html).toContain('&lt;b&gt;net&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain(`href="${encodeURIComponent('a&b')}/index.html"`);
    // Only the page's own runtime block is a real script element.
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it('omits the tally when no condition produced a winner', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'x', summary: summaryOf({ a: 1, b: 1 }, null) },
    ]);

    expect(html).not.toContain('Conditions won');
  });

  it('offers a metric picker grouped by scope', () => {
    const html = buildConditionIndexHtml('a vs b', [
      {
        label: 'x',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ a: 1, b: 2 }, 'a', profilesOf(
          { measured: { networkTransferSize: 10 }, total: { lcp: 100 } },
          { measured: { networkTransferSize: 20 }, total: { lcp: 200 } },
        )),
      },
    ]);

    expect(html).toContain('<select id="metric">');
    expect(html).toContain('<option value="duration">Total Time</option>');
    expect(html).toContain('<option value="measured.networkTransferSize">Network Transfer</option>');
    expect(html).toContain('<optgroup label="Race (Measured Section)">');
    expect(html).toContain('<optgroup label="Total Recording">');
  });

  it('renders every metric up front and shows only the first', () => {
    const html = buildConditionIndexHtml('a vs b', [
      {
        label: 'x',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ a: 1, b: 2 }, 'a', profilesOf(
          { total: { lcp: 100 } },
          { total: { lcp: 200 } },
        )),
      },
    ]);

    // Total time is visible; the LCP block is present but hidden until picked.
    expect(html).toContain('<span class="m" data-metric="duration">');
    expect(html).toContain('<span class="m" data-metric="total.lcp" hidden>');
    expect(html).toContain('100.0ms');
  });

  it('scales each metric independently in the rendered bars', () => {
    const html = buildConditionIndexHtml('a vs b', [
      {
        label: 'x',
        network: 'none',
        cpu: 1,
        summary: summaryOf({ a: 1, b: 4 }, 'a', profilesOf(
          { total: { lcp: 500 } },
          { total: { lcp: 1000 } },
        )),
      },
    ]);

    // Total time: 1s of 4s = 25%. LCP: 500ms of 1000ms = 50%.
    expect(html).toContain('width:25.0%');
    expect(html).toContain('width:50.0%');
  });

  it('still renders the picker when only total time is available', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'x', network: 'none', cpu: 1, summary: summaryOf({ a: 1, b: 2 }, 'a') },
    ]);

    expect(html).toContain('<select id="metric">');
    expect(html).toContain('<option value="duration">Total Time</option>');
    expect(html).not.toContain('data-metric="total.lcp"');
  });
  it('gives every racer the color the per-condition player uses for them', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'x', network: 'none', cpu: 1, summary: summaryOf({ a: 1, b: 2 }, 'a') },
    ]);

    // RACER_CSS_COLORS in racer order: a is red, b is blue.
    expect(html).toContain('style="--c:#e74c3c"');
    expect(html).toContain('style="--c:#3498db"');
    // The verdict picks up the winner's own color, not a generic accent.
    expect(html).toContain('<span class="verdict" style="color:#e74c3c">🏆 a</span>');
  });

  it('dresses the page like the player it links to', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'x', network: 'none', cpu: 1, summary: summaryOf({ a: 1, b: 2 }, 'a') },
    ]);

    expect(html).toContain('<div class="checkered-bar"></div>');
    expect(html).toContain('#d4af37');
    expect(html).toContain("font-family: ui-monospace, 'Courier New', monospace");
  });
});
