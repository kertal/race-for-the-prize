/**
 * Shared race utility functions used across summary and profile-analysis modules.
 */

// Performance differences below this percentage are considered too close to declare a winner.
export const DRAW_THRESHOLD_PERCENT = 5;

/**
 * Determine overall winner from win counts.
 * Returns 'tie' when the average performance difference is within DRAW_THRESHOLD_PERCENT,
 * 'tie' when win counts are equal, the winner name, or null (no data).
 * @param {Object} wins - Object mapping racer names to win counts
 * @param {string[]} racerNames - Array of racer names
 * @param {Array} comparisons - Array of comparison objects with diffPercent values
 * @param {number} drawThresholdPercent - Minimum % difference required to declare a winner
 * @returns {string|null} Racer name, 'tie', or null
 */
export function determineOverallWinner(wins, racerNames, comparisons, drawThresholdPercent = DRAW_THRESHOLD_PERCENT) {
  if (comparisons.length === 0) return null;

  const competitiveComps = comparisons.filter(c => c.diffPercent != null);
  if (competitiveComps.length > 0) {
    const avgDiffPercent = competitiveComps.reduce((sum, c) => sum + c.diffPercent, 0) / competitiveComps.length;
    if (avgDiffPercent < drawThresholdPercent) return 'tie';
  }

  const maxWins = Math.max(...racerNames.map(n => wins[n]));
  const winnersWithMax = racerNames.filter(n => wins[n] === maxWins);
  if (winnersWithMax.length === 1) return winnersWithMax[0];
  if (maxWins === 0) return null;
  return 'tie';
}
