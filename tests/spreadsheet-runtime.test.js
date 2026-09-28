/**
 * Behavioral tests for the pure spreadsheet-export logic the report pages
 * carry (cli/player-runtime/spreadsheet.cjs): flattening the ticked groups of
 * an export model into one table, and serializing it as TSV or CSV.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  spreadsheetTable,
  spreadsheetCell,
  spreadsheetTsv,
  spreadsheetCsv,
  spreadsheetFileName,
} = require('../cli/player-runtime/spreadsheet.cjs');

const model = {
  headers: ['Section', 'Measurement', 'Unit'],
  racers: ['lauda', 'hunt'],
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

describe('spreadsheetTable', () => {
  it('flattens every group into one table when nothing is selected explicitly', () => {
    const table = spreadsheetTable(model);
    expect(table.header).toEqual(['Section', 'Measurement', 'Unit', 'lauda', 'hunt']);
    expect(table.rows).toEqual([
      ['Race Results', 'Race', 's', 1.5, 3.7],
      ['Race Results', 'Load', 's', 1, null],
      ['Performance: Race', 'Network Transfer', 'bytes', 12345, 23456],
    ]);
  });

  it('keeps only the selected groups, in model order', () => {
    const table = spreadsheetTable(model, ['profile.measured']);
    expect(table.rows).toEqual([['Performance: Race', 'Network Transfer', 'bytes', 12345, 23456]]);
    expect(spreadsheetTable(model, []).rows).toEqual([]);
  });

  it('carries extra row cells (the overview has network and CPU columns)', () => {
    const table = spreadsheetTable({
      headers: ['Metric', 'Condition', 'Network', 'CPU', 'Unit'],
      racers: ['a'],
      groups: [{ id: 'duration', title: 'Total Time', rows: [{ cells: ['slow-3g · CPU 4x', 'slow-3g', 4], unit: 's', values: [2] }] }],
    });
    expect(table.rows).toEqual([['Total Time', 'slow-3g · CPU 4x', 'slow-3g', 4, 's', 2]]);
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
});

describe('spreadsheetTsv', () => {
  it('joins cells with tabs and rows with newlines, header first', () => {
    expect(spreadsheetTsv(spreadsheetTable(model, ['results']))).toBe(
      'Section\tMeasurement\tUnit\tlauda\thunt\n'
      + 'Race Results\tRace\ts\t1.5\t3.7\n'
      + 'Race Results\tLoad\ts\t1\t'
    );
  });

  it('never quotes; a tab or line break inside a label becomes a space', () => {
    const table = { header: ['a'], rows: [['x\ty'], ['line\nbreak'], ['say "hi"']] };
    expect(spreadsheetTsv(table)).toBe('a\nx y\nline break\nsay "hi"');
  });

  it('applies the decimal comma to every number', () => {
    const tsv = spreadsheetTsv(spreadsheetTable(model, ['results']), { decimal: ',' });
    expect(tsv).toContain('\t1,5\t3,7');
    expect(tsv).toContain('\t1\t');
  });
});

describe('spreadsheetCsv', () => {
  it('uses commas and CRLF, with a trailing line break', () => {
    expect(spreadsheetCsv(spreadsheetTable(model, ['results']))).toBe(
      'Section,Measurement,Unit,lauda,hunt\r\n'
      + 'Race Results,Race,s,1.5,3.7\r\n'
      + 'Race Results,Load,s,1,\r\n'
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
    expect(csv.split('\r\n')[1]).toBe('Race Results;Race;s;1,5;3,7');
    // Now a label with a comma needs no quoting, but one with a semicolon does.
    expect(spreadsheetCsv({ header: ['a'], rows: [['x, y'], ['x; y']] }, { decimal: ',' })).toBe('a\r\nx, y\r\n"x; y"\r\n');
  });
});

describe('spreadsheetFileName', () => {
  it('slugs the page title into a .csv name', () => {
    expect(spreadsheetFileName('Race: lauda vs hunt')).toBe('race_lauda_vs_hunt.csv');
    expect(spreadsheetFileName('lauda vs hunt — Race Conditions')).toBe('lauda_vs_hunt_race_conditions.csv');
  });

  it('falls back to a generic name for an empty title', () => {
    expect(spreadsheetFileName('')).toBe('race-results.csv');
    expect(spreadsheetFileName('—')).toBe('race-results.csv');
  });
});
