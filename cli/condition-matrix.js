/**
 * condition-matrix.js — cross-condition overview for multi-condition races.
 *
 * When --network and/or --cpu name more than one value, every combination is
 * raced separately. Each condition gets its own results directory and report,
 * which answers "who won under slow-3g at 4x CPU?" but not "how does the field
 * hold up as conditions get harder?". This module builds that overview: a
 * matrix with network presets down the side, CPU rates across the top, and
 * every racer's total time in each cell.
 *
 * Layout follows the varying dimensions: a two-dimensional race gets the full
 * grid, a one-dimensional race collapses to a single column, and entries that
 * carry no network/cpu (older callers, hand-built lists) fall back to one row
 * per condition. Rendering is split the same way the rest of the reports are:
 * buildConditionMatrix() computes a plain data model, and the terminal and HTML
 * emitters below only decorate it.
 */

import { c, RACER_COLORS } from './colors.js';
import { sortComparisonsForDisplay, rankEntries, formatDuration } from './report-model.js';

const WIN_MEDAL = '🏆';
const TIE_MEDAL = '🤝';
// Same display width as the medals, so unmedalled lines stay aligned under them.
const NO_MEDAL = '  ';
const NO_DATA = '—';
const COL_GAP = 2;

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

/** One condition's cell: its verdict plus every racer's total time, best first. */
function buildCell(entry, racers) {
  const comp = overallComparison(entry.summary);
  // 'tie' is a sentinel, not a racer name — keep it out of the winner field.
  const overallWinner = entry.summary?.overallWinner ?? null;
  const winner = overallWinner === 'tie' ? null : overallWinner;

  // A comparison's racers are positional, indexed by its own summary's racer
  // order — which is the matrix order in practice, but resolve by name so a
  // condition that lists its racers differently still lands in the right cell.
  const own = entry.summary?.racers;
  const durationOf = (name) => {
    const i = own ? own.indexOf(name) : racers.indexOf(name);
    return i >= 0 ? comp?.racers?.[i]?.duration ?? null : null;
  };

  const { entries: ranked, bestValue, maxValue } = rankEntries(
    racers,
    i => ({ val: durationOf(racers[i]) }),
    formatDuration
  );

  return {
    label: entry.label,
    title: entry.title || entry.label,
    network: entry.network,
    cpu: entry.cpu,
    winner,
    isTie: overallWinner === 'tie',
    best: bestValue ?? null,
    max: maxValue,
    racers: ranked.map(racer => ({
      name: racer.name,
      index: racer.index,
      duration: racer.val ?? null,
      formatted: racer.val != null ? formatDuration(racer.val) : null,
      delta: racer.delta,
      isWinner: racer.name === winner,
    })),
  };
}

/**
 * Build the overview model for a list of condition results.
 *
 * @param {Array<{label: string, title?: string, network?: string, cpu?: number,
 *                summary: object|null}>} entries
 * @returns {{
 *   racers: string[], rowHeader: string, columns: string[],
 *   rows: Array<{header: string, cells: Array<object|null>}>,
 *   cells: object[], wins: Record<string, number>, ties: number, maxDuration: number
 * }}
 */
