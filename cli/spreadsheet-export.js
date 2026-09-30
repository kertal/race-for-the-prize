/**
 * spreadsheet-export.js — the numbers of a race, shaped for a spreadsheet.
 *
 * Every report table (the results, the performance profile, the run-by-run
 * comparison, the condition matrix) is built for reading: formatted values,
 * trophies, deltas. A spreadsheet wants the opposite — raw numbers, one unit
 * per column, one shape for everything. This module builds that shape as a
 * plain model of "groups" the reader can tick on and off:
 *
 *   { headers: ['Section', 'Measurement', 'Unit'], racers: ['lauda', 'hunt'],
 *     groups: [{ id, title, rows: [{ cells: ['Load'], unit: 's', values: [1.2, 2.3] }] }] }
 *
 * and renders the Spreadsheet Export panel from spreadsheet.html: the group
 * checkboxes, the copy/download controls and a preview table holding every
 * row, plus the model itself as JSON for the browser runtime
 * (player-runtime/spreadsheet.cjs + spreadsheet-panel.js). The same runtime
 * serves both reports, so it is exported here for the overview page to inline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplates, escHtml } from './html-templates.js';
import { PROFILE_METRICS } from './profile-analysis.js';
import { sortComparisonsForDisplay, buildRunComparisonModel } from './report-model.js';
import { RACER_CSS_COLORS, RACER_EMOJI } from './player-sections.js';
import spreadsheet from './player-runtime/spreadsheet.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { fill } = loadTemplates(path.join(__dirname, 'spreadsheet.html'));

/** The component rules for the panel; each report inlines them after its own. */
export const SPREADSHEET_CSS = fs.readFileSync(path.join(__dirname, 'spreadsheet.css'), 'utf-8');

/** The browser side of the panel, for a page that does not carry the player runtime. */
export const SPREADSHEET_RUNTIME = ['spreadsheet.cjs', 'spreadsheet-panel.js']
  .map(f => fs.readFileSync(path.join(__dirname, 'player-runtime', f), 'utf-8'))
  .join('\n');

const DURATION_UNIT = 's';

/** Profile scopes in the order the reports list them, with the titles the export uses. */
const PROFILE_SCOPES = [
  { scope: 'measured', title: 'Race' },
  { scope: 'total', title: 'Total Recording' },
];

const NOTE = 'Plain numbers, one unit per row, one column per racer — tick the tables you want, '
  + 'then copy them as tab-separated text or download a CSV (both paste into Excel, Google Sheets or Numbers as numbers), '
  + 'or copy them as a Markdown table for a GitHub issue, pull request or README.';

/**
 * A value as the spreadsheet should carry it: a finite number rounded to six
 * decimals (floating-point sums otherwise leak "1.2000000000000002" into a
 * cell), or null for anything missing.
 */
function num(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 1e6) / 1e6;
}

/** The unit a PROFILE_METRICS key measures in, or '' for an unknown key. */
function unitOf(key) {
  return PROFILE_METRICS[key]?.unit || '';
}

/**
 * Each racer's name behind its colour dot — "🔴 lauda" — which is how the
 * racer columns are headed and how the winner column names a racer, so the
 * colour a racer wears on the page survives into a sheet that has none.
 */
function racerLabelsFor(racers) {
  return racers.map((name, i) => `${RACER_EMOJI[i % RACER_EMOJI.length]} ${name}`);
}

// ---------------------------------------------------------------------------
// The results player: one race, or the median page of a multi-run race
// ---------------------------------------------------------------------------

/** The race results: every measurement (synthetic total first), one value per racer. */
function resultsGroup(summary, racers) {
  const comparisons = sortComparisonsForDisplay(summary.comparisons || []);
  if (comparisons.length === 0) return null;
  const runs = summary.runs > 1 ? ` (median of ${summary.runs} runs)` : '';
  return {
    id: 'results',
    title: `Race Results${runs}`,
    rows: comparisons.map(comp => ({
      cells: [comp.name],
      unit: DURATION_UNIT,
      values: racers.map((_, i) => num(comp.racers?.[i]?.duration)),
    })),
  };
}

