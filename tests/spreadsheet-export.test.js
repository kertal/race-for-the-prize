import { describe, it, expect } from 'vitest';
import {
  buildSpreadsheetModel,
  buildConditionSpreadsheetModel,
  buildSpreadsheetPanelHtml,
  SPREADSHEET_CSS,
  SPREADSHEET_RUNTIME,
} from '../cli/spreadsheet-export.js';
import { buildConditionMatrix, TOTAL_TIME_METRIC } from '../cli/condition-matrix.js';
import { PROFILE_METRICS } from '../cli/profile-analysis.js';

const racers = ['lauda', 'hunt'];

const comparisons = [
  { name: 'Load', racers: [{ duration: 1.0 }, { duration: 3.0 }], winner: 'lauda', rankings: racers },
  { name: 'Render', racers: [{ duration: 0.5 }, { duration: 0.7 }], winner: 'lauda', rankings: racers },
  { name: 'Race', isSyntheticTotal: true, racers: [{ duration: 1.5 }, { duration: 3.7 }], winner: 'lauda', rankings: racers },
];

const profileMetrics = [
  { measured: { scriptDuration: 100, networkTransferSize: 12345 }, total: { lcp: 900, cls: 0.01 } },
  { measured: { scriptDuration: 200, networkTransferSize: 23456 }, total: { lcp: 1800 } },
];

const summary = (overrides = {}) => ({ racers, comparisons, errors: [], ...overrides });

const groupById = (model, id) => model.groups.find(g => g.id === id);