export function buildConditionMatrix(entries) {
  const racers = collectRacers(entries);
  const cells = entries.map(entry => buildCell(entry, racers));
  const networks = uniqueInOrder(cells.map(cell => cell.network));
  const cpus = uniqueInOrder(cells.map(cell => cell.cpu));

  // A full grid needs both coordinates on every condition and no gaps or
  // duplicates; anything else lists one condition per row instead.
  const isGrid = cells.every(cell => cell.network != null && cell.cpu != null)
    && networks.length * cpus.length === cells.length;

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

  return {
    racers,
    rowHeader,
    columns,
    rows,
    cells,
    wins: Object.fromEntries(racers.map(name => [name, cells.filter(cell => cell.winner === name).length])),
    ties: cells.filter(cell => cell.isTie).length,
    maxDuration: Math.max(0, ...cells.map(cell => cell.max || 0)),
  };
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

/**
 * Render one cell as aligned lines. Each line carries both its plain text (for
 * width math — ANSI escapes would otherwise inflate every padding calculation)
 * and its colored form.
 */
function cellLines(cell, nameWidth, timeWidth) {
  if (!cell) return [{ plain: NO_DATA, colored: `${c.dim}${NO_DATA}${c.reset}` }];
  if (cell.racers.length === 0) return [{ plain: NO_DATA, colored: `${c.dim}${NO_DATA}${c.reset}` }];

  return cell.racers.map((racer, i) => {
    // A tie has no winner to crown, so the medal marks the row the tie is about.
    let medal = NO_MEDAL;
    if (racer.isWinner) medal = WIN_MEDAL;
    else if (cell.isTie && i === 0) medal = TIE_MEDAL;

    const name = racer.name.padEnd(nameWidth);
    const time = (racer.formatted || '-').padStart(timeWidth);
    const color = RACER_COLORS[racer.index % RACER_COLORS.length];
    return {
      plain: `${medal} ${name} ${time}`,
      colored: `${medal} ${color}${c.bold}${name}${c.reset} ${time}`,
    };
  });
}

/** Pad an already-colored string to a visible width using its plain length. */
function padColored(line, width) {
  return line ? line.colored + ' '.repeat(Math.max(0, width - line.plain.length)) : ' '.repeat(width);
}

/** Wins-per-racer tally, e.g. "lauda 2 · hunt 1 · 1 tie". */
function tallyLine(matrix) {
  const parts = matrix.racers
    .filter(name => matrix.wins[name] > 0)
    .map(name => `${name} ${matrix.wins[name]}`);
  if (matrix.ties > 0) parts.push(`${matrix.ties} ${matrix.ties === 1 ? 'tie' : 'ties'}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Print the matrix to stderr (where all race progress output goes).
 * Falls back to a stacked, one-condition-per-block layout when the grid would
 * be wider than the terminal — a wrapped matrix is worse than no matrix.
 */
export function printConditionMatrix(matrix, write = s => process.stderr.write(s), width = process.stderr.columns || 100) {
  if (!matrix || matrix.rows.length === 0) return;

  const nameWidth = Math.max(0, ...matrix.racers.map(name => name.length));
  const timeWidth = Math.max(1, ...matrix.cells.flatMap(cell => cell.racers.map(r => (r.formatted || '-').length)));
  const grid = matrix.rows.map(row => row.cells.map(cell => cellLines(cell, nameWidth, timeWidth)));

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

  const tally = tallyLine(matrix);
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

/** Verdict badge for a cell: winner, tie, or a placeholder. */
function verdictHtml(cell) {
  if (cell.winner) return `${WIN_MEDAL} ${esc(cell.winner)}`;
  if (cell.isTie) return `${TIE_MEDAL} Tie`;
  return NO_DATA;
}

function cellHtml(cell, maxDuration) {
  if (!cell) return `        <td class="empty">${NO_DATA}</td>`;
  const times = cell.racers.map(racer => {
    const width = maxDuration > 0 && racer.duration != null ? (racer.duration / maxDuration) * 100 : 0;
    const time = racer.formatted || '-';
    const delta = racer.delta != null ? `<span class="d">+${esc(racer.delta)}</span>` : '';
    return `<span class="r${racer.isWinner ? ' win' : ''}">` +
      `<span class="n">${esc(racer.name)}</span>` +
      `<span class="bar"><i style="width:${width.toFixed(1)}%"></i></span>` +
      `<span class="t">${esc(time)}${delta}</span></span>`;
  }).join('');
  return `        <td><a href="${encodeURIComponent(cell.label)}/index.html" aria-label="${esc(cell.title)} — view results">` +
    `<span class="verdict">${verdictHtml(cell)}</span><span class="times">${times}</span></a></td>`;
}

/**
 * Build the top-level index.html for a multi-condition race: a performance
 * matrix of every throttling condition, each cell linking to that condition's
 * own results player.
 *
 * @param {string} raceTitle - e.g. "lauda vs hunt"
 * @param {Array<{label: string, title?: string, network?: string, cpu?: number,
 *                summary: object|null}>} entries
 * @returns {string} HTML document
 */
export function buildConditionIndexHtml(raceTitle, entries) {
  const matrix = buildConditionMatrix(entries);
  const headerCells = matrix.columns.map(label => `<th scope="col">${esc(label)}</th>`).join('');
  const bodyRows = matrix.rows.map(row =>
    `      <tr>\n        <th scope="row">${esc(row.header)}</th>\n` +
    row.cells.map(cell => cellHtml(cell, matrix.maxDuration)).join('\n') +
    '\n      </tr>'
  ).join('\n');
  const tally = tallyLine(matrix);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(raceTitle)} — Race Conditions</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; margin: 0; padding: 40px 20px; }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.4em; margin-bottom: 4px; }
  p.sub { color: #999; margin-top: 0; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 0.85em; color: #aaa; font-weight: 600; padding: 6px 10px; }
  th[scope="col"] { letter-spacing: 0.04em; }
  th[scope="row"] { color: #eee; white-space: nowrap; vertical-align: middle; }
  td { padding: 4px; vertical-align: top; }
  td.empty { color: #666; text-align: center; }
  td a { display: block; padding: 10px 12px; background: #23233b; border: 1px solid #33335a;
         border-radius: 8px; color: #eee; text-decoration: none; min-width: 190px; }
  td a:hover { border-color: #6c6cd8; }
  .verdict { display: block; font-weight: 600; margin-bottom: 6px; }
  .r { display: grid; grid-template-columns: minmax(52px, auto) 1fr auto; align-items: center;
       gap: 8px; font-size: 0.85em; color: #bbb; padding: 1px 0; }
  .r.win { color: #eee; font-weight: 600; }
  .bar { background: #1a1a2e; border-radius: 3px; height: 6px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: #6c6cd8; }
  .r.win .bar i { background: #f0c419; }
  .t { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .d { color: #888; margin-left: 4px; font-weight: 400; }
  p.tally { color: #999; font-size: 0.9em; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(raceTitle)}</h1>
  <p class="sub">One race per throttling condition — pick a cell to view its results.</p>
  <div class="scroll">
    <table>
      <tr><th scope="col">${esc(matrix.rowHeader)}</th>${headerCells}</tr>
${bodyRows}
    </table>
  </div>
${tally ? `  <p class="tally">Conditions won: ${esc(tally)}</p>\n` : ''}</div>
</body>
</html>
`;
}
