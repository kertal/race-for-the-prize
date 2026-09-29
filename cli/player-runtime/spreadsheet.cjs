/* Pure spreadsheet-export helpers, shared by the report pages and their tests.
 *
 * The pages embed an export model — `{ headers, racers, groups }`, built in
 * Node by cli/spreadsheet-export.js — and the functions here turn the groups
 * the reader ticked into one flat table, then into the text a spreadsheet
 * pastes or opens: tab-separated for the clipboard, CSV for a download.
 * Values stay plain numbers; the unit rides in its own column. */

/**
 * Flatten the selected groups of a model into one table.
 * Every row is `[group title, ...row cells, unit, ...one value per racer]`, so
 * a reader can filter by the first column once it is in a sheet.
 *
 * @param {{headers: string[], racers: string[], groups: Array<{id, title, rows}>}} model
 * @param {string[]|null} [selectedIds] - group ids to keep; null keeps every group
 * @returns {{header: string[], rows: Array<Array<string|number|null>>}}
 */
function spreadsheetTable(model, selectedIds = null) {
  const wanted = selectedIds ? new Set(selectedIds) : null;
  const header = [...(model.headers || []), ...(model.racers || [])];
  const rows = [];
  for (const group of model.groups || []) {
    if (wanted && !wanted.has(group.id)) continue;
    for (const row of group.rows || []) {
      rows.push([group.title, ...(row.cells || []), row.unit ?? '', ...(row.values || [])]);
    }
  }
  return { header, rows };
}

/**
 * A leading character that makes a spreadsheet read a cell as a formula
 * (=, +, -, @) or, in some, as a continuation of the previous one (tab, CR).
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One cell as text. Missing values are empty cells (not "-" or "null", which
 * a spreadsheet would read as text and refuse to sum); numbers take the
 * requested decimal mark, since a comma-decimal locale pastes "1.234" as text.
 *
 * Labels come from race files and spec code, so a section called "=CMD()"
 * would otherwise reach the sheet as a formula. Text that starts like one is
 * prefixed with an apostrophe, which every spreadsheet reads as "this is
 * text" and hides. Numbers are never prefixed: a negative delta must stay a
 * number.
 */
function spreadsheetCell(value, decimal = '.') {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    const text = String(value);
    return decimal === ',' ? text.replace('.', ',') : text;
  }
  const text = String(value);
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

/**
 * Serialize a table. TSV never quotes — spreadsheets do not expect it there —
 * so a tab or line break inside a label becomes a space; CSV quotes any field
 * holding the delimiter, a quote or a line break, doubling embedded quotes.
 */
function spreadsheetText(table, { delimiter = '\t', decimal = '.', newline = '\n', quote = false } = {}) {
  const escape = (text) => {
    if (!quote) return text.replace(/[\t\r\n]+/g, ' ');
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const line = cells => cells.map(value => escape(spreadsheetCell(value, decimal))).join(delimiter);
  return [line(table.header), ...table.rows.map(line)].join(newline);
}

/** Tab-separated text — what pastes straight into a sheet's cells. */
function spreadsheetTsv(table, options = {}) {
  return spreadsheetText(table, { decimal: options.decimal || '.', delimiter: '\t', newline: '\n', quote: false });
}

/**
 * CSV for a download. A comma decimal mark switches the delimiter to the
 * semicolon, as spreadsheets in those locales expect (and so the decimal
 * comma is never mistaken for a column break).
 */
function spreadsheetCsv(table, options = {}) {
  const decimal = options.decimal || '.';
  return spreadsheetText(table, { decimal, delimiter: decimal === ',' ? ';' : ',', newline: '\r\n', quote: true }) + '\r\n';
}

/** A safe download name from a page title: "Race: lauda vs hunt" -> race_lauda_vs_hunt.csv. */
function spreadsheetFileName(title) {
  const base = String(title || '').replace(/[^a-zA-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return `${base || 'race-results'}.csv`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spreadsheetTable, spreadsheetCell, spreadsheetText, spreadsheetTsv, spreadsheetCsv, spreadsheetFileName };
}
