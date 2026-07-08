/**
 * Shared race utility functions used across summary and profile-analysis modules.
 */

/**
 * Determine overall winner from win counts.
 *
 * The verdict is purely win-count based: the racer that wins the most
 * comparisons wins overall; equal top counts (including nobody winning any
 * comparison) is a 'tie'. "How close is close enough to count as a win" is
 * decided per-comparison by the caller (an exact-tie guard for timing sections,
 * per-metric significance thresholds for profile metrics), so there is no
 * additional averaged-percentage threshold here — that only double-counted the
 * same signal and every caller disabled it.
 *
 * @param {Object} wins - Object mapping racer names to win counts
 * @param {string[]} racerNames - Array of racer names
 * @param {Array} comparisons - Array of comparison objects
 * @returns {string|null} Racer name, 'tie', or null (no comparisons)
 */
export function determineOverallWinner(wins, racerNames, comparisons) {
  if (comparisons.length === 0) return null;

  const maxWins = Math.max(...racerNames.map(n => wins[n]));
  const winnersWithMax = racerNames.filter(n => wins[n] === maxWins);
  if (winnersWithMax.length === 1) return winnersWithMax[0];
  if (maxWins === 0) return null;
  return 'tie';
}
