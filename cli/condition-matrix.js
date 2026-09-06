/**
 * condition-matrix.js — cross-condition overview for multi-condition races.
 *
 * When --network and/or --cpu name more than one value, every combination is
 * raced separately. Each condition gets its own results directory and report,
 * which answers "who won under slow-3g at 4x CPU?" but not "how does the field
 * hold up as conditions get harder?". This module builds that overview: a
 * matrix with network presets down the side, CPU rates across the top, and
 * every racer's value in each cell.
 *
 * Every cell carries a series per metric — total race time plus each profile
 * metric that was captured (network bytes, LCP, script duration, JS heap, …) —
 * so the HTML page can offer a picker that switches the whole matrix between
 * them. All metrics are "lower is better", as profile-analysis.js defines them.
 *
 * Layout follows the varying dimensions: a two-dimensional race gets the full
 * grid, a one-dimensional race collapses to a single column, and entries that
 * carry no network/cpu (older callers, hand-built lists) fall back to one row
 * per condition. Rendering is split the same way the rest of the reports are:
 * buildConditionMatrix() computes a plain data model, and the terminal and HTML
 * emitters below only decorate it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, RACER_COLORS } from './colors.js';
import { sortComparisonsForDisplay, rankEntries, formatDuration } from './report-model.js';
import { PROFILE_METRICS, determineProfileMetricOutcome } from './profile-analysis.js';
import { RACER_CSS_COLORS } from './player-sections.js';
import { resolveSkin, DEFAULT_THEME_COLOR } from './skins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The palette both reports share; inlined ahead of this page's components. */
const TOKENS = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf-8');

const WIN_MEDAL = '🏆';
const TIE_MEDAL = '🤝';
// Same display width as the medals, so unmedalled lines stay aligned under them.
const NO_MEDAL = '  ';
const NO_DATA = '—';
const COL_GAP = 2;

/**
 * The default series: total race time, taken from the measurements rather than
 * the CDP profile. Shaped like a PROFILE_METRICS entry so both kinds of metric
 * flow through the same code.
 */
export const TOTAL_TIME_METRIC = {
  key: 'duration',
  name: 'Total Time',
  scope: 'race',
  format: formatDuration,
  description: 'Total measured race time — the sum of every timed section.',
};

/** Select-box grouping for the metric scopes. */
const SCOPE_LABELS = { race: 'Race Time', measured: 'Race (Measured Section)', total: 'Total Recording' };

const cpuLabel = cpu => `CPU ${cpu}x`;

/** Unique values in first-seen order (Set loses nothing here, but order matters). */
function uniqueInOrder(values) {
  const seen = [];
  for (const value of values) if (!seen.includes(value)) seen.push(value);
  return seen;
}

