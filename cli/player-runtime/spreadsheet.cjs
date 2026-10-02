/* Pure spreadsheet-export helpers, shared by the report pages and their tests.
 *
 * The pages embed an export model — `{ headers, racers, groups }`, built in
 * Node by cli/spreadsheet-export.js — and the functions here turn the groups
 * the reader ticked into one flat table, then into the text a spreadsheet
 * pastes or opens: tab-separated for the clipboard, CSV for a download.
 * Values stay plain numbers; the unit rides in its own column. */

/** The verdict columns every row ends with. */
const VERDICT_HEADERS = ['Winner', 'Delta to 2nd', 'Delta %'];
const TIE_LABEL = '\u{1F91D} Tie';

/** Round to a fixed number of decimals, without float noise in the result. */
function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Who won a row and by how much: the racer with the lowest value (every
 * metric here is lower-is-better), the gap between it and the runner-up in
 * the row's unit, and that gap as a percentage of the runner-up — the same
 * "60% ahead" the reports print beside a winner. Two racers sharing the
 * lowest value are a tie with no lead; fewer than two values leave all three
 * cells empty, there being nobody to beat.
 */
function rowVerdict(values, racerLabels) {
  const present = values
    .map((value, i) => (typeof value === 'number' && Number.isFinite(value) ? { value, i } : null))
    .filter(Boolean)
    .sort((a, b) => a.value - b.value);
  if (present.length < 2) return [null, null, null];
  const [best, second] = present;
  if (best.value === second.value) return [TIE_LABEL, 0, 0];
  const delta = roundTo(second.value - best.value, 6);
  const percent = second.value > 0 ? roundTo((delta / second.value) * 100, 1) : null;
  return [racerLabels[best.i], delta, percent];
}

/**
 * The id of a run-by-run group: `runs:section:<measurement>` for a timed
 * section, `runs:profile:<scope.metric>` for a profile metric. Separate
 * namespaces, so a section a spec happened to call "measured.scriptDuration"
 * never shares an id (and so a checkbox) with the profile metric of that
 * key. Both the export model and the run-by-run section's own export buttons
 * name groups by this, which is why it lives in the shared core.
 */
function spreadsheetRunGroupId(kind, name) {
  return `runs:${kind}:${name}`;
}

/**
 * The key of one row: its group's id and its position in the group. A
 * selection names rows by these, or whole groups by their id.
 */
function spreadsheetRowKey(groupId, index) {
  // The `row:` prefix keeps row keys out of the group-id namespace: no group
  // id starts with it (they start with "results", "profile.", "runs:" or a
  // metric key), so a section called "x#0" can never make the first row of a
  // section called "x" select the whole of it.
  return `row:${groupId}#${index}`;
}

/**
 * Flatten the selected rows of a model into one table.
 * Every row is `[group title, ...row cells, unit, ...one value per racer,
 * winner, delta to 2nd, delta %]`, so a reader can filter by the first column
 * once it is in a sheet and sort by the last ones. Racer columns are headed
 * by the model's `racerLabels` (the name with its colour dot) when it has
 * them, else by the bare names.
 *
 * @param {{headers: string[], racers: string[], racerLabels?: string[], groups: Array<{id, title, rows}>}} model
 * @param {string[]|null} [selected] - what to keep: group ids (every row of
 *   the group) and/or row keys (see spreadsheetRowKey); null keeps everything
 * @returns {{header: string[], rows: Array<Array<string|number|null>>}}
 */
function spreadsheetTable(model, selected = null) {
  const wanted = selected ? new Set(selected) : null;
  const racerLabels = model.racerLabels || model.racers || [];
  const header = [...(model.headers || []), ...racerLabels, ...VERDICT_HEADERS];
  const rows = [];
  for (const group of model.groups || []) {
    (group.rows || []).forEach((row, index) => {
      if (wanted && !wanted.has(group.id) && !wanted.has(spreadsheetRowKey(group.id, index))) return;
      const values = row.values || [];
      rows.push([group.title, ...(row.cells || []), row.unit ?? '', ...values, ...rowVerdict(values, racerLabels)]);
    });
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
 * number. An output nothing evaluates (Markdown) passes `defuse: false`.
 */
function spreadsheetCell(value, decimal = '.', defuse = true) {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    const text = String(value);
    return decimal === ',' ? text.replace('.', ',') : text;
  }
  const text = String(value);
  return defuse && FORMULA_LEAD.test(text) ? `'${text}` : text;
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

/**
 * A GitHub-flavored Markdown table, for pasting the numbers into an issue,
 * a pull request or a README. Columns holding only numbers (the racers') are
 * right-aligned so the digits line up; a pipe inside a label is escaped and a
 * line break becomes a space, since either would end the cell. Nothing
 * evaluates a Markdown cell, so formula-like labels are left as written.
 */
function spreadsheetMarkdown(table, options = {}) {
  const decimal = options.decimal || '.';
  // Backslashes first: escaping the pipe in "a\|b" without doubling the
  // backslash would give "a\\|b", which GFM reads as a literal backslash
  // followed by a column break.
  const escape = text => text.replace(/[\r\n]+/g, ' ').replaceAll('\\', '\\\\').replaceAll('|', '\\|');
  const cell = value => escape(spreadsheetCell(value, decimal, false));
  const numeric = table.header.map((_, col) =>
    table.rows.some(row => typeof row[col] === 'number')
    && table.rows.every(row => row[col] == null || typeof row[col] === 'number'));
  const line = cells => `| ${cells.join(' | ')} |`;
  return [
    line(table.header.map(cell)),
    line(numeric.map(isNumeric => (isNumeric ? '---:' : '---'))),
    ...table.rows.map(row => line(row.map(cell))),
  ].join('\n');
}

/**
 * Report tables as the page shows them — formatted values, trophies, deltas —
 * in GitHub Markdown, each under its bold title. Markdown has no row style,
 * so a bold row (median, average) is bolded cell by cell.
 *
 * @param {Array<{title: string, header: string[], rows: Array<{cells: string[], bold?: boolean}>}>} tables
 */
function titledMarkdownTables(tables) {
  return tables.map(({ title, header, rows }) => {
    const cells = rows.map(row => row.cells.map(text => (row.bold && text ? `**${text}**` : text)));
    return `**${title}**\n\n` + spreadsheetMarkdown({ header, rows: cells });
  }).join('\n\n');
}

/** A safe download name from a page title: "Race: lauda vs hunt" -> race_lauda_vs_hunt.csv. */
function spreadsheetFileName(title) {
  const base = String(title || '').replace(/[^a-zA-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return `${base || 'race-results'}.csv`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spreadsheetTable, spreadsheetRunGroupId, spreadsheetRowKey, rowVerdict, spreadsheetCell, spreadsheetText, spreadsheetTsv, spreadsheetCsv, spreadsheetMarkdown, titledMarkdownTables, spreadsheetFileName };
}
