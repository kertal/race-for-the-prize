/**
 * report-model.js — Shared, target-independent computation for race reports.
 *
 * The same comparison data is rendered by three emitters: Markdown
 * (summary.js), HTML (player-sections.js), and the terminal
 * (summary.js / profile-analysis.js). This module owns the computation they
 * share — display ordering, synthetic-total detection, winner/best flags,
 * deltas, median/average rows, and target-independent value formatting — and
 * returns plain data structures. Emitters only decorate cells with
 * target-specific markup (bold, `<td>`, ANSI colors, trophies).
 *
 * This module is pure and dependency-free: metric definitions
 * (PROFILE_METRICS) are passed in by callers rather than imported, so
 * profile-analysis.js can consume this module without an import cycle.
 */

// ---------------------------------------------------------------------------
// Synthetic-total helpers and display ordering
// ---------------------------------------------------------------------------

/** True if the comparison is the synthetic all-sections total. */
export function isSyntheticTotal(comp) {
  return comp?.isSyntheticTotal === true;
}

/** Comparisons excluding the synthetic all-sections total. */
export function getSectionComparisons(comparisons) {
  return comparisons.filter(comp => !isSyntheticTotal(comp));
}

/** Order comparisons for display: synthetic total first, then original order. */
export function sortComparisonsForDisplay(comparisons) {
  return [...comparisons].sort((a, b) => {
    const aIsTotal = isSyntheticTotal(a);
    const bIsTotal = isSyntheticTotal(b);
    if (aIsTotal && !bIsTotal) return -1;
    if (!aIsTotal && bIsTotal) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Value formatting and cell model
// ---------------------------------------------------------------------------

/** Format a duration in seconds, e.g. 1.234s. */
export function formatDuration(dur) {
  return `${dur.toFixed(3)}s`;
}

/**
 * How far a value sits from the best one, as a percentage of the best:
 * 1.5 against 1.0 is "50%", 1.023 against 1.0 is "2.3%". The string carries
 * no sign. Null when either value is missing or the best is not positive —
 * "x% of nothing" says nothing, and 0 is exactly where a best metric value
 * can land (no layout shift, no requests).
 */
export function formatRelativeDelta(value, best) {
  if (value == null || best == null || !(best > 0)) return null;
  const percent = ((value - best) / best) * 100;
  const magnitude = Math.abs(percent);
  const digits = magnitude < 10 ? 1 : 0;
  return `${percent.toFixed(digits)}%`;
}

/**
 * The label every emitter prints beside a losing value, e.g. "+1.500s, +150%":
 * the absolute gap to the winner and, when the model could work one out, the
 * relative gap beside it. Null when there is no delta to label.
 */
export function formatDeltaLabel(delta, relative) {
  if (delta == null) return null;
  return relative != null ? `+${delta}, +${relative}` : `+${delta}`;
}

/**
 * How much better the winning value is than the runner-up, as a percentage of
 * the runner-up: 1.0s against 2.5s is "60.0%" — the winner needed 60% less
 * than the next racer did. This is the mirror of formatRelativeDelta, which
 * measures the same gap against the WINNER ("+150%"); both are true, and the
 * labels say which side they are counted from.
 * Null when there is no runner-up, when it is not positive, or when it does
 * not actually trail the winner (a dead heat is nobody being better).
 */
export function formatWinnerAdvantage(best, runnerUp) {
  if (best == null || runnerUp == null || !(runnerUp > 0) || !(runnerUp > best)) return null;
  const percent = ((runnerUp - best) / runnerUp) * 100;
  const digits = percent < 10 ? 1 : 0;
  return `${percent.toFixed(digits)}%`;
}

/**
 * The label every emitter prints beside the winning value, e.g. "60.0% ahead".
 * "ahead" rather than "faster" because the same cell model carries bytes,
 * request counts and layout shift, none of which have a speed.
 * Null when there is no advantage to label.
 */
export function formatAdvantageLabel(advantage) {
  return advantage != null ? `${advantage} ahead` : null;
}

/**
 * The second-lowest value present — what the winner actually beat. Null when
 * fewer than two racers have a value. A tie for the lead returns the tied
 * value, which formatWinnerAdvantage then reads as "no advantage".
 */
function secondLowest(values) {
  const present = values.filter(v => v != null).sort((a, b) => a - b);
  return present.length >= 2 ? present[1] : null;
}

/**
 * The formatter to use for a metric's *difference* rather than its value.
 *
 * Most metrics use one function for both, but a value formatter is free to
 * annotate — a frame time reads better as "16.7ms (60fps)". That annotation is
 * nonsense on a delta (a 2.9ms gap is not "345fps"), so such a metric declares
 * a plain `formatDelta` and every delta goes through this.
 */
export function metricDeltaFormat(metric) {
  return metric.formatDelta || metric.format;
}

/**
 * Build a target-independent cell model for one racer's value.
 * Returns { value, formatted, isWinner, delta, relative, advantage }:
 * - formatted: formatted value string, or null when the value is missing
 * - delta: formatted (value - best) string WITHOUT the leading '+', or null
 *   when no delta applies (missing value, winner cell, or no best value)
 * - relative: the same gap as a percentage of the best (see
 *   formatRelativeDelta), or null whenever delta is null or best is not > 0
 * - advantage: on the winner cell only, how far it sits ahead of runnerUp (see
 *   formatWinnerAdvantage); null on losing cells and on a tied lead
 */
export function buildValueCell(value, best, isWinner, format, runnerUp = null, formatDelta = format) {
  if (value == null) return { value: null, formatted: null, isWinner: false, delta: null, relative: null, advantage: null };
  const hasDelta = !isWinner && best != null;
  const delta = hasDelta ? formatDelta(value - best) : null;
  const relative = hasDelta ? formatRelativeDelta(value, best) : null;
  const advantage = isWinner ? formatWinnerAdvantage(value, runnerUp) : null;
  return { value, formatted: format(value), isWinner, delta, relative, advantage };
}

/** Duration-flavored buildValueCell. */
export function buildDurationCell(duration, bestDuration, isWinner, runnerUp = null) {
  return buildValueCell(duration, bestDuration, isWinner, formatDuration, runnerUp);
}

/**
 * Build duration cells (in racer order) for a measurement comparison.
 * The best duration is the declared winner's; ties against it still get a
 * "+0.000s" delta, matching historical behavior.
 */
export function buildComparisonCells(comp, racers) {
  const durations = racers.map((_, i) => comp.racers[i]?.duration ?? null);
  const bestDur = comp.winner ? durations[racers.indexOf(comp.winner)] : null;
  const runnerUp = secondLowest(durations);
  return racers.map((r, i) => buildDurationCell(durations[i], bestDur, comp.winner === r, runnerUp));
}

/**
 * Build cells for a row of raw values where the winner is the single lowest
 * value (first by racer order on exact ties). When fewer than two racers have
 * data, or all values are equal, no winner or deltas are flagged.
 * Used for profile-metric rows in run-by-run comparisons.
 */
export function buildBestOfCells(values, format, formatDelta = format) {
  const withData = values
    .map((v, j) => (v != null ? { j, v } : null))
    .filter(Boolean)
    .sort((a, b) => a.v - b.v);
  const best = withData.length >= 2 && withData[0].v !== withData[withData.length - 1].v
    ? withData[0].v
    : null;
  const winnerIdx = best != null ? withData[0].j : -1;
  const runnerUp = withData.length >= 2 ? withData[1].v : null;
  return values.map((v, j) => buildValueCell(v, best, j === winnerIdx, format, runnerUp, formatDelta));
}

/**
 * Build cells for a row of averaged durations: every racer matching the best
 * (lowest) value is flagged as a winner. Requires at least two racers with
 * data for a best value to exist. Returns null when no racer has data.
 */
function buildAverageDurationRow(values) {
  if (!values.some(v => v != null)) return null;
  const valid = values.filter(v => v != null);
  const best = valid.length >= 2 ? Math.min(...valid) : null;
  const runnerUp = secondLowest(values);
  return { cells: values.map(v => buildDurationCell(v, best, best != null && v === best, runnerUp)) };
}

// ---------------------------------------------------------------------------
// Ranked entries (bar-style renderings)
// ---------------------------------------------------------------------------

/**
 * Rank racers by value ascending (best first), nulls last.
 * getEntry(i) must return at least { val, ... }; extra fields (e.g. formatted)
 * are carried through. Each entry additionally gets:
 * - delta: formatted (val - bestValue) string WITHOUT the leading '+', or
 *   null when the entry has no value, there is no best, or it IS the best.
 * - relative: that gap as a percentage of the best (formatRelativeDelta), or
 *   null whenever delta is null or the best is not > 0.
 * - advantage: on the best entry only, how far it sits ahead of the runner-up
 *   (formatWinnerAdvantage); null on every other entry and on a tied lead.
 * Returns { entries, bestValue, maxValue } where maxValue is the largest
 * non-null value (0 if none) — for bar scaling.
 */
export function rankEntries(racers, getEntry, formatDelta) {
  // `== null` deliberately covers undefined as well as null: a missing value
  // must sort last, not fall through to `undefined - x` (NaN) comparisons.
  const isMissing = (v) => v == null;
  const entries = racers
    .map((name, i) => ({ name, index: i, ...getEntry(i) }))
    .sort((a, b) => {
      const aMissing = isMissing(a.val);
      const bMissing = isMissing(b.val);
      // Both missing must compare equal — returning a non-zero value for a pair
      // that is equal breaks the comparator contract and makes the ordering of
      // valueless racers engine-dependent.
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return a.val - b.val;
    });
  const presentVals = entries.filter(e => !isMissing(e.val)).map(e => e.val);
  const maxValue = presentVals.length > 0 ? Math.max(...presentVals) : 0;
  const bestValue = entries[0]?.val;
  const runnerUp = secondLowest(presentVals);
  for (const entry of entries) {
    const hasDelta = !isMissing(entry.val) && !isMissing(bestValue) && entry.val !== bestValue;
    entry.delta = hasDelta ? formatDelta(entry.val - bestValue) : null;
    entry.relative = hasDelta ? formatRelativeDelta(entry.val, bestValue) : null;
    // The lead is the best racer's alone; a tie for it resolves to null inside
    // formatWinnerAdvantage, so both tied racers correctly show nothing.
    entry.advantage = !isMissing(entry.val) && entry.val === bestValue
      ? formatWinnerAdvantage(bestValue, runnerUp)
      : null;
  }
  return { entries, bestValue, maxValue };
}

/** Rank a measurement comparison's racers by duration (formatted, '-' for missing). */
export function rankComparisonDurations(comp, racers) {
  return rankEntries(racers, i => {
    const r = comp.racers[i];
    return { val: r ? r.duration : null, formatted: r ? formatDuration(r.duration) : '-' };
  }, formatDuration);
}

// ---------------------------------------------------------------------------
// Results table model
// ---------------------------------------------------------------------------

/**
 * Model for the results table / section list.
 * Returns { rows, sectionCount } where each row is
 * { name, isTotal, winner, cells, ranking }:
 * - cells: duration cells in racer order (winner-relative deltas)
 * - ranking: rankEntries() result ordered best-first (best-relative deltas)
 * - sectionCount: number of non-total comparisons (for expand-single-section)
 */
export function buildResultsModel(comparisons, racers) {
  const displayComparisons = sortComparisonsForDisplay(comparisons);
  const sectionCount = displayComparisons.filter(comp => !isSyntheticTotal(comp)).length;
  const rows = displayComparisons.map(comp => ({
    name: comp.name,
    isTotal: isSyntheticTotal(comp),
    winner: comp.winner,
    cells: buildComparisonCells(comp, racers),
    ranking: rankComparisonDurations(comp, racers),
  }));
  return { rows, sectionCount };
}

// ---------------------------------------------------------------------------
// Run-by-run comparison model
// ---------------------------------------------------------------------------

/**
 * Model for the run-by-run comparison section (multi-run races).
 *
 * @param {Object[]} summaries - Per-run summaries
 * @param {Object} medianSummary - Median summary across runs
 * @param {string[]} racers - Racer names
 * @param {Object} profileMetricDefs - PROFILE_METRICS map ("scope.metric" keys)
 * @returns {{
 *   isEmpty: boolean,
 *   measurements: Array<{ name, runRows, medianRow, averageRow }>,
 *   profileScopes: Array<{ scope, title, metrics: Array<{ name, runRows, medianRow, averageRow }> }>
 * }}
 * Each runRow is { label, cells }; medianRow/averageRow are { cells } or null
 * (median: absent from the median summary; average: no racer has data).
 */
// Mean of the non-null values, or null when there are none.
function averageOf(vals) {
  const present = vals.filter(v => v != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

// Per-run / median / average rows for one measurement (comparison) name.
function buildMeasurementModel(name, summaries, medianSummary, racers) {
  const runRows = summaries.map((s, i) => {
    const comp = s.comparisons.find(c => c.name === name);
    return {
      label: String(i + 1),
      cells: comp
        ? buildComparisonCells(comp, racers)
        : racers.map(() => buildDurationCell(null, null, false)),
    };
  });

  const medComp = medianSummary.comparisons.find(c => c.name === name);
  const medianRow = medComp ? { cells: buildComparisonCells(medComp, racers) } : null;

  const avgDurations = racers.map((_, j) =>
    averageOf(summaries.map(s => s.comparisons.find(c => c.name === name)?.racers[j]?.duration ?? null)));

  return { name, runRows, medianRow, averageRow: buildAverageDurationRow(avgDurations) };
}

// Per-run / median / average rows for one profile metric within a scope.
function buildProfileMetricModel(metric, scopeName, metricName, summaries, medianSummary, racers) {
  const format = (v) => metric.format(v);
  // A frame-time gap must not be annotated with a frame rate here either; the
  // run-by-run tables format deltas through the same rule as every other view.
  const deltaFormat = metricDeltaFormat(metric);
  const formatDelta = (v) => deltaFormat(v);
  const valueAt = (s, j) => s.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null;

  const runRows = summaries.map((s, i) => ({
    label: String(i + 1),
    cells: buildBestOfCells(racers.map((_, j) => valueAt(s, j)), format, formatDelta),
  }));

  const medVals = racers.map((_, j) => valueAt(medianSummary, j));
  const medianRow = medVals.some(v => v != null) ? { cells: buildBestOfCells(medVals, format, formatDelta) } : null;

  const avgVals = racers.map((_, j) => averageOf(summaries.map(s => valueAt(s, j))));
  const averageRow = avgVals.some(v => v != null) ? { cells: buildBestOfCells(avgVals, format, formatDelta) } : null;

  return { name: metric.name, runRows, medianRow, averageRow };
}

// Profile metric tables grouped by scope (race vs. total recording).
function buildProfileScopes(summaries, medianSummary, racers, profileMetricDefs) {
  const metricsWithData = [];
  for (const [key, metric] of Object.entries(profileMetricDefs)) {
    const [scope, metricName] = key.split('.');
    const hasData = summaries.some(s => racers.some((_, j) => s.profileMetrics?.[j]?.[scope]?.[metricName] != null));
    if (hasData) metricsWithData.push({ metric, scope, metricName });
  }

  const scopes = [
    { scope: 'measured', title: 'Race' },
    { scope: 'total', title: 'Total Recording (Including Pre and Post race)' },
  ];
  const profileScopes = [];
  for (const { scope: scopeName, title } of scopes) {
    const scopeMetrics = metricsWithData.filter(m => m.scope === scopeName);
    if (scopeMetrics.length === 0) continue;
    const metrics = scopeMetrics.map(({ metric, metricName }) =>
      buildProfileMetricModel(metric, scopeName, metricName, summaries, medianSummary, racers));
    profileScopes.push({ scope: scopeName, title, metrics });
  }
  return profileScopes;
}

export function buildRunComparisonModel(summaries, medianSummary, racers, profileMetricDefs) {
  // Keep each name's synthetic-total flag: sortComparisonsForDisplay decides
  // order from it, so mapping names to bare { name } objects (as this did
  // before) silently made the sort a no-op and left the total last, in Set
  // insertion order, instead of first as in the results table.
  const allComps = new Map();
  for (const s of summaries) {
    for (const c of s.comparisons) {
      if (!allComps.has(c.name)) allComps.set(c.name, { name: c.name, isSyntheticTotal: c.isSyntheticTotal });
    }
  }
  const allNames = new Set(allComps.keys());
  const hasProfileData = summaries.some(s => s.profileMetrics?.some(Boolean));
  const isEmpty = allNames.size === 0 && !hasProfileData;

  const orderedNames = sortComparisonsForDisplay([...allComps.values()]).map(c => c.name);
  const measurements = orderedNames.map(name => buildMeasurementModel(name, summaries, medianSummary, racers));

  const profileScopes = hasProfileData
    ? buildProfileScopes(summaries, medianSummary, racers, profileMetricDefs)
    : [];

  return { isEmpty, measurements, profileScopes };
}