/** One profile scope's metrics — those at least one racer has a value for. */
function profileGroup(summary, racers, { scope, title }) {
  const profiles = summary.profileMetrics || [];
  const rows = [];
  for (const [key, metric] of Object.entries(PROFILE_METRICS)) {
    if (metric.scope !== scope) continue;
    const [, name] = key.split('.');
    const values = racers.map((_, i) => num(profiles[i]?.[scope]?.[name]));
    if (values.every(v => v == null)) continue;
    rows.push({ cells: [metric.name], unit: metric.unit || '', values });
  }
  if (rows.length === 0) return null;
  return { id: `profile.${scope}`, title: `Performance: ${title}`, rows };
}

/**
 * Per-section profile metrics, one group per timed section. Only when there
 * is more than one section: with a single one they repeat the Race scope
 * exactly, which is why the player hides them then too.
 */
function sectionProfileGroups(summary, racers) {
  const profiles = summary.profileMetrics || [];
  const sectionNames = [...new Set(profiles.flatMap(p => Object.keys(p?.measuredSections || {})))];
  if (sectionNames.length < 2) return [];

  const measuredMetrics = Object.entries(PROFILE_METRICS).filter(([, metric]) => metric.scope === 'measured');
  const groups = [];
  for (const section of sectionNames) {
    const rows = [];
    for (const [key, metric] of measuredMetrics) {
      const [, name] = key.split('.');
      const values = racers.map((_, i) => num(profiles[i]?.measuredSections?.[section]?.[name]));
      if (values.every(v => v == null)) continue;
      rows.push({ cells: [metric.name], unit: metric.unit || '', values });
    }
    if (rows.length > 0) groups.push({ id: `profile.section:${section}`, title: `Performance: Section ${section}`, rows });
  }
  return groups;
}

/** Run 1..N, then Median and Average, from a run-comparison model entry. */
function runRows(entry, unit) {
  const rows = entry.runRows.map(row => ({
    cells: [`Run ${row.label}`],
    unit,
    values: row.cells.map(cell => num(cell.value)),
  }));
  if (entry.medianRow) rows.push({ cells: ['Median'], unit, values: entry.medianRow.cells.map(cell => num(cell.value)) });
  if (entry.averageRow) rows.push({ cells: ['Average'], unit, values: entry.averageRow.cells.map(cell => num(cell.value)) });
  return rows;
}

/** The run-by-run tables of a multi-run race: each measurement, then each profile metric. */
function runByRunGroups(summary, racers, runSummaries) {
  if (!Array.isArray(runSummaries) || runSummaries.length <= 1) return [];
  const model = buildRunComparisonModel(runSummaries, summary, racers, PROFILE_METRICS);
  if (model.isEmpty) return [];

  const groups = model.measurements.map(measurement => ({
    id: measurement.id,
    title: `Run-by-Run: ${measurement.name}`,
    rows: runRows(measurement, DURATION_UNIT),
  }));
  for (const scope of model.profileScopes) {
    const scopeTitle = PROFILE_SCOPES.find(s => s.scope === scope.scope)?.title || scope.title;
    for (const metric of scope.metrics) {
      groups.push({
        id: metric.id,
        title: `Run-by-Run: ${metric.name} (${scopeTitle})`,
        rows: runRows(metric, unitOf(metric.key)),
      });
    }
  }
  return groups;
}

/**
 * Build the export model for a results player page.
 *
 * @param {object} summary - the race summary (a median summary on a multi-run page)
 * @param {object} [options]
 * @param {object[]} [options.runSummaries] - per-run summaries of a multi-run race
 * @returns {{headers: string[], racers: string[], racerLabels: string[], groups: object[]}}
 */
export function buildSpreadsheetModel(summary, options = {}) {
  const racers = summary.racers || [];
  const groups = [
    resultsGroup(summary, racers),
    ...PROFILE_SCOPES.map(scope => profileGroup(summary, racers, scope)),
    ...sectionProfileGroups(summary, racers),
    ...runByRunGroups(summary, racers, options.runSummaries),
  ].filter(Boolean);
  return { headers: ['Section', 'Measurement', 'Unit'], racers, racerLabels: racerLabelsFor(racers), groups };
}

