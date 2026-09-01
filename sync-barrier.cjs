/**
 * SyncBarrier — synchronization primitive for parallel browser execution.
 *
 * Blocks until `count` callers have called wait(), then releases all.
 * Used to synchronize browsers at key moments (ready, recording start, stop).
 *
 * Extracted from runner.cjs for testability and separation of concerns.
 */

const POLL_INTERVAL_MS = 100;
// Deadlock backstop: if a checkpoint hasn't gathered all callers within this
// window, something is wrong (e.g. racers with mismatched recordingStart/End
// counts, so one waiter has no partner). Rather than hang the whole runner
// forever with no way out but Ctrl+C, fail the barrier and let the normal
// error-teardown path release everyone. Generous so slow-but-legitimate
// checkpoints (heavy page loads before a sync point) are never tripped.
const BARRIER_TIMEOUT_MS = 300000;

class SyncBarrier {
  constructor(count, sharedState = null, timeoutMs = BARRIER_TIMEOUT_MS) {
    this.count = count;
    this.waiting = 0;
    this.resolvers = [];
    this.sharedState = sharedState;
    this.released = false;
    this.checkIntervals = [];
    this.timeoutMs = timeoutMs;
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
      const startedAt = Date.now();
      const check = setInterval(() => {
        const timedOut = this.timeoutMs > 0 && (Date.now() - startedAt) >= this.timeoutMs;
        if (timedOut) {
          if (this.sharedState && !this.sharedState.hasError) {
            // Signal the error so the other waiters and browser scripts unwind
            // instead of blocking indefinitely at their own checkpoints.
            this.sharedState.hasError = true;
            this.sharedState.errorMessage = this.sharedState.errorMessage
              || `Synchronization checkpoint${label ? ` "${label}"` : ''} timed out after ${this.timeoutMs}ms — racers are likely out of sync (mismatched recording segments?)`;
          }
          // Release the whole barrier, not just this waiter. Otherwise waiting/
          // resolvers stay stale and — when sharedState is absent — a later
          // waiter could wrongly satisfy `waiting >= count` and proceed.
          this.releaseAll();
          return;
        }
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
