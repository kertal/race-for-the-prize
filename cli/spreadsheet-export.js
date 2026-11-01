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
import { loadTemplates, escHtml, serializeJsonForScript } from './html-templates.js';
import { PROFILE_METRICS, determineProfileMetricOutcome } from './profile-analysis.js';
import { sortComparisonsForDisplay, buildRunComparisonModel } from './report-model.js';
import { medianOf } from './summary.js';
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
 * The verdict a row carries into the sheet, as the report decided it:
 * `winner` is the index of the racer the report named, or null; `tie` says
 * two or more racers had values and none was named — a dead heat, or a gap
 * the report judged below its noise floor or tie epsilon. With fewer than two
 * values there is nobody to beat and neither is set.
 */
function verdictOf(winnerIndex, values) {
  const measured = values.filter(v => v != null).length;
  if (winnerIndex != null && winnerIndex >= 0) return { winner: winnerIndex, tie: false };
  return { winner: null, tie: measured >= 2 };
}

/** The verdict of a report row whose cells carry isWinner flags (the run-by-run tables). */
function verdictOfCells(cells, values) {
  const winners = cells.map((cell, i) => (cell.isWinner ? i : -1)).filter(i => i >= 0);
  // Several flagged winners (an average two racers share) is a tie.
  return verdictOf(winners.length === 1 ? winners[0] : null, values);
}

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
    rows: comparisons.map(comp => {
      const values = racers.map((_, i) => num(comp.racers?.[i]?.duration));
      // comp.winner is the report's call: null on a dead heat, and on a
      // synthetic total whose racers finish within its tie epsilon.
      return { cells: [comp.name], unit: DURATION_UNIT, values, ...verdictOf(racers.indexOf(comp.winner), values) };
    }),
  };
}

/**
 * One profile metric's row, with the verdict the Performance Profile shows:
 * determineProfileMetricOutcome applies the category's percentage threshold
 * and the metric's noise floor, so a 900ms vs 905ms LCP is a tie here too.
 */
function profileRow(metric, racers, values) {
  const { winner } = determineProfileMetricOutcome(metric, racers, values);
  return { cells: [metric.name], unit: metric.unit || '', values, ...verdictOf(racers.indexOf(winner), values) };
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
    rows.push(profileRow(metric, racers, values));
  }
  if (rows.length === 0) return null;
  return { id: `profile.${scope}`, title: `Performance: ${title}`, rows };
}

/**
 * Each racer's per-section measured metrics for this page. A single-run page
 * carries them on its own summary. A --runs median summary does not: its
 * profile metrics keep only the race and total scopes (see
 * buildMedianProfileMetrics in summary.js), so there they are the median of
 * each run's sections, racer by racer and metric by metric.
 */
function sectionProfiles(summary, racers, runSummaries) {
  const own = summary.profileMetrics || [];
  if (own.some(p => p?.measuredSections) || !Array.isArray(runSummaries) || runSummaries.length <= 1) return own;

  // Section names are whatever a spec passed to raceStart(), so they are keys
  // of prototype-less objects: on a plain one, a section called "constructor"
  // would resolve to Object's and never be stored.
  return racers.map((_, i) => {
    const samples = Object.create(null);
    for (const run of runSummaries) {
      for (const [section, metrics] of Object.entries(run.profileMetrics?.[i]?.measuredSections || {})) {
        samples[section] ??= Object.create(null);
        for (const [name, value] of Object.entries(metrics || {})) (samples[section][name] ??= []).push(value);
      }
    }
    const measuredSections = Object.create(null);
    for (const [section, metrics] of Object.entries(samples)) {
      measuredSections[section] = Object.fromEntries(
        Object.entries(metrics).map(([name, values]) => [name, medianOf(values)]).filter(([, value]) => value != null)
      );
    }
    return { measuredSections };
  });
}

/**
 * Per-section profile metrics, one group per timed section. Only when there
 * is more than one section: with a single one they repeat the Race scope
 * exactly, which is why the player hides them then too.
 */
function sectionProfileGroups(summary, racers, runSummaries) {
  const profiles = sectionProfiles(summary, racers, runSummaries);
  const sectionNames = [...new Set(profiles.flatMap(p => Object.keys(p?.measuredSections || {})))];
  if (sectionNames.length < 2) return [];
  const runs = summary.runs > 1 ? ` (median of ${summary.runs} runs)` : '';

  const measuredMetrics = Object.entries(PROFILE_METRICS).filter(([, metric]) => metric.scope === 'measured');
  const groups = [];
  for (const section of sectionNames) {
    const rows = [];
    for (const [key, metric] of measuredMetrics) {
      const [, name] = key.split('.');
      const values = racers.map((_, i) => num(profiles[i]?.measuredSections?.[section]?.[name]));
      if (values.every(v => v == null)) continue;
      rows.push(profileRow(metric, racers, values));
    }
    if (rows.length > 0) groups.push({ id: `profile.section:${section}`, title: `Performance: Section ${section}${runs}`, rows });
  }
  return groups;
}