/** Racer names across all conditions, in the order the conditions introduce them. */
function collectRacers(entries) {
  const names = [];
  for (const entry of entries) {
    for (const name of entry.summary?.racers || []) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The comparison that stands for the whole race: the synthetic all-sections
 * total when there is one (sortComparisonsForDisplay puts it first), otherwise
 * the single section. Null when the condition recorded no measurements.
 */
function overallComparison(summary) {
  const comparisons = summary?.comparisons;
  if (!Array.isArray(comparisons) || comparisons.length === 0) return null;
  return sortComparisonsForDisplay(comparisons)[0];
}

/**
 * Total time and profile metrics are both positional, indexed by their own
 * summary's racer order — which is the matrix order in practice, but resolve by
 * name so a condition that lists its racers differently still lines up.
 */
function racerIndexer(entry, racers) {
  const own = entry.summary?.racers;
  return name => (own ? own.indexOf(name) : racers.indexOf(name));
}

/** One metric's raw value per racer, in matrix racer order (null when missing). */
function metricValues(entry, racers, metric) {
  const indexOf = racerIndexer(entry, racers);

  if (metric.key === TOTAL_TIME_METRIC.key) {
    const comp = overallComparison(entry.summary);
    return racers.map(name => {
      const i = indexOf(name);
      return i >= 0 ? comp?.racers?.[i]?.duration ?? null : null;
    });
  }

  const [scope, name] = metric.key.split('.');
  return racers.map(racer => {
    const i = indexOf(racer);
    return i >= 0 ? entry.summary?.profileMetrics?.[i]?.[scope]?.[name] ?? null : null;
  });
}

/**
 * Who won a metric in one condition. Total time defers to the race's own
 * verdict ('tie' is a sentinel, not a racer name); profile metrics go through
 * determineProfileMetricOutcome so the matrix calls a difference significant
 * exactly when the per-condition report does.
 */
function metricOutcome(entry, racers, metric, values) {
  if (metric.key === TOTAL_TIME_METRIC.key) {
    const overallWinner = entry.summary?.overallWinner ?? null;
    return { winner: overallWinner === 'tie' ? null : overallWinner, isTie: overallWinner === 'tie' };
  }

  const { winner } = determineProfileMetricOutcome(metric, racers, values);
  // No significant winner between two or more measured racers is a tie, not
  // missing data — worth showing as such rather than as a blank verdict.
  const withData = values.filter(value => value != null).length;
  return { winner, isTie: !winner && withData >= 2 };
}

/** One condition's series for one metric: the verdict plus every racer, best first. */
function buildSeries(entry, racers, metric) {
  const values = metricValues(entry, racers, metric);
  const { winner, isTie } = metricOutcome(entry, racers, metric, values);
  const { entries: ranked, bestValue, maxValue } = rankEntries(
    racers,
    i => ({ val: values[i] }),
    metric.format
  );

  return {
    winner,
    isTie,
    best: bestValue ?? null,
    max: maxValue,
    racers: ranked.map(racer => ({
      name: racer.name,
      index: racer.index,
      value: racer.val ?? null,
      formatted: racer.val != null ? metric.format(racer.val) : null,
      delta: racer.delta,
      isWinner: racer.name === winner,
    })),
  };
}

/** Total time, then every profile metric that at least one condition captured. */
function availableMetrics(entries, profileMetrics) {
  const metrics = [TOTAL_TIME_METRIC];
  for (const [key, def] of Object.entries(profileMetrics)) {
    const [scope, name] = key.split('.');
    const hasData = entries.some(entry =>
      entry.summary?.profileMetrics?.some(profile => profile?.[scope]?.[name] != null));
    if (hasData) metrics.push({ ...def, key });
  }
  return metrics;
}

/**
 * Build the overview model for a list of condition results.
 *
 * @param {Array<{label: string, title?: string, network?: string, cpu?: number,
 *                summary: object|null}>} entries
 * @param {Object} [profileMetrics] - PROFILE_METRICS-shaped definitions to offer
 * @returns {{
 *   racers: string[], rowHeader: string, columns: string[],
 *   rows: Array<{header: string, cells: Array<object|null>}>, cells: object[],
 *   metrics: Array<{key: string, name: string, scope: string, format: Function}>,
 *   aggregates: Record<string, {wins: Record<string, number>, ties: number, max: number}>
 * }}
 */
export function buildConditionMatrix(entries, profileMetrics = PROFILE_METRICS) {
  const racers = collectRacers(entries);
  const metrics = availableMetrics(entries, profileMetrics);

  const cells = entries.map(entry => ({
    label: entry.label,
    title: entry.title || entry.label,
    network: entry.network,
    cpu: entry.cpu,
    metrics: Object.fromEntries(metrics.map(metric => [metric.key, buildSeries(entry, racers, metric)])),
  }));

  const networks = uniqueInOrder(cells.map(cell => cell.network));
  const cpus = uniqueInOrder(cells.map(cell => cell.cpu));

  // A full grid needs both coordinates on every condition and no gaps or
  // duplicates; anything else lists one condition per row instead. Counting
  // cells is not enough to prove that: two conditions sharing a coordinate hit
  // the same count as a complete grid, and then `at()` — which takes the first
  // match — would render the duplicate once and leave the pair it displaced as
  // an empty cell, silently dropping a condition from the overview.
  const coords = new Set(cells.map(cell => `${cell.network}\u0000${cell.cpu}`));
  const isGrid = cells.every(cell => cell.network != null && cell.cpu != null)
    && coords.size === cells.length
    && coords.size === networks.length * cpus.length;

  let rowHeader = 'Condition';
  let columns = ['Result'];
  let rows = cells.map(cell => ({ header: cell.title, cells: [cell] }));

  if (isGrid) {
    const at = (network, cpu) => cells.find(cell => cell.network === network && cell.cpu === cpu) || null;
    if (networks.length > 1 && cpus.length > 1) {
      rowHeader = 'Network';
      columns = cpus.map(cpuLabel);
      rows = networks.map(network => ({ header: network, cells: cpus.map(cpu => at(network, cpu)) }));
    } else if (cpus.length > 1) {
      rowHeader = 'CPU';
      rows = cpus.map(cpu => ({ header: cpuLabel(cpu), cells: [at(networks[0], cpu)] }));
    } else {
      rowHeader = 'Network';
      rows = networks.map(network => ({ header: network, cells: [at(network, cpus[0])] }));
    }
  }

  const aggregates = Object.fromEntries(metrics.map(metric => {
    const series = cells.map(cell => cell.metrics[metric.key]);
    return [metric.key, {
      wins: Object.fromEntries(racers.map(name => [name, series.filter(s => s.winner === name).length])),
      ties: series.filter(s => s.isTie).length,
      max: Math.max(0, ...series.map(s => s.max || 0)),
    }];
  }));

  return { racers, rowHeader, columns, rows, cells, metrics, aggregates };
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

/**
 * Render one cell as aligned lines. Each line carries both its plain text (for
 * width math — ANSI escapes would otherwise inflate every padding calculation)
 * and its colored form.
 */
function cellLines(series, nameWidth, valueWidth) {
  const missing = { plain: NO_DATA, colored: `${c.dim}${NO_DATA}${c.reset}` };
  if (!series || series.racers.length === 0) return [missing];

  return series.racers.map((racer, i) => {
    // A tie has no winner to crown, so the medal marks the row the tie is about.
    let medal = NO_MEDAL;
    if (racer.isWinner) medal = WIN_MEDAL;
    else if (series.isTie && i === 0) medal = TIE_MEDAL;

    const name = racer.name.padEnd(nameWidth);
    const value = (racer.formatted || '-').padStart(valueWidth);
    const color = RACER_COLORS[racer.index % RACER_COLORS.length];
    return {
      plain: `${medal} ${name} ${value}`,
      colored: `${medal} ${color}${c.bold}${name}${c.reset} ${value}`,
    };
  });
}

/** Pad an already-colored string to a visible width using its plain length. */
function padColored(line, width) {
  return line ? line.colored + ' '.repeat(Math.max(0, width - line.plain.length)) : ' '.repeat(width);
}

/** Wins-per-racer tally, e.g. "lauda 2 · hunt 1 · 1 tie". */
function tallyLine(matrix, metricKey) {
  const { wins, ties } = matrix.aggregates[metricKey] || { wins: {}, ties: 0 };
  const parts = matrix.racers.filter(name => wins[name] > 0).map(name => `${name} ${wins[name]}`);
  if (ties > 0) parts.push(`${ties} ${ties === 1 ? 'tie' : 'ties'}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Print the matrix to stderr (where all race progress output goes).
 * Falls back to a stacked, one-condition-per-block layout when the grid would
 * be wider than the terminal — a wrapped matrix is worse than no matrix.
 *
 * @param {Object} matrix - from buildConditionMatrix()
 * @param {Object} [options] - { write, width, metric } (metric defaults to total time)
 */
export function printConditionMatrix(matrix, options = {}) {
  const {
    write = s => process.stderr.write(s),
    width = process.stderr.columns || 100,
    metric = TOTAL_TIME_METRIC.key,
  } = options;
  if (!matrix || matrix.rows.length === 0) return;

  const seriesOf = cell => cell?.metrics?.[metric] || null;
  const nameWidth = Math.max(0, ...matrix.racers.map(name => name.length));
  const valueWidth = Math.max(1, ...matrix.cells.flatMap(cell =>
    (seriesOf(cell)?.racers || []).map(racer => (racer.formatted || '-').length)));
  const grid = matrix.rows.map(row => row.cells.map(cell => cellLines(seriesOf(cell), nameWidth, valueWidth)));

  const headerWidth = Math.max(matrix.rowHeader.length, ...matrix.rows.map(row => row.header.length));
  const colWidths = matrix.columns.map((label, ci) => Math.max(
    label.length,
    ...grid.map(rowLines => Math.max(...rowLines[ci].map(line => line.plain.length)))
  ));
  const totalWidth = 2 + headerWidth + colWidths.reduce((sum, w) => sum + COL_GAP + w, 0);

  write(`\n  ${c.bold}${c.magenta}⚡ Performance Matrix${c.reset}\n`);

  if (totalWidth > width) {
    printStacked(matrix, grid, write);
  } else {
    printGrid(matrix, grid, write, headerWidth, colWidths);
  }

  const tally = tallyLine(matrix, metric);
  if (tally) write(`  ${c.dim}Conditions won: ${tally}${c.reset}\n`);
}

function printGrid(matrix, grid, write, headerWidth, colWidths) {
  const gap = ' '.repeat(COL_GAP);
  const header = matrix.columns.map((label, ci) => label.padEnd(colWidths[ci])).join(gap);
  write(`  ${c.dim}${matrix.rowHeader.padEnd(headerWidth)}${gap}${header}${c.reset}\n`);

  matrix.rows.forEach((row, ri) => {
    const height = Math.max(...grid[ri].map(lines => lines.length));
    for (let line = 0; line < height; line++) {
      const label = line === 0 ? row.header : '';
      const cells = grid[ri].map((lines, ci) => padColored(lines[line], colWidths[ci])).join(gap);
      write(`  ${c.bold}${label.padEnd(headerWidth)}${c.reset}${gap}${cells.trimEnd()}\n`);
    }
    if (ri < matrix.rows.length - 1) write('\n');
  });
}

function printStacked(matrix, grid, write) {
  matrix.rows.forEach((row, ri) => {
    row.cells.forEach((cell, ci) => {
      const heading = cell ? cell.title : `${row.header} · ${matrix.columns[ci]}`;
      write(`  ${c.bold}${heading}${c.reset}\n`);
      for (const line of grid[ri][ci]) write(`    ${line.colored}\n`);
    });
  });
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');


/** Racer colors match the per-condition player, so a cell reads the same after the click-through. */
const racerColor = index => RACER_CSS_COLORS[index % RACER_CSS_COLORS.length];

/** Verdict badge for one metric in one cell: winner, tie, or a placeholder. */
function verdictHtml(series) {
  if (series.winner) {
    const winner = series.racers.find(racer => racer.isWinner);
    const tint = winner ? ` style="--racer-color:${racerColor(winner.index)}"` : '';
    return `<span class="verdict"${tint}>${WIN_MEDAL} ${esc(series.winner)}</span>`;
  }
  if (series.isTie) return `<span class="verdict tie">${TIE_MEDAL} Tie</span>`;
  return `<span class="verdict none">${NO_DATA}</span>`;
}

/**
 * The per-metric blocks that share one container: exactly one is visible, and
 * the metric picker flips `hidden` between them. Rendering every metric up
 * front keeps all formatting in Node (one implementation, testable) and leaves
 * the page working with JavaScript disabled.
 */
function metricBlocks(metrics, renderOne) {
  return metrics.map((metric, i) =>
    `<span class="m" data-metric="${esc(metric.key)}"${i === 0 ? '' : ' hidden'}>${renderOne(metric)}</span>`
  ).join('');
}

function seriesHtml(series, max) {
  const rows = series.racers.map(racer => {
    const width = max > 0 && racer.value != null ? (racer.value / max) * 100 : 0;
    // Value and delta are separate columns, and the delta stays in the markup
    // even when empty (the winner has none) so the values below it still line up.
    const delta = racer.delta != null ? `+${esc(racer.delta)}` : '';
    return `<span class="r${racer.isWinner ? ' win' : ''}" style="--racer-color:${racerColor(racer.index)}">` +
      `<span class="n">${esc(racer.name)}</span>` +
      `<span class="bar"><i style="width:${width.toFixed(1)}%"></i></span>` +
      `<span class="t">${esc(racer.formatted || '-')}</span>` +
      `<span class="d">${delta}</span></span>`;
  }).join('');
  return `${verdictHtml(series)}<span class="times">${rows}</span>`;
}

function cellHtml(cell, matrix) {
  if (!cell) return `        <td class="empty">${NO_DATA}</td>`;
  const blocks = metricBlocks(matrix.metrics, metric =>
    seriesHtml(cell.metrics[metric.key], matrix.aggregates[metric.key].max));
  return `        <td><a href="${encodeURIComponent(cell.label)}/index.html" ` +
    `aria-label="${esc(cell.title)} — view results">${blocks}</a></td>`;
}

/** The metric picker: total time first, then the captured profile metrics by scope. */
function pickerHtml(metrics) {
  const scopes = uniqueInOrder(metrics.map(metric => metric.scope));
  const groups = scopes.map(scope => {
    const options = metrics.filter(metric => metric.scope === scope).map(metric =>
      `<option value="${esc(metric.key)}">${esc(metric.name)}</option>`).join('');
    return `<optgroup label="${esc(SCOPE_LABELS[scope] || scope)}">${options}</optgroup>`;
  }).join('');
  return `  <p class="pick"><label for="metric">Compare</label> <select id="metric">${groups}</select></p>`;
}

/**
 * The page's component rules. The palette lives in the shared tokens.css that
 * is inlined ahead of this block, so the overview and the per-condition players
 * it links to are one report rather than two tools — and a single `--skin`
 * themes both. Nothing here may hold a literal colour, font, radius or
 * duration; a test enforces that.
 */
const INDEX_CSS = `  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-ui); }
  .checkered-bar { height: var(--checker-size);
                   background: repeating-conic-gradient(var(--checker-color-a) 0% 25%, var(--checker-color-b) 0% 50%)
                               0 0 / var(--checker-size) var(--checker-size); }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 2rem var(--gutter) 3rem; }
  h1 { font-family: var(--font-display); font-size: var(--font-size-4xl); color: var(--accent);
       text-align: center; text-transform: uppercase; letter-spacing: var(--tracking-widest); margin: 0 0 0.5rem; }
  p.sub { text-align: center; color: var(--text-dim); font-size: var(--font-size-base); margin: 0 0 1.8rem; }

  p.pick { display: flex; align-items: center; justify-content: center; gap: 0.6rem; margin: 0 0 0.6rem; }
  p.pick label { color: var(--text-dim); font-size: var(--font-size-sm); text-transform: uppercase;
                 letter-spacing: var(--tracking-wide); }
  select { appearance: none; -webkit-appearance: none; font: inherit; font-size: var(--font-size-base); font-weight: bold;
           background: var(--surface) var(--select-arrow) no-repeat right 0.6rem center;
           color: var(--accent); border: var(--border-width) solid var(--border-strong); border-radius: var(--radius);
           padding: 0.35rem 1.8rem 0.35rem 0.7rem; cursor: pointer;
           transition: border-color var(--duration), background-color var(--duration); }
  select:hover { border-color: var(--accent); background-color: var(--surface-raised); }
  select:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
  p.desc { text-align: center; color: var(--text-faint); font-size: var(--font-size-base); line-height: var(--leading-loose);
           margin: 0 auto 2rem; max-width: 68ch; min-height: 1.2em; }

  .scroll { overflow-x: auto; }
  /* Cards keep a fixed, readable width instead of stretching with the viewport;
     a wide field overflows into .scroll rather than smearing the bars out. */
  table { border-collapse: separate; border-spacing: 0.5rem; margin: 0 auto; }
  th[scope="col"] { text-align: left; font-size: var(--font-size-xs); font-weight: normal; color: var(--text-subtle);
                    text-transform: uppercase; letter-spacing: var(--tracking-widest); padding: 0 0.7rem 0.3rem; }
  th[scope="row"] { text-align: right; vertical-align: middle; white-space: nowrap;
                    color: var(--accent); font-size: var(--font-size-base); letter-spacing: var(--tracking);
                    text-transform: uppercase; padding-right: 0.6rem; }
  td { vertical-align: top; padding: 0; }
  td.empty { color: var(--text-ghost); text-align: center; font-size: var(--font-size-md); }
  td a { display: block; width: 380px; max-width: 100%; padding: 0.7rem 0.85rem; background: var(--surface);
         border: var(--border-width) solid var(--border-subtle); border-radius: var(--radius-md);
         color: inherit; text-decoration: none;
         transition: background var(--duration), border-color var(--duration), transform var(--duration); }
  td a:hover { background: var(--surface-raised); border-color: var(--accent); transform: translateY(-1px); }
  td a:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }

  .m { display: block; }
  .m[hidden] { display: none; }
  /* The winner's racer colour arrives inline as --racer-color, the same
     property the player uses; a cell with no winner falls back to the accent. */
  .verdict { display: block; font-size: var(--font-size-md); font-weight: bold; letter-spacing: var(--tracking-tight);
             color: var(--racer-color, var(--accent));
             margin-bottom: 0.5rem; padding-bottom: 0.45rem; border-bottom: var(--border-width) solid var(--border-subtle);
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .verdict.tie { color: var(--text-dim); }
  .verdict.none { color: var(--text-ghost); }
  /* Fixed side columns, not auto: sized to content, every row is its own grid
     and the bars start and end wherever that row's name and time happen to
     end, so nothing lines up between rows or between cards. Monospace makes ch
     exact, and a name past the budget ellipsizes rather than shoving the bar. */
  .r { display: grid; grid-template-columns: 15ch 1fr 9ch 10ch; align-items: center;
       gap: 0.5rem; font-size: var(--font-size-xs); color: var(--text-subtle); padding: 0.12rem 0; }
  .n { color: var(--racer-color, currentcolor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r.win { color: var(--text); }
  .r.win .n { font-weight: bold; }
  /* Every racer keeps its own color; the winner's bar is the one at full strength. */
  .bar { height: 5px; border-radius: var(--radius-sm); background: var(--bg);
         box-shadow: inset 0 0 0 var(--border-width) var(--border-subtle); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: var(--radius-sm); background: var(--racer-color, var(--accent)); opacity: 0.5; }
  .r.win .bar i { opacity: 1; }
  .t { font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right;
       overflow: hidden; text-overflow: ellipsis; }
  .d { color: var(--text-ghost); font-variant-numeric: tabular-nums; white-space: nowrap;
       text-align: right; overflow: hidden; text-overflow: ellipsis; }
  p.tally { text-align: center; color: var(--text-subtle); font-size: var(--font-size-base); margin: 2rem 0 0; }

  @media (max-width: 600px) {
    .wrap { padding: 1.5rem 1rem 2rem; }
    h1 { font-size: var(--font-size-3xl); }
    td a { width: 250px; }
  }
  @media (prefers-reduced-motion: reduce) {
    td a { transition: none; }
    td a:hover { transform: none; }
  }`;

/**
 * Build the top-level index.html for a multi-condition race: a performance
 * matrix of every throttling condition, each cell linking to that condition's
 * own results player, with a picker to switch which metric the matrix compares.
 *
 * @param {string} raceTitle - e.g. "lauda vs hunt"
 * @param {Array<{label: string, title?: string, network?: string, cpu?: number,
 *                summary: object|null}>} entries
 * @param {object} [options]
 * @param {string} [options.skin] - skin name or .css path, as for the player
 * @param {string} [options.skinBaseDir] - directory a relative skin path resolves against
 * @returns {string} HTML document
 */
export function buildConditionIndexHtml(raceTitle, entries, options = {}) {
  const skin = resolveSkin(options.skin, options.skinBaseDir);
  const matrix = buildConditionMatrix(entries);
  const headerCells = matrix.columns.map(label => `<th scope="col">${esc(label)}</th>`).join('');
  const bodyRows = matrix.rows.map(row =>
    `      <tr>\n        <th scope="row">${esc(row.header)}</th>\n` +
    row.cells.map(cell => cellHtml(cell, matrix)).join('\n') +
    '\n      </tr>'
  ).join('\n');

  const descriptions = metricBlocks(matrix.metrics, metric => esc(metric.description || ''));
  const tallies = metricBlocks(matrix.metrics, metric => {
    const tally = tallyLine(matrix, metric.key);
    return tally ? `Conditions won: ${esc(tally)}` : '';
  });

  return `<!DOCTYPE html>
<html lang="en"${skin ? ` data-theme="${esc(skin.name)}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${skin ? esc(skin.themeColor) : DEFAULT_THEME_COLOR}">
<title>${esc(raceTitle)} — Race Conditions</title>
<style>
${TOKENS}
${INDEX_CSS}
</style>
${skin ? `<style id="rftp-skin">\n${skin.css}\n</style>` : ''}
</head>
<body>
<div class="checkered-bar"></div>
<div class="wrap">
  <h1>${esc(raceTitle)}</h1>
  <p class="sub">One race per throttling condition — pick a cell to view its results.</p>
${pickerHtml(matrix.metrics)}
  <p class="desc">${descriptions}</p>
  <div class="scroll">
    <table>
      <tr><th scope="col">${esc(matrix.rowHeader)}</th>${headerCells}</tr>
${bodyRows}
    </table>
  </div>
  <p class="tally">${tallies}</p>
</div>
<script>
  // Every metric is already rendered; switching just flips which one shows.
  var picker = document.getElementById('metric');
  function showSelectedMetric() {
    var blocks = document.querySelectorAll('.m[data-metric]');
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].hidden = blocks[i].getAttribute('data-metric') !== picker.value;
    }
  }
  picker.addEventListener('change', showSelectedMetric);
  // Browsers restore the previous selection on reload, so sync once at startup
  // rather than trusting the server-rendered default to still match.
  showSelectedMetric();
</script>
</body>
</html>
`;
}
