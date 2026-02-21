/**
 * Shared race utility functions used across summary and profile-analysis modules.
 */

/**
 * Determine overall winner from win counts.
 * @param {Object} wins - Object mapping racer names to win counts (e.g. { react: 2, angular: 1 })
 * @param {string[]} racerNames - Array of racer names
 * @param {Array} comparisons - Array of comparison objects (used only to check if any data exists)
 * @returns {string|null} Racer name, 'tie', or null (no data)
 */
export function determineOverallWinner(wins, racerNames, comparisons) {
  if (comparisons.length === 0) return null;
  const maxWins = Math.max(...racerNames.map(n => wins[n]));
  const winnersWithMax = racerNames.filter(n => wins[n] === maxWins);
  if (winnersWithMax.length === 1) return winnersWithMax[0];
  if (maxWins === 0) return null;
  return 'tie';
}
