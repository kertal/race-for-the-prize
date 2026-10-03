/**
 * Behavioral tests for the pure spreadsheet-export logic the report pages
 * carry (cli/player-runtime/spreadsheet.cjs): flattening the ticked groups of
 * an export model into one table — racer values plus the verdict columns —
 * and serializing it as TSV, CSV or a Markdown table.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  spreadsheetTable,
  spreadsheetRunGroupId,
  spreadsheetRowKey,
  rowVerdict,
  spreadsheetCell,
  spreadsheetTsv,
  spreadsheetCsv,
  spreadsheetMarkdown,
  titledMarkdownTables,
  exportSlug,
  spreadsheetFileName,
} = require('../cli/player-runtime/spreadsheet.cjs');

const model = {
  headers: ['Section', 'Measurement', 'Unit'],
  racers: ['lauda', 'hunt'],
  racerLabels: ['🔴 lauda', '🔵 hunt'],
  groups: [
    { id: 'results', title: 'Race Results', rows: [
      { cells: ['Race'], unit: 's', values: [1.5, 3.7] },
      { cells: ['Load'], unit: 's', values: [1, null] },
    ] },
    { id: 'profile.measured', title: 'Performance: Race', rows: [
      { cells: ['Network Transfer'], unit: 'bytes', values: [12345, 23456] },
    ] },
  ],
};

const HEADER = ['Section', 'Measurement', 'Unit', '🔴 lauda', '🔵 hunt', 'Winner', 'Delta to 2nd', 'Delta %'];
// 3.7 - 1.5 = 2.2s, which is 59.5% of the runner-up's 3.7s.
const RACE_ROW = ['Race Results', 'Race', 's', 1.5, 3.7, '🔴 lauda', 2.2, 59.5];
// One value: nobody to beat, so no verdict.
const LOAD_ROW = ['Race Results', 'Load', 's', 1, null, null, null, null];
const BYTES_ROW = ['Performance: Race', 'Network Transfer', 'bytes', 12345, 23456, '🔴 lauda', 11111, 47.4];

describe('rowVerdict', () => {
  const labels = ['🔴 a', '🔵 b', '🟢 c'];

  it('names the lowest value, its lead over the runner-up, and that lead as a share of the runner-up', () => {
    // b leads; c is the runner-up, not a: the gap is 2 - 1 = 1, which is 50% of c's 2.
    expect(rowVerdict([4, 1, 2], labels)).toEqual(['🔵 b', 1, 50]);
  });

  it('calls a shared lowest value a tie with no lead', () => {
    expect(rowVerdict([2, 2, 5], labels)).toEqual(['🤝 Tie', 0, 0]);
    expect(rowVerdict([0, 0], labels)).toEqual(['🤝 Tie', 0, 0]);
  });

  it('prefers the verdict the model carries, keeping the raw gap', () => {
    // The report called 900 vs 903 a tie (under the 5ms LCP noise floor); the
    // raw rule would have crowned a. The gap is still worth a column.
    expect(rowVerdict([900, 903], labels, { winner: null, tie: true })).toEqual(['🤝 Tie', 3, 0.3]);
    // A named winner is taken as given, even on equal values.
    expect(rowVerdict([2, 2], labels, { winner: 1, tie: false })).toEqual(['🔵 b', 0, 0]);
    // A verdict that names nobody over two values is a tie; one that names an
    // unknown racer falls back to the raw rule.
    expect(rowVerdict([4, 1, 2], labels, { winner: null, tie: false })).toEqual(['🤝 Tie', 1, 50]);
    expect(rowVerdict([4, 1, 2], labels, { winner: 9, tie: false })).toEqual(['🔵 b', 1, 50]);
  });

  it('has no verdict for fewer than two values', () => {
    expect(rowVerdict([2, null, null], labels)).toEqual([null, null, null]);
    expect(rowVerdict([null, null], labels)).toEqual([null, null, null]);
    expect(rowVerdict([], labels)).toEqual([null, null, null]);
  });

  it('rounds the lead to six decimals and the share to one, without float noise', () => {
    expect(rowVerdict([0.1, 0.3], labels)).toEqual(['🔴 a', 0.2, 66.7]);
    expect(rowVerdict([1, 3, 2.0000001], labels)).toEqual(['🔴 a', 1, 50]);
  });

  it('ignores anything that is not a finite number', () => {
    expect(rowVerdict([3, NaN, 1, 'x'], ['a', 'b', 'c', 'd'])).toEqual(['c', 2, 66.7]);
  });
});

describe('spreadsheetTable', () => {
  it('flattens every group into one table, each row ending with its verdict', () => {
    const table = spreadsheetTable(model);
    expect(table.header).toEqual(HEADER);
    expect(table.rows).toEqual([RACE_ROW, LOAD_ROW, BYTES_ROW]);
  });

  it('keeps only the selected groups, in model order', () => {
    expect(spreadsheetTable(model, ['profile.measured']).rows).toEqual([BYTES_ROW]);
    expect(spreadsheetTable(model, []).rows).toEqual([]);
  });

  it('uses a row\'s own verdict when the model carries one', () => {
    const tied = { ...model, groups: [{ id: 'g', title: 'G', rows: [{ cells: ['x'], unit: 'ms', values: [900, 903], winner: null, tie: true }] }] };
    expect(spreadsheetTable(tied).rows).toEqual([['G', 'x', 'ms', 900, 903, '🤝 Tie', 3, 0.3]]);
  });

  it('names run-by-run groups in separate namespaces for sections and profile metrics', () => {
    expect(spreadsheetRunGroupId('section', 'Load')).toBe('runs:section:Load');
    expect(spreadsheetRunGroupId('profile', 'measured.scriptDuration')).toBe('runs:profile:measured.scriptDuration');
    expect(spreadsheetRunGroupId('section', 'measured.scriptDuration')).not.toBe(spreadsheetRunGroupId('profile', 'measured.scriptDuration'));
  });

  it('keeps single rows by key, mixed with whole groups, in model order', () => {
    expect(spreadsheetRowKey('results', 1)).toBe('row:results#1');
    // The second results row alone, plus the whole profile group.
    expect(spreadsheetTable(model, ['row:results#1', 'profile.measured']).rows).toEqual([LOAD_ROW, BYTES_ROW]);
    // A key that names no row selects nothing.
    expect(spreadsheetTable(model, ['row:results#7', 'row:nope#0']).rows).toEqual([]);
  });

  it('never lets a row key collide with another group\'s id', () => {
    // A section called "x#0" has the group id runs:section:x#0 — which is what
    // the first row of a section called "x" would have been keyed as, had row
    // keys shared the namespace. Picking that row must not take the group.
    const x = spreadsheetRunGroupId('section', 'x');
    const clash = spreadsheetRunGroupId('section', 'x#0');
    const m = {
      headers: ['Section', 'Measurement', 'Unit'],
      racers: ['a'],
      groups: [
        { id: x, title: 'x', rows: [{ cells: ['Run 1'], unit: 's', values: [1] }, { cells: ['Run 2'], unit: 's', values: [2] }] },
        { id: clash, title: 'x#0', rows: [{ cells: ['Run 1'], unit: 's', values: [9] }] },
      ],
    };
    expect(spreadsheetRowKey(x, 0)).not.toBe(clash);
    expect(spreadsheetTable(m, [spreadsheetRowKey(x, 0)]).rows).toEqual([['x', 'Run 1', 's', 1, null, null, null]]);
    expect(spreadsheetTable(m, [clash]).rows).toEqual([['x#0', 'Run 1', 's', 9, null, null, null]]);
  });

  it('heads the racer columns with the bare names when a model carries no labels', () => {
    const { header, rows } = spreadsheetTable({ ...model, racerLabels: undefined });
    expect(header).toEqual(['Section', 'Measurement', 'Unit', 'lauda', 'hunt', 'Winner', 'Delta to 2nd', 'Delta %']);
    expect(rows[0][5]).toBe('lauda');
  });

  it('carries extra row cells (the overview has network and CPU columns)', () => {
    const table = spreadsheetTable({
      headers: ['Metric', 'Condition', 'Network', 'CPU', 'Unit'],
      racers: ['a'],
      groups: [{ id: 'duration', title: 'Total Time', rows: [{ cells: ['slow-3g · CPU 4x', 'slow-3g', 4], unit: 's', values: [2] }] }],
    });
    expect(table.header).toEqual(['Metric', 'Condition', 'Network', 'CPU', 'Unit', 'a', 'Winner', 'Delta to 2nd', 'Delta %']);
    expect(table.rows).toEqual([['Total Time', 'slow-3g · CPU 4x', 'slow-3g', 4, 's', 2, null, null, null]]);
  });
});

describe('spreadsheetCell', () => {
  it('writes numbers plainly and missing values as empty cells', () => {
    expect(spreadsheetCell(1.5)).toBe('1.5');
    expect(spreadsheetCell(12345)).toBe('12345');
    expect(spreadsheetCell(null)).toBe('');
    expect(spreadsheetCell(undefined)).toBe('');
    expect(spreadsheetCell(NaN)).toBe('');
    expect(spreadsheetCell('Load')).toBe('Load');
  });

  it('swaps the decimal mark on request, and only on numbers', () => {
    expect(spreadsheetCell(1.5, ',')).toBe('1,5');
    expect(spreadsheetCell(3, ',')).toBe('3');
    expect(spreadsheetCell('v1.2', ',')).toBe('v1.2');
  });

  it('defuses text a spreadsheet would run as a formula, and leaves numbers alone', () => {
    // Labels come from race files and spec code; a sheet must show them, not evaluate them.
    expect(spreadsheetCell('=CMD("calc")')).toBe("'=CMD(\"calc\")");
    expect(spreadsheetCell('+1+1')).toBe("'+1+1");
    expect(spreadsheetCell('-fast')).toBe("'-fast");
    expect(spreadsheetCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(spreadsheetCell('\t=1')).toBe("'\t=1");
    // A negative number is a value, not a formula.
    expect(spreadsheetCell(-2.5)).toBe('-2.5');
    expect(spreadsheetCell('Load')).toBe('Load');
    expect(spreadsheetCell('a=b')).toBe('a=b');
  });
});

describe('formula neutralization reaches both outputs', () => {
  const hostile = {
    headers: ['Section', 'Measurement', 'Unit'],
    racers: ['=HYPERLINK("http://x")', 'hunt'],
    groups: [{ id: 'results', title: 'Race Results', rows: [{ cells: ['-1+1'], unit: 's', values: [-1, 2] }] }],
  };

  it('in TSV, the winner column included', () => {
    const tsv = spreadsheetTsv(spreadsheetTable(hostile));
    expect(tsv).toBe(
      'Section\tMeasurement\tUnit\t\'=HYPERLINK("http://x")\thunt\tWinner\tDelta to 2nd\tDelta %\n'
      + 'Race Results\t\'-1+1\ts\t-1\t2\t\'=HYPERLINK("http://x")\t3\t150'
    );
  });

  it('in CSV, inside the quoting', () => {
    const csv = spreadsheetCsv(spreadsheetTable(hostile));
    expect(csv).toBe(
      'Section,Measurement,Unit,"\'=HYPERLINK(""http://x"")",hunt,Winner,Delta to 2nd,Delta %\r\n'
      + 'Race Results,\'-1+1,s,-1,2,"\'=HYPERLINK(""http://x"")",3,150\r\n'
    );
  });
});

describe('spreadsheetTsv', () => {
  it('joins cells with tabs and rows with newlines, header first', () => {
    expect(spreadsheetTsv(spreadsheetTable(model, ['results']))).toBe(
      'Section\tMeasurement\tUnit\t🔴 lauda\t🔵 hunt\tWinner\tDelta to 2nd\tDelta %\n'
      + 'Race Results\tRace\ts\t1.5\t3.7\t🔴 lauda\t2.2\t59.5\n'
      + 'Race Results\tLoad\ts\t1\t\t\t\t'
    );
  });

  it('never quotes; a tab or line break inside a label becomes a space', () => {
    const table = { header: ['a'], rows: [['x\ty'], ['line\nbreak'], ['say "hi"']] };
    expect(spreadsheetTsv(table)).toBe('a\nx y\nline break\nsay "hi"');
  });

  it('applies the decimal comma to every number, the verdict columns included', () => {
    const tsv = spreadsheetTsv(spreadsheetTable(model, ['results']), { decimal: ',' });
    expect(tsv).toContain('\t1,5\t3,7\t🔴 lauda\t2,2\t59,5');
    expect(tsv).toContain('\t1\t');
  });
});

describe('spreadsheetCsv', () => {
  it('uses commas and CRLF, with a trailing line break', () => {
    expect(spreadsheetCsv(spreadsheetTable(model, ['results']))).toBe(
      'Section,Measurement,Unit,🔴 lauda,🔵 hunt,Winner,Delta to 2nd,Delta %\r\n'
      + 'Race Results,Race,s,1.5,3.7,🔴 lauda,2.2,59.5\r\n'
      + 'Race Results,Load,s,1,,,,\r\n'
    );
  });

  it('quotes fields holding the delimiter, a quote or a line break, doubling embedded quotes', () => {
    const table = { header: ['label', 'n'], rows: [['a, b', 1], ['say "hi"', 2], ['two\nlines', 3], ['plain', 4]] };
    expect(spreadsheetCsv(table)).toBe(
      'label,n\r\n'
      + '"a, b",1\r\n'
      + '"say ""hi""",2\r\n'
      + '"two\nlines",3\r\n'
      + 'plain,4\r\n'
    );
  });

  it('switches to semicolons when the decimal mark is a comma', () => {
    const csv = spreadsheetCsv(spreadsheetTable(model, ['results']), { decimal: ',' });
    expect(csv.split('\r\n')[1]).toBe('Race Results;Race;s;1,5;3,7;🔴 lauda;2,2;59,5');
    // Now a label with a comma needs no quoting, but one with a semicolon does.
    expect(spreadsheetCsv({ header: ['a'], rows: [['x, y'], ['x; y']] }, { decimal: ',' })).toBe('a\r\nx, y\r\n"x; y"\r\n');
  });
});

describe('spreadsheetMarkdown', () => {
  it('writes a GitHub table with the numeric columns right-aligned', () => {
    expect(spreadsheetMarkdown(spreadsheetTable(model, ['results']))).toBe(
      '| Section | Measurement | Unit | 🔴 lauda | 🔵 hunt | Winner | Delta to 2nd | Delta % |\n'
      + '| --- | --- | --- | ---: | ---: | --- | ---: | ---: |\n'
      + '| Race Results | Race | s | 1.5 | 3.7 | 🔴 lauda | 2.2 | 59.5 |\n'
      + '| Race Results | Load | s | 1 |  |  |  |  |'
    );
  });

  it('right-aligns a column only when every value in it is a number', () => {
    // The overview's CPU column is numeric; a column with no values at all is not.
    const md = spreadsheetMarkdown({ header: ['a', 'cpu', 'empty'], rows: [['x', 1, null], ['y', 4, null]] });
    expect(md.split('\n')[1]).toBe('| --- | ---: | --- |');
  });

  it('escapes pipes and flattens line breaks, which would otherwise end the cell', () => {
    const md = spreadsheetMarkdown({ header: ['label', 'n'], rows: [['a | b', 1], ['two\nlines', 2]] });
    expect(md).toContain('| a \\| b | 1 |');
    expect(md).toContain('| two lines | 2 |');
  });

  it('escapes backslashes before pipes, so a label already holding \\| keeps its column', () => {
    // Unescaped, a\|b would become a\\|b, which GFM reads as a literal
    // backslash and then a column break.
    const md = spreadsheetMarkdown({ header: ['label'], rows: [['a\\|b'], ['c:\\dir']] });
    expect(md).toContain('| a\\\\\\|b |');
    expect(md).toContain('| c:\\\\dir |');
  });

  it('leaves formula-like labels as written, since nothing evaluates Markdown', () => {
    const md = spreadsheetMarkdown({ header: ['=x'], rows: [['-fast']] });
    expect(md).toBe('| =x |\n| --- |\n| -fast |');
  });

  it('honours the decimal comma', () => {
    const md = spreadsheetMarkdown(spreadsheetTable(model, ['results']), { decimal: ',' });
    expect(md).toContain('| 1,5 | 3,7 | 🔴 lauda | 2,2 | 59,5 |');
  });
});

describe('titledMarkdownTables', () => {
  const load = {
    title: 'Race Section Load',
    header: ['Run', '🔴 lauda', '🔵 hunt'],
    rows: [
      { cells: ['1', '1.000s (🏆 67% ahead)', '3.000s (+2.000s, +200%)'] },
      { cells: ['Median', '1.500s (🏆 57% ahead)', '-'], bold: true },
    ],
  };

  it('writes each table under its bold title, bolding the cells of a bold row', () => {
    expect(titledMarkdownTables([load])).toBe(
      '**Race Section Load**\n\n'
      + '| Run | 🔴 lauda | 🔵 hunt |\n'
      + '| --- | --- | --- |\n'
      + '| 1 | 1.000s (🏆 67% ahead) | 3.000s (+2.000s, +200%) |\n'
      + '| **Median** | **1.500s (🏆 57% ahead)** | **-** |'
    );
  });

  it('separates several tables with a blank line and leaves empty cells unbolded', () => {
    const md = titledMarkdownTables([load, { title: 'Other', header: ['Run', 'a'], rows: [{ cells: ['Average', ''], bold: true }] }]);
    expect(md).toContain('| **-** |\n\n**Other**\n\n| Run | a |');
    expect(md.endsWith('| **Average** |  |')).toBe(true);
  });

  it('escapes pipes in cells', () => {
    expect(titledMarkdownTables([{ title: 't', header: ['a'], rows: [{ cells: ['x | y'] }] }])).toContain('| x \\| y |');
  });

  it('keeps a title with line breaks on one heading line', () => {
    // raceStart() takes a name as given; a break in it must not split the
    // bold heading or open a stray block above the table.
    const md = titledMarkdownTables([{ title: 'Race Section\r\nLoad\nmore', header: ['a'], rows: [{ cells: ['1'] }] }]);
    expect(md.split('\n')[0]).toBe('**Race Section Load more**');
    expect(md).toBe('**Race Section Load more**\n\n| a |\n| --- |\n| 1 |');
  });
});

describe('spreadsheetFileName', () => {
  it('slugs the page title into a .csv name', () => {
    expect(spreadsheetFileName('Race: lauda vs hunt')).toBe('race_lauda_vs_hunt.csv');
    expect(spreadsheetFileName('lauda vs hunt — Race Conditions')).toBe('lauda_vs_hunt_race_conditions.csv');
  });

  it('falls back to a generic name for an empty title', () => {
    expect(spreadsheetFileName('')).toBe('race-export.csv');
    expect(spreadsheetFileName('—')).toBe('race-export.csv');
  });

  it('shares its stem with the HTML and ZIP downloads', () => {
    // export-zip.js names its bundles exportSlug(title) + '.zip' / '.html'.
    expect(exportSlug('Race: lauda vs hunt')).toBe('race_lauda_vs_hunt');
    expect(spreadsheetFileName('Race: lauda vs hunt')).toBe(exportSlug('Race: lauda vs hunt') + '.csv');
    expect(exportSlug('')).toBe('race-export');
  });
});
