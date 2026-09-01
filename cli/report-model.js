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
 * Build a target-independent cell model for one racer's value.
 * Returns { value, formatted, isWinner, delta }:
 * - formatted: formatted value string, or null when the value is missing
 * - delta: formatted (value - best) string WITHOUT the leading '+', or null
 *   when no delta applies (missing value, winner cell, or no best value)
 */
export function buildValueCell(value, best, isWinner, format) {
  if (value == null) return { value: null, formatted: null, isWinner: false, delta: null };
  const delta = !isWinner && best != null ? format(value - best) : null;
  return { value, formatted: format(value), isWinner, delta };
}

/** Duration-flavored buildValueCell. */
export function buildDurationCell(duration, bestDuration, isWinner) {
  return buildValueCell(duration, bestDuration, isWinner, formatDuration);
}

/**
 * Build duration cells (in racer order) for a measurement comparison.
 * The best duration is the declared winner's; ties against it still get a
 * "+0.000s" delta, matching historical behavior.
 */
export function buildComparisonCells(comp, racers) {
  const bestDur = comp.winner ? comp.racers[racers.indexOf(comp.winner)]?.duration : null;
  return racers.map((r, i) => buildDurationCell(comp.racers[i]?.duration, bestDur, comp.winner === r));
}

/**
 * Build cells for a row of raw values where the winner is the single lowest
 * value (first by racer order on exact ties). When fewer than two racers have
 * data, or all values are equal, no winner or deltas are flagged.
 * Used for profile-metric rows in run-by-run comparisons.
 */
export function buildBestOfCells(values, format) {
  const withData = values
    .map((v, j) => (v != null ? { j, v } : null))
    .filter(Boolean)
    .sort((a, b) => a.v - b.v);
  const best = withData.length >= 2 && withData[0].v !== withData[withData.length - 1].v
    ? withData[0].v
    : null;
  const winnerIdx = best != null ? withData[0].j : -1;
  return values.map((v, j) => buildValueCell(v, best, j === winnerIdx, format));
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
  return { cells: values.map(v => buildDurationCell(v, best, best != null && v === best)) };
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
  for (const entry of entries) {
    entry.delta = !isMissing(entry.val) && !isMissing(bestValue) && entry.val !== bestValue
      ? formatDelta(entry.val - bestValue)
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

  // --- Measurement tables ---
  const orderedNames = sortComparisonsForDisplay([...allComps.values()]).map(c => c.name);
  const measurements = orderedNames.map(name => {
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

    const avgDurations = racers.map((_, j) => {
      const vals = summaries
        .map(s => s.comparisons.find(c => c.name === name)?.racers[j]?.duration)
        .filter(d => d != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    const averageRow = buildAverageDurationRow(avgDurations);

    return { name, runRows, medianRow, averageRow };
  });

  // --- Profile metric tables ---
  const profileScopes = [];
  if (hasProfileData) {
    const metricsWithData = [];
    for (const [key, metric] of Object.entries(profileMetricDefs)) {
      const [scope, metricName] = key.split('.');
      const hasData = summaries.some(s =>
        racers.some((_, j) => s.profileMetrics?.[j]?.[scope]?.[metricName] != null)
      );
      if (hasData) metricsWithData.push({ metric, scope, metricName });
    }

    const scopes = [
      { scope: 'measured', title: 'Race' },
      { scope: 'total', title: 'Total Recording (Including Pre and Post race)' },
    ];
    for (const { scope: scopeName, title } of scopes) {
      const scopeMetrics = metricsWithData.filter(m => m.scope === scopeName);
      if (scopeMetrics.length === 0) continue;

      const metrics = scopeMetrics.map(({ metric, metricName }) => {
        const format = (v) => metric.format(v);

        const runRows = summaries.map((s, i) => ({
          label: String(i + 1),
          cells: buildBestOfCells(
            racers.map((_, j) => s.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null),
            format
          ),
        }));

        const medVals = racers.map((_, j) => medianSummary.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null);
        const medianRow = medVals.some(v => v != null)
          ? { cells: buildBestOfCells(medVals, format) }
          : null;

        const avgVals = racers.map((_, j) => {
          const vals = summaries
            .map(s => s.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null)
            .filter(v => v != null);
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
        const averageRow = avgVals.some(v => v != null)
          ? { cells: buildBestOfCells(avgVals, format) }
          : null;

        return { name: metric.name, runRows, medianRow, averageRow };
      });

      profileScopes.push({ scope: scopeName, title, metrics });
    }
  }

  return { isEmpty, measurements, profileScopes };
}
