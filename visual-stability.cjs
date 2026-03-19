/**
 * visual-stability.cjs — Polls browser performance counters until rendering settles.
 *
 * Used by page.raceWaitForVisualStability() in runner.cjs to wait for style
 * recalculations, layouts, and tasks to stop before ending a measurement.
 */

'use strict';

/**
 * Wait until performance counters stop changing for a configurable window.
 *
 * @param {() => Promise<{taskDuration: number, layoutCount: number, recalcStyleCount: number}>} getCounters
 *   Async function returning the current counter snapshot.
 * @param {object} [options]
 * @param {number} [options.stabilityWindow=300]  ms counters must be unchanged
 * @param {number} [options.timeout=5000]         max wait time in ms
 * @param {number} [options.pollInterval=50]      polling frequency in ms
 * @returns {Promise<{stable: boolean, elapsed: number}>}
 */
async function waitForStability(getCounters, options = {}) {
  const {
    stabilityWindow = 300,
    timeout = 5000,
    pollInterval = 50,
  } = options;

  const start = Date.now();
  let prev = await getCounters();
  let stableSince = Date.now();

  while (true) {
    const now = Date.now();
    const elapsed = now - start;
    if (elapsed >= timeout) {
      return { stable: false, elapsed };
    }

    await new Promise(r => setTimeout(r, pollInterval));

    const curr = await getCounters();
    const sampleTime = Date.now();
    const sampleElapsed = sampleTime - start;

    if (sampleElapsed >= timeout) {
      return { stable: false, elapsed: sampleElapsed };
    }

    if (
      curr.taskDuration !== prev.taskDuration ||
      curr.layoutCount !== prev.layoutCount ||
      curr.recalcStyleCount !== prev.recalcStyleCount
    ) {
      stableSince = sampleTime;
      prev = curr;
      continue;
    }

    if (sampleTime - stableSince >= stabilityWindow) {
      return { stable: true, elapsed: sampleElapsed };
    }
  }
}

module.exports = { waitForStability };