describe('buildSpreadsheetModel', () => {
  it('names the columns: section, measurement, unit, then one per racer', () => {
    const model = buildSpreadsheetModel(summary());
    expect(model.headers).toEqual(['Section', 'Measurement', 'Unit']);
    expect(model.racers).toEqual(racers);
    // The name behind its colour dot, in RACER_CSS_COLORS order.
    expect(model.racerLabels).toEqual(['🔴 lauda', '🔵 hunt']);
  });

  it('lists every measurement in display order, total first, as seconds', () => {
    const results = groupById(buildSpreadsheetModel(summary()), 'results');
    expect(results.title).toBe('Race Results');
    expect(results.rows.map(r => r.cells[0])).toEqual(['Race', 'Load', 'Render']);
    expect(results.rows.every(r => r.unit === 's')).toBe(true);
    expect(results.rows[1].values).toEqual([1, 3]);
  });

  it('says so when the results are a median', () => {
    const results = groupById(buildSpreadsheetModel(summary({ runs: 3 })), 'results');
    expect(results.title).toBe('Race Results (median of 3 runs)');
  });

  it('leaves a missing duration empty rather than zero', () => {
    const model = buildSpreadsheetModel(summary({
      comparisons: [{ name: 'Load', racers: [{ duration: 1 }, null], winner: null, rankings: ['lauda'] }],
    }));
    expect(groupById(model, 'results').rows[0].values).toEqual([1, null]);
  });

  it('rounds away floating-point noise so a cell never reads 1.2000000000000002', () => {
    const model = buildSpreadsheetModel(summary({
      comparisons: [{ name: 'Load', racers: [{ duration: 0.1 + 0.2 }, { duration: 1.23456789 }], winner: null, rankings: racers }],
    }));
    expect(groupById(model, 'results').rows[0].values).toEqual([0.3, 1.234568]);
  });

  it('exports the profile metrics per scope as raw values with their unit', () => {
    const model = buildSpreadsheetModel(summary({ profileMetrics }));
    const measured = groupById(model, 'profile.measured');
    expect(measured.title).toBe('Performance: Race');
    // Bytes stay bytes — "12.1 KB" is a label, 12345 is a value.
    expect(measured.rows).toEqual([
      { cells: ['Network Transfer'], unit: 'bytes', values: [12345, 23456] },
      { cells: ['Script Execution'], unit: 'ms', values: [100, 200] },
    ]);
    const total = groupById(model, 'profile.total');
    expect(total.title).toBe('Performance: Total Recording');
    expect(total.rows.map(r => r.cells[0])).toEqual(['Largest Contentful Paint (LCP)', 'Cumulative Layout Shift (CLS)']);
    // A metric only one racer captured keeps the row, with the other cell empty.
    expect(total.rows[1]).toEqual({ cells: ['Cumulative Layout Shift (CLS)'], unit: 'score', values: [0.01, null] });
  });

  it('skips profile groups and metrics nobody captured', () => {
    const model = buildSpreadsheetModel(summary({ profileMetrics: [{ measured: { scriptDuration: 1 }, total: {} }, { measured: {}, total: {} }] }));
    expect(model.groups.map(g => g.id)).toEqual(['results', 'profile.measured']);
    expect(groupById(model, 'profile.measured').rows).toHaveLength(1);
  });

  it('adds per-section profile metrics only when there is more than one section', () => {
    const withSections = (sections) => summary({
      profileMetrics: [
        { measured: {}, total: {}, measuredSections: Object.fromEntries(sections.map(s => [s, { scriptDuration: 10 }])) },
        { measured: {}, total: {}, measuredSections: Object.fromEntries(sections.map(s => [s, { scriptDuration: 20 }])) },
      ],
    });
    // One section repeats the Race scope exactly, so it is left out — as the player does.
    expect(buildSpreadsheetModel(withSections(['Load'])).groups.map(g => g.id)).toEqual(['results']);

    const model = buildSpreadsheetModel(withSections(['Load', 'Render']));
    expect(model.groups.map(g => g.id)).toEqual(['results', 'profile.section:Load', 'profile.section:Render']);
    expect(groupById(model, 'profile.section:Load')).toEqual({
      id: 'profile.section:Load',
      title: 'Performance: Section Load',
      rows: [{ cells: ['Script Execution'], unit: 'ms', values: [10, 20] }],
    });
  });

  it('has nothing to export for a race that measured nothing', () => {
    expect(buildSpreadsheetModel(summary({ comparisons: [] })).groups).toEqual([]);
  });

  describe('multi-run races', () => {
    const runSummaries = [
      { racers, comparisons: [{ name: 'Load', racers: [{ duration: 1.0 }, { duration: 3.0 }], winner: 'lauda' }], profileMetrics: [{ measured: { scriptDuration: 100 }, total: {} }, { measured: { scriptDuration: 200 }, total: {} }] },
      { racers, comparisons: [{ name: 'Load', racers: [{ duration: 2.0 }, { duration: 4.0 }], winner: 'lauda' }], profileMetrics: [{ measured: { scriptDuration: 120 }, total: {} }, { measured: { scriptDuration: 180 }, total: {} }] },
    ];
    const median = summary({
      runs: 2,
      comparisons: [{ name: 'Load', racers: [{ duration: 1.5 }, { duration: 3.5 }], winner: 'lauda' }],
      profileMetrics: [{ measured: { scriptDuration: 110 }, total: {} }, { measured: { scriptDuration: 190 }, total: {} }],
    });

    it('adds one run-by-run table per measurement: every run, then median and average', () => {
      const model = buildSpreadsheetModel(median, { runSummaries });
      const load = groupById(model, 'runs:section:Load');
      expect(load.title).toBe('Run-by-Run: Load');
      expect(load.rows).toEqual([
        { cells: ['Run 1'], unit: 's', values: [1, 3] },
        { cells: ['Run 2'], unit: 's', values: [2, 4] },
        { cells: ['Median'], unit: 's', values: [1.5, 3.5] },
        { cells: ['Average'], unit: 's', values: [1.5, 3.5] },
      ]);
    });

    it('adds one run-by-run table per profile metric, named with its scope and in its unit', () => {
      const model = buildSpreadsheetModel(median, { runSummaries });
      const script = groupById(model, 'runs:profile:measured.scriptDuration');
      expect(script.title).toBe('Run-by-Run: Script Execution (Race)');
      expect(script.rows.map(r => r.cells[0])).toEqual(['Run 1', 'Run 2', 'Median', 'Average']);
      expect(script.rows.every(r => r.unit === 'ms')).toBe(true);
      expect(script.rows[0].values).toEqual([100, 200]);
      expect(script.rows[3].values).toEqual([110, 190]);
    });

    it('keeps a section named like a profile metric key on its own checkbox', () => {
      // Selection is tracked by id; a shared id would tick both tables at once.
      const collide = name => ({ name, racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda' });
      const runs = runSummaries.map(s => ({ ...s, comparisons: [collide('measured.scriptDuration')] }));
      const med = { ...median, comparisons: [collide('measured.scriptDuration')] };
      const ids = buildSpreadsheetModel(med, { runSummaries: runs }).groups.map(g => g.id);
      expect(ids).toContain('runs:section:measured.scriptDuration');
      expect(ids).toContain('runs:profile:measured.scriptDuration');
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('works the per-section profile tables out from the runs, since the median summary drops them', () => {
      const sections = (load, render) => ({ Load: { scriptDuration: load }, Render: { scriptDuration: render } });
      const runs = [[10, 30], [20, 40], [15, 35]].map(([load, render]) => ({
        racers,
        comparisons: [],
        profileMetrics: [
          { measured: {}, total: {}, measuredSections: sections(load, render) },
          { measured: {}, total: {}, measuredSections: sections(load * 2, render * 2) },
        ],
      }));
      // buildMedianProfileMetrics keeps only the measured and total scopes.
      const med = summary({ runs: 3, comparisons: [], profileMetrics: [{ measured: {}, total: {} }, { measured: {}, total: {} }] });
      const model = buildSpreadsheetModel(med, { runSummaries: runs });
      expect(groupById(model, 'profile.section:Load')).toEqual({
        id: 'profile.section:Load',
        title: 'Performance: Section Load (median of 3 runs)',
        rows: [{ cells: ['Script Execution'], unit: 'ms', values: [15, 30] }],
      });
      expect(groupById(model, 'profile.section:Render').rows[0].values).toEqual([35, 70]);
      // A metric only some runs captured takes the median of those; one no run captured is left out.
      runs[1].profileMetrics[0].measuredSections.Load.layoutDuration = 4;
      expect(groupById(buildSpreadsheetModel(med, { runSummaries: runs }), 'profile.section:Load').rows).toEqual([
        { cells: ['Script Execution'], unit: 'ms', values: [15, 30] },
        { cells: ['Layout Time'], unit: 'ms', values: [4, null] },
      ]);
    });

    it('keeps a section whose name is also an Object property', () => {
      // A spec may call its sections anything; "constructor" must be stored as
      // a key of its own, not resolve to the one every plain object inherits.
      const runs = [10, 20].map(v => ({
        racers,
        comparisons: [],
        profileMetrics: [
          { measured: {}, total: {}, measuredSections: { constructor: { scriptDuration: v }, Load: { scriptDuration: v + 1 } } },
          { measured: {}, total: {}, measuredSections: { constructor: { scriptDuration: v * 3 }, Load: { scriptDuration: v + 2 } } },
        ],
      }));
      const med = summary({ runs: 2, comparisons: [], profileMetrics: [{ measured: {}, total: {} }, { measured: {}, total: {} }] });
      const model = buildSpreadsheetModel(med, { runSummaries: runs });
      expect(model.groups.map(g => g.id)).toEqual(['profile.section:constructor', 'profile.section:Load']);
      expect(groupById(model, 'profile.section:constructor').rows).toEqual([{ cells: ['Script Execution'], unit: 'ms', values: [15, 45] }]);
      expect(groupById(model, 'profile.section:Load').rows).toEqual([{ cells: ['Script Execution'], unit: 'ms', values: [16, 17] }]);
    });

    it('adds no run-by-run tables for a single run', () => {
      const ids = buildSpreadsheetModel(median, { runSummaries: [runSummaries[0]] }).groups.map(g => g.id);
      expect(ids.some(id => id.startsWith('runs:'))).toBe(false);
    });
  });
});

describe('buildConditionSpreadsheetModel', () => {
  const summaryOf = (durations, profile) => ({
    racers,
    overallWinner: 'lauda',
    comparisons: [{ name: 'Race', isSyntheticTotal: true, winner: 'lauda', racers: durations.map(d => (d == null ? null : { duration: d })) }],
    ...(profile ? { profileMetrics: profile } : {}),
  });
  const matrix = buildConditionMatrix([
    { label: 'none-cpu1x', title: 'Network: none · CPU: 1x', network: 'none', cpu: 1, summary: summaryOf([1, 2], [{ total: { lcp: 900 } }, { total: { lcp: 1000 } }]) },
    { label: 'none-cpu4x', title: 'Network: none · CPU: 4x', network: 'none', cpu: 4, summary: summaryOf([4, null]) },
  ]);

  it('names the columns: metric, condition, network, cpu, unit, then one per racer', () => {
    const model = buildConditionSpreadsheetModel(matrix);
    expect(model.headers).toEqual(['Metric', 'Condition', 'Network', 'CPU', 'Unit']);
    expect(model.racers).toEqual(racers);
    expect(model.racerLabels).toEqual(['🔴 lauda', '🔵 hunt']);
  });

  it('makes one group per metric with one row per condition, values back in racer order', () => {
    const model = buildConditionSpreadsheetModel(matrix);
    expect(model.groups.map(g => g.id)).toEqual([TOTAL_TIME_METRIC.key, 'total.lcp']);
    const time = model.groups[0];
    expect(time.title).toBe('Total Time');
    expect(time.rows).toEqual([
      { cells: ['Network: none · CPU: 1x', 'none', 1], unit: 's', values: [1, 2] },
      { cells: ['Network: none · CPU: 4x', 'none', 4], unit: 's', values: [4, null] },
    ]);
    // The series ranks hunt's 1000ms after lauda's 900ms either way; a condition
    // that captured no LCP still gets its row, empty.
    expect(model.groups[1].rows.map(r => r.values)).toEqual([[900, 1000], [null, null]]);
    expect(model.groups[1].rows[0].unit).toBe('ms');
  });

  it('leaves network and CPU blank for a condition without coordinates', () => {
    const model = buildConditionSpreadsheetModel(buildConditionMatrix([
      { label: 'a', title: 'Condition A', summary: summaryOf([1, 2]) },
    ]));
    expect(model.groups[0].rows[0].cells).toEqual(['Condition A', '', '']);
  });
});

describe('buildSpreadsheetPanelHtml', () => {
  const model = buildSpreadsheetModel(summary({ profileMetrics }));
  const html = buildSpreadsheetPanelHtml(model);

  it('renders one ticked checkbox per group', () => {
    expect(html).toContain('<input type="checkbox" value="results" checked> Race Results');
    expect(html).toContain('<input type="checkbox" value="profile.measured" checked> Performance: Race');
    expect(html.match(/class="spreadsheet-group"/g)).toHaveLength(model.groups.length);
  });

  it('renders every row up front, tagged with its group, so the page works without JavaScript', () => {
    expect(html).toContain('<tr data-group="results"><td class="spreadsheet-pick"><input type="checkbox" data-row="row:results#0" checked aria-label="Include Race Results: Race"></td><td>Race Results</td><td>Race</td><td>s</td><td class="spreadsheet-num" data-value="1.5">1.5</td><td class="spreadsheet-num" data-value="3.7">3.7</td><td>🔴 lauda</td><td class="spreadsheet-num" data-value="2.2">2.2</td><td class="spreadsheet-num" data-value="59.5">59.5</td></tr>');
    const rowCount = model.groups.reduce((n, g) => n + g.rows.length, 0);
    expect(html.match(/<tr data-group=/g)).toHaveLength(rowCount);
    // One include checkbox per row, keyed to its model row, under a header only screen readers see.
    expect(html.match(/<input type="checkbox" data-row=/g)).toHaveLength(rowCount);
    expect(html).toContain('<th scope="col" class="spreadsheet-pick"><span class="sr-only">Include</span></th>');
    expect(html).toContain('data-row="row:profile.total#1" checked aria-label="Include Performance: Total Recording: Cumulative Layout Shift (CLS)"');
    // A missing value is an empty cell, not a dash.
    expect(html).toContain('<td>score</td><td class="spreadsheet-num" data-value="0.01">0.01</td><td class="spreadsheet-num"></td>');
  });

  it('heads the racer columns with the racer colour token and dot, then the verdict columns', () => {
    expect(html).toContain('<th scope="col">Section</th><th scope="col">Measurement</th><th scope="col">Unit</th>');
    expect(html).toContain('<th scope="col">Winner</th><th scope="col">Delta to 2nd</th><th scope="col">Delta %</th>');
    expect(html).toContain('<th scope="col" style="--racer-color:#e74c3c">🔴 lauda</th>');
    expect(html).toContain('<th scope="col" style="--racer-color:#3498db">🔵 hunt</th>');
  });

  it('embeds the model as JSON for the runtime, with < escaped', () => {
    const m = html.match(/<script id="spreadsheet-data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(JSON.parse(m[1])).toEqual(model);

    const nasty = buildSpreadsheetPanelHtml(buildSpreadsheetModel(summary({
      racers: ['<script>', 'b'],
      comparisons: [{ name: '</script><b>x</b>', racers: [{ duration: 1 }, { duration: 2 }], winner: null }],
    })));
    expect(nasty).not.toContain('</script><b>');
    expect(nasty).not.toContain('<script>');
    expect(nasty).toContain('&lt;script&gt;');
    expect(nasty).toContain('\\u003c/script>');
  });

  it('offers copy, Markdown copy, CSV download, all/none and the decimal-comma option', () => {
    expect(html).toContain('id="spreadsheetCopy"');
    expect(html).toContain('id="spreadsheetMarkdown"');
    expect(html).toContain('id="spreadsheetCsv"');
    expect(html).toContain('data-spreadsheet-select="all"');
    expect(html).toContain('data-spreadsheet-select="none"');
    expect(html).toContain('id="spreadsheetDecimalComma"');
    expect(html).toContain('<output class="spreadsheet-status" id="spreadsheetStatus" aria-live="polite">');
  });

  it('defuses formula-like labels in the preview, which is pasted by hand without JavaScript', () => {
    const hostile = buildSpreadsheetPanelHtml(buildSpreadsheetModel(summary({
      racers: ['=HYPERLINK("x")', 'hunt'],
      comparisons: [{ name: '-1+1', racers: [{ duration: 1 }, { duration: 2 }], winner: null }],
    })));
    // The same apostrophe the TSV and CSV carry, HTML-escaped on the way out.
    expect(hostile).toContain('<td>&#39;-1+1</td>');
    expect(hostile).not.toContain('<td>-1+1</td>');
    // A racer name only ever shows behind its colour dot, so it needs none.
    expect(hostile).toContain('<td>🔴 =HYPERLINK(&quot;x&quot;)</td>');
    // A plain label and the numbers are untouched.
    expect(hostile).toContain('<td>Race Results</td>');
    expect(hostile).toContain('data-value="1">1</td>');
  });

  it('takes a page-specific note', () => {
    expect(buildSpreadsheetPanelHtml(model, { note: 'Rows are <conditions>.' })).toContain('<p class="spreadsheet-note">Rows are &lt;conditions&gt;.</p>');
  });

  it('renders nothing when there is nothing to export', () => {
    expect(buildSpreadsheetPanelHtml({ headers: [], racers, groups: [] })).toBe('');
    expect(buildSpreadsheetPanelHtml(null)).toBe('');
  });
});

describe('shared assets', () => {
  it('every profile metric names the unit the export writes beside its raw value', () => {
    for (const [key, metric] of Object.entries(PROFILE_METRICS)) {
      expect(metric.unit, key).toMatch(/^(bytes|requests|ms|score|frames)$/);
    }
    expect(TOTAL_TIME_METRIC.unit).toBe('s');
  });

  it('ships the panel stylesheet and the browser runtime for the overview page to inline', () => {
    expect(SPREADSHEET_CSS).toContain('.spreadsheet-table');
    expect(SPREADSHEET_RUNTIME).toContain('function spreadsheetTsv');
    expect(SPREADSHEET_RUNTIME).toContain('function spreadsheetMarkdown');
    expect(SPREADSHEET_RUNTIME).toContain("getElementById('spreadsheetPanel')");
    // A literal </script> anywhere in it would end the inline block early.
    expect(SPREADSHEET_RUNTIME).not.toContain('</script');
  });
});
