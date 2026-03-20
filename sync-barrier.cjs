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
  constructor(count, sharedState = null) {
    this.count = count;
    this.waiting = 0;
    this.resolvers = [];
    this.sharedState = sharedState;
    this.released = false;
    this.checkIntervals = [];
  }

  releaseAll() {
    if (this.released) return;
    this.released = true;
    // Clean up all polling intervals
    this.checkIntervals.forEach(clearInterval);
    this.checkIntervals = [];
    this.resolvers.forEach(r => r({ aborted: true }));
    this.resolvers = [];
  }

  async wait(label = '') {
    if (this.released || this.sharedState?.hasError) return { aborted: true };

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
      this.resolvers.push(resolve);
      const check = setInterval(() => {
        if (this.sharedState?.hasError || this.released) {
          clearInterval(check);
          this.checkIntervals = this.checkIntervals.filter(i => i !== check);
          resolve({ aborted: true });
        }
      }, POLL_INTERVAL_MS);
      this.checkIntervals.push(check);
    });
  }
}

module.exports = { SyncBarrier };
