/**
 * SyncBarrier — synchronization primitive for parallel browser execution.
 *
 * Blocks until `count` callers have called wait(), then releases all.
 * Used to synchronize browsers at key moments (ready, recording start, stop).
 *
 * Extracted from runner.cjs for testability and separation of concerns.
 */

const POLL_INTERVAL_MS = 100;

class SyncBarrier {
  /**
   * @param {number} count Number of wait() callers required to release.
   * @param {object|null} sharedState Cross-racer state; hasError aborts all waiters.
   * @param {object} [options]
   * @param {number} [options.timeoutMs] If > 0, a waiter left hanging this long
   *   (because another racer never reached the checkpoint — e.g. a pure-JS hang
   *   that Playwright's page timeout can't catch) sets sharedState.hasError and
   *   releases everyone with { aborted: true, timedOut: true } instead of
   *   deadlocking the whole runner.
   */
  constructor(count, sharedState = null, { timeoutMs = 0 } = {}) {
    this.count = count;
    this.waiting = 0;
    this.resolvers = [];
    this.sharedState = sharedState;
    this.released = false;
    this.timedOut = false;
    this.timeoutMs = timeoutMs;
    this.checkIntervals = [];
  }

  releaseAll() {
    if (this.released) return;
    this.released = true;
    // Clean up all polling intervals
    this.checkIntervals.forEach(clearInterval);
    this.checkIntervals = [];
    const result = this.timedOut ? { aborted: true, timedOut: true } : { aborted: true };
    this.resolvers.forEach(r => r(result));
    this.resolvers = [];
  }

  async wait(label = '') {
    if (this.released || this.sharedState?.hasError) {
      return this.timedOut ? { aborted: true, timedOut: true } : { aborted: true };
    }

    this.waiting++;
    if (this.waiting >= this.count) {
      // Clean up polling intervals from all waiters before resolving
      this.checkIntervals.forEach(clearInterval);
      this.checkIntervals = [];
      this.resolvers.forEach(r => r({ aborted: false }));
      this.waiting = 0;
      this.resolvers = [];
      return { aborted: false };
    }

    return new Promise(resolve => {
      let timer = null;
      const settle = (value) => {
        if (timer) { clearTimeout(timer); timer = null; }
        resolve(value);
      };
      this.resolvers.push(settle);

      if (this.timeoutMs > 0) {
        timer = setTimeout(() => {
          this.timedOut = true;
          if (this.sharedState) {
            this.sharedState.hasError = true;
            if (!this.sharedState.errorMessage) {
              this.sharedState.errorMessage =
                `Sync barrier${label ? ` "${label}"` : ''} timed out after ${this.timeoutMs}ms — another racer never reached this checkpoint`;
            }
          }
          console.error(`SyncBarrier timeout${label ? ` (${label})` : ''}: releasing all waiters after ${this.timeoutMs}ms`);
          this.releaseAll();
        }, this.timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }

      const check = setInterval(() => {
        if (this.sharedState?.hasError || this.released) {
          clearInterval(check);
          this.checkIntervals = this.checkIntervals.filter(i => i !== check);
          settle({ aborted: true });
        }
      }, POLL_INTERVAL_MS);
      this.checkIntervals.push(check);
    });
  }
}

module.exports = { SyncBarrier };