// ---------------------------------------------------------------------------
// The condition overview: every metric across every throttling condition
// ---------------------------------------------------------------------------

/**
 * Build the export model for a multi-condition overview: one group per metric,
 * one row per condition. Network and CPU get columns of their own, so a sheet
 * can pivot on either; conditions without coordinates leave them blank.
 *
 * @param {object} matrix - from buildConditionMatrix()
 */
export function buildConditionSpreadsheetModel(matrix) {
  const racers = matrix.racers || [];
  const groups = (matrix.metrics || []).map(metric => ({
    id: metric.key,
    title: metric.name,
    rows: (matrix.cells || []).map(cell => {
      // Series rows are ranked best-first; put them back into racer order.
      const values = racers.map(() => null);
      for (const racer of cell.metrics?.[metric.key]?.racers || []) values[racer.index] = num(racer.value);
      return {
        cells: [cell.title, cell.network ?? '', cell.cpu ?? ''],
        unit: metric.unit || '',
        values,
      };
    }),
  }));
  return { headers: ['Metric', 'Condition', 'Network', 'CPU', 'Unit'], racers, racerLabels: racerLabelsFor(racers), groups };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Escape '<' so a racer name can never close the JSON block early — the same
 * form videoplayer.js gives its race config. (Built from the code point rather
 * than written as an escape sequence, which an editor once decoded back into a
 * bare '<' and silently disabled the escaping.)
 */
const LT_ESCAPE = '\\u' + '<'.codePointAt(0).toString(16).padStart(4, '0');
function serializeModel(model) {
  return JSON.stringify(model).replaceAll('<', LT_ESCAPE);
}

/** One preview cell: empty, a number carrying its raw value, or escaped text. */
function cellHtml(value) {
  if (value == null) return fill('spreadsheet-empty');
  if (typeof value === 'number') return fill('spreadsheet-number', { value: String(value), text: String(value) });
  return fill('spreadsheet-cell', { text: escHtml(value) });
}

/**
 * Render the Spreadsheet Export panel for a model. Returns '' when there is
 * nothing to export, so the page can leave the section out.
 *
 * @param {{headers: string[], racers: string[], groups: object[]}} model
 * @param {object} [options]
 * @param {string} [options.note] - the sentence above the checkboxes
 */
export function buildSpreadsheetPanelHtml(model, options = {}) {
  if (!model || !model.groups || model.groups.length === 0) return '';

  const groups = model.groups
    .map(group => fill('spreadsheet-group', { id: escHtml(group.id), title: escHtml(group.title) }))
    .join('\n');

  // The preview shows exactly the table the copy and download produce, so it
  // is built by the same flattening: the shared core, one group at a time so
  // each row can carry its group id. Only the racer columns are styled.
  const { header } = spreadsheet.spreadsheetTable(model, []);
  const racerStart = model.headers.length;
  const racerEnd = racerStart + model.racers.length;
  const headerCells = fill('spreadsheet-pick-header') + header.map((label, i) => (i >= racerStart && i < racerEnd
    ? fill('spreadsheet-racer-cell', { color: RACER_CSS_COLORS[(i - racerStart) % RACER_CSS_COLORS.length], name: escHtml(label) })
    : fill('spreadsheet-header-cell', { label: escHtml(label) })
  )).join('');

  // Each row leads with its own include checkbox, keyed so the runtime can
  // map it back to the model row it stands for.
  const rows = model.groups.flatMap(group =>
    spreadsheet.spreadsheetTable(model, [group.id]).rows.map((cells, index) => fill('spreadsheet-row', {
      group: escHtml(group.id),
      cells: fill('spreadsheet-pick', {
        key: escHtml(spreadsheet.spreadsheetRowKey(group.id, index)),
        label: escHtml(`${group.title}: ${group.rows[index].cells.join(' ')}`),
      }) + cells.map(cellHtml).join(''),
    }))).join('\n');

  return fill('spreadsheet-panel', {
    note: escHtml(options.note || NOTE),
    groups,
    headerCells,
    rows,
    data: serializeModel(model),
  });
}
