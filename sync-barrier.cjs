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

/**
 * The deadline argument is either a number of milliseconds or an options
 * object `{ timeoutMs }` (`{}` takes the default). Anything else is a caller
 * bug: an object compared with `> 0` is NaN-false, which would silently
 * disable the backstop, so it throws instead. An array, or an object carrying
 * any other key, is a misspelled or misplaced option rather than a deadline —
 * reading a default out of it would hide the same mistake.
 */
function resolveTimeoutMs(timeout) {
  const reject = () => {
    throw new TypeError(
      `SyncBarrier timeout must be a non-negative number of ms, or { timeoutMs }, got ${JSON.stringify(timeout)}`
    );
  };
  let value = timeout;
  if (typeof timeout === 'object' && timeout !== null) {
    if (Array.isArray(timeout)) reject();
    if (Object.keys(timeout).some(key => key !== 'timeoutMs')) reject();
    value = timeout.timeoutMs;
  }
  if (value === undefined) return BARRIER_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) reject();
  return value;
}

class SyncBarrier {
  constructor(count, sharedState = null, timeout = BARRIER_TIMEOUT_MS) {
    this.count = count;
    this.waiting = 0;
    this.resolvers = [];
    this.sharedState = sharedState;
    this.released = false;
    this.checkIntervals = [];
    this.timeoutMs = resolveTimeoutMs(timeout);
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

  /** Let everyone waiting through, and reset for the next cycle. */
  _releaseWaiters() {
    // Clean up polling intervals from all waiters before resolving
    this.checkIntervals.forEach(clearInterval);
    this.checkIntervals = [];
    this.resolvers.forEach(r => r({ aborted: false }));
    this.waiting = 0;
    this.resolvers = [];
  }

  /**
   * Stop expecting one more caller here, for good.
   *
   * A racer that has finished its script will never reach this checkpoint
   * again. Without saying so, a partner that opens more recording segments
   * than it did would wait here for someone who has already left — the
   * checkpoint could only ever be met by the deadlock backstop, turning a
   * merely asymmetric race into a failed one. Whoever is waiting now goes
   * through if the smaller count is already met.
   */
  leave() {
    if (this.released || this.count <= 0) return;
    this.count--;
    if (this.waiting > 0 && this.waiting >= this.count) this._releaseWaiters();
  }

  async wait(label = '') {
    if (this.released || this.sharedState?.hasError) return { aborted: true };

    this.waiting++;
    if (this.waiting >= this.count) {
      this._releaseWaiters();
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
            // Distinct from a racer's own failure: a checkpoint that never
            // filled is nobody's fault in particular, so the runner reports it
            // against every racer that has no failure of its own.
            this.sharedState.checkpointTimedOut = true;
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