/** Run 1..N, then Median and Average, from a run-comparison model entry. */
function runRows(entry, unit) {
  // The verdict is the one the Run-by-Run Comparison table shows: the cells
  // the report model flagged as winners.
  const row = (label, cells) => {
    const values = cells.map(cell => num(cell.value));
    return { cells: [label], unit, values, ...verdictOfCells(cells, values) };
  };
  const rows = entry.runRows.map(r => row(`Run ${r.label}`, r.cells));
  if (entry.medianRow) rows.push(row('Median', entry.medianRow.cells));
  if (entry.averageRow) rows.push(row('Average', entry.averageRow.cells));
  return rows;
}

/** The run-by-run tables of a multi-run race: each measurement, then each profile metric. */
function runByRunGroups(summary, racers, runSummaries) {
  if (!Array.isArray(runSummaries) || runSummaries.length <= 1) return [];
  const model = buildRunComparisonModel(runSummaries, summary, racers, PROFILE_METRICS);
  if (model.isEmpty) return [];

  const groups = model.measurements.map(measurement => ({
    id: spreadsheet.spreadsheetRunGroupId('section', measurement.name),
    title: `Run-by-Run: ${measurement.name}`,
    rows: runRows(measurement, DURATION_UNIT),
  }));
  for (const scope of model.profileScopes) {
    const scopeTitle = PROFILE_SCOPES.find(s => s.scope === scope.scope)?.title || scope.title;
    for (const metric of scope.metrics) {
      groups.push({
        id: spreadsheet.spreadsheetRunGroupId('profile', metric.key),
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
    ...sectionProfileGroups(summary, racers, options.runSummaries),
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
      const series = cell.metrics?.[metric.key];
      const values = racers.map(() => null);
      for (const racer of series?.racers || []) values[racer.index] = num(racer.value);
      // The series carries the matrix's own verdict — the race's overall winner
      // for total time, the thresholded outcome for a profile metric — and its
      // own notion of a tie, taken as given: a cell the matrix shows without a
      // verdict (neither winner nor tie) exports the same way.
      const winner = series?.winner ? racers.indexOf(series.winner) : -1;
      return {
        cells: [cell.title, cell.network ?? '', cell.cpu ?? ''],
        unit: metric.unit || '',
        values,
        winner: winner >= 0 ? winner : null,
        tie: !!series?.isTie,
      };
    }),
  }));
  return { headers: ['Metric', 'Condition', 'Network', 'CPU', 'Unit'], racers, racerLabels: racerLabelsFor(racers), groups };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The model, for the <script type="application/json"> block the runtime reads. */
function serializeModel(model) {
  return serializeJsonForScript(model);
}

/**
 * One preview cell: empty, a number carrying its raw value, or escaped text.
 * Text goes through the same spreadsheetCell() as the TSV and CSV, so a label
 * that starts like a formula wears its apostrophe in the preview too: the
 * preview is meant to be selected and pasted by hand when there is no
 * JavaScript, and that paste must be as safe as the copy button's.
 */
function cellHtml(value) {
  if (value == null) return fill('spreadsheet-empty');
  if (typeof value === 'number') return fill('spreadsheet-number', { value: String(value), text: String(value) });
  return fill('spreadsheet-cell', { text: escHtml(spreadsheet.spreadsheetCell(value)) });
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
  // is built by the same flattening: the shared core, once, with its rows
  // handed back to their groups in order so each can carry its group id.
  // Only the racer columns are styled.
  const { header, rows: flatRows } = spreadsheet.spreadsheetTable(model);
  const racerStart = model.headers.length;
  const racerEnd = racerStart + model.racers.length;
  const headerCells = fill('spreadsheet-pick-header') + header.map((label, i) => (i >= racerStart && i < racerEnd
    ? fill('spreadsheet-racer-cell', { color: RACER_CSS_COLORS[(i - racerStart) % RACER_CSS_COLORS.length], name: escHtml(label) })
    : fill('spreadsheet-header-cell', { label: escHtml(label) })
  )).join('');

  // Each row leads with its own include checkbox, keyed so the runtime can
  // map it back to the model row it stands for.
  let next = 0;
  const rows = model.groups.flatMap(group =>
    group.rows.map((row, index) => fill('spreadsheet-row', {
      group: escHtml(group.id),
      cells: fill('spreadsheet-pick', {
        key: escHtml(spreadsheet.spreadsheetRowKey(group.id, index)),
        label: escHtml(`${group.title}: ${row.cells.join(' ')}`),
      }) + flatRows[next++].map(cellHtml).join(''),
    }))).join('\n');

  return fill('spreadsheet-panel', {
    note: escHtml(options.note || NOTE),
    groups,
    headerCells,
    rows,
    data: serializeModel(model),
  });
}
