/* eslint-env browser */
/**
 * metrics-csv.cjs — Pure metrics.csv builder for the performance data export:
 * flattens race timings and profile metrics from summary.json into one CSV
 * table (raw values, one column per racer).
 *
 * DOM independent so Node can require() it for unit tests; in the browser
 * build the guarded module.exports is a no-op.
 */

// Quote a CSV cell when it contains a comma, quote, or newline.
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

// Profile comparisons from summary.json: current summaries carry a combined
// top-level array; older ones may only have the per-scope sections, so fall
// back to flattening measured/total with the scope filled in from the section.
function profileComparisons(profileComparison) {
  const pc = profileComparison || {};
  if (Array.isArray(pc.comparisons)) return pc.comparisons;
  const scoped = (scope, comps) => (comps || []).map(c => ({ scope, ...c }));
  return [
    ...scoped('measured', pc.measured?.comparisons),
    ...scoped('total', pc.total?.comparisons),
  ];
}

// Build the metrics.csv content from parsed summary.json data, or null when
// there are no metrics. fallbackRacers names the columns when the summary
// carries no racers array of its own.
function buildMetricsCsv(summaryData, fallbackRacers) {
  const racers = summaryData.racers || fallbackRacers || [];
  const rows = [['scope', 'category', 'metric', ...racers, 'winner', 'diff_percent']];
  for (const comp of (summaryData.comparisons || [])) {
    rows.push([
      'race', 'timing', comp.name + ' (s)',
      ...racers.map((_, i) => comp.racers && comp.racers[i] ? comp.racers[i].duration : ''),
      comp.winner || '',
      comp.diffPercent != null ? comp.diffPercent.toFixed(1) : '',
    ]);
  }
  for (const comp of profileComparisons(summaryData.profileComparison)) {
    rows.push([
      comp.scope || '', comp.category || '', comp.name,
      ...racers.map((_, i) => comp.values && comp.values[i] != null ? comp.values[i] : ''),
      comp.winner || '',
      comp.diffPercent != null ? comp.diffPercent.toFixed(1) : '',
    ]);
  }
  if (rows.length === 1) return null;
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { csvCell, buildMetricsCsv };
}
