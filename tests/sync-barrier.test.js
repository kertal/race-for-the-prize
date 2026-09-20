import { describe, it, expect, vi } from 'vitest';

// SyncBarrier is CJS — use createRequire to load it in ESM test context
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { SyncBarrier } = require('../sync-barrier.cjs');

describe('SyncBarrier', () => {
  it('releases when count is reached', async () => {
    const barrier = new SyncBarrier(2);
    const results = await Promise.all([barrier.wait('a'), barrier.wait('b')]);
    expect(results).toEqual([{ aborted: false }, { aborted: false }]);
  });

  it('releases with count of 1', async () => {
    const barrier = new SyncBarrier(1);
    const result = await barrier.wait('solo');
    expect(result).toEqual({ aborted: false });
  });

  it('returns aborted when releaseAll is called before count is met', async () => {
    const barrier = new SyncBarrier(3);

    const p1 = barrier.wait('a');
    // Only 1 of 3 has waited — release early
    barrier.releaseAll();

    const result = await p1;
    expect(result).toEqual({ aborted: true });
  });

  it('returns aborted immediately after releaseAll', async () => {
    const barrier = new SyncBarrier(2);
    barrier.releaseAll();

    const result = await barrier.wait('late');
    expect(result).toEqual({ aborted: true });
  });

  it('returns aborted when sharedState has error', async () => {
    const sharedState = { hasError: true };
    const barrier = new SyncBarrier(2, sharedState);

    const result = await barrier.wait('a');
    expect(result).toEqual({ aborted: true });
  });

  it('aborts waiting callers when sharedState gets error', async () => {
    vi.useFakeTimers();
    const sharedState = { hasError: false };
    const barrier = new SyncBarrier(3, sharedState);
    try {
      const p1 = barrier.wait('a');

      // Trigger error after a poll cycle
      sharedState.hasError = true;
      await vi.advanceTimersByTimeAsync(150);

      const result = await p1;
      expect(result).toEqual({ aborted: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up intervals on successful release', async () => {
    const barrier = new SyncBarrier(2);

    // First waiter creates a polling interval
    const p1 = barrier.wait('a');
    expect(barrier.checkIntervals.length).toBe(1);

    // Second waiter triggers release — intervals should be cleaned
    const p2 = barrier.wait('b');

    await Promise.all([p1, p2]);
    expect(barrier.checkIntervals.length).toBe(0);
  });

  it('cleans up intervals on releaseAll', async () => {
    const barrier = new SyncBarrier(3);

    barrier.wait('a');
    expect(barrier.checkIntervals.length).toBe(1);

    barrier.releaseAll();
    expect(barrier.checkIntervals.length).toBe(0);
    expect(barrier.resolvers.length).toBe(0);
  });

  it('releaseAll is idempotent', () => {
    const barrier = new SyncBarrier(2);
    barrier.releaseAll();
    barrier.releaseAll(); // should not throw
    expect(barrier.released).toBe(true);
  });

  it('releases every waiter and flags sharedState when a checkpoint times out', async () => {
    vi.useFakeTimers();
    const sharedState = { hasError: false, errorMessage: null };
    try {
      // count=3 but only two callers ever arrive → deadlock without the timeout.
      const barrier = new SyncBarrier(3, sharedState, 200);

      const p1 = barrier.wait('a');
      const p2 = barrier.wait('b');

      await vi.advanceTimersByTimeAsync(250);

      expect(await p1).toEqual({ aborted: true });
      expect(await p2).toEqual({ aborted: true });
      expect(sharedState.hasError).toBe(true);
      expect(sharedState.errorMessage).toMatch(/timed out/);
      // Fully released: no stale bookkeeping a later waiter could trip on.
      expect(barrier.checkIntervals.length).toBe(0);
      expect(barrier.resolvers.length).toBe(0);
      expect(barrier.released).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out even without sharedState (releases the lone waiter)', async () => {
    vi.useFakeTimers();
    try {
      const barrier = new SyncBarrier(2, null, 200);
      const p1 = barrier.wait('solo');
      await vi.advanceTimersByTimeAsync(250);
      expect(await p1).toEqual({ aborted: true });
      expect(barrier.released).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts the { timeoutMs } options form the runner passes', async () => {
    // Regression: runner.cjs constructs its barriers with an options object.
    // The constructor used to store that object as the deadline, and
    // `{ timeoutMs } > 0` is false, so the backstop never fired in real races.
    vi.useFakeTimers();
    const sharedState = { hasError: false, errorMessage: null };
    try {
      const barrier = new SyncBarrier(2, sharedState, { timeoutMs: 200 });
      expect(barrier.timeoutMs).toBe(200);

      const p1 = barrier.wait('a');
      await vi.advanceTimersByTimeAsync(250);
      expect(await p1).toEqual({ aborted: true });
      expect(sharedState.hasError).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the default deadline for an empty options object', () => {
    expect(new SyncBarrier(2, null, {}).timeoutMs).toBe(new SyncBarrier(2).timeoutMs);
  });

  it('rejects a deadline that is not a number', () => {
    expect(() => new SyncBarrier(2, null, '200')).toThrow(TypeError);
    expect(() => new SyncBarrier(2, null, { timeoutMs: 'soon' })).toThrow(TypeError);
    expect(() => new SyncBarrier(2, null, -1)).toThrow(TypeError);
  });

  it('rejects an options object that is not a deadline', () => {
    // A misspelled or misplaced option must fail loudly rather than read as
    // "no timeout given" and silently take the default.
    expect(() => new SyncBarrier(2, null, { timeoutMS: 200 })).toThrow(TypeError);
    expect(() => new SyncBarrier(2, null, { timeoutMs: 200, extra: 1 })).toThrow(TypeError);
    expect(() => new SyncBarrier(2, null, [])).toThrow(TypeError);
    expect(() => new SyncBarrier(2, null, [200])).toThrow(TypeError);
  });

  describe('leave', () => {
    // A racer that has finished will never reach the checkpoint again. Saying
    // so is what keeps a partner with more recording segments from waiting
    // there for someone who has already left.
    it('releases a waiter that is now the only one expected', async () => {
      const barrier = new SyncBarrier(2);
      const waiting = barrier.wait('partner');
      barrier.leave();
      expect(await waiting).toEqual({ aborted: false });
    });

    it('lets a later arrival through without waiting', async () => {
      const barrier = new SyncBarrier(2);
      barrier.leave();
      expect(await barrier.wait('partner')).toEqual({ aborted: false });
    });

    it('still expects the racers that have not left', async () => {
      const barrier = new SyncBarrier(3);
      barrier.leave();
      const first = barrier.wait('a');
      let settled = false;
      first.then(() => { settled = true; });
      await new Promise(r => setTimeout(r, 50));
      expect(settled).toBe(false); // one of two expected racers is here

      expect(await barrier.wait('b')).toEqual({ aborted: false });
      expect(await first).toEqual({ aborted: false });
    });

    it('leaves a released barrier alone', () => {
      const barrier = new SyncBarrier(2);
      barrier.releaseAll();
      barrier.leave();
      expect(barrier.count).toBe(2);
    });
  });

  it('never times out when timeoutMs is 0 (backstop explicitly disabled)', async () => {
    vi.useFakeTimers();
    try {
      const barrier = new SyncBarrier(2, { hasError: false }, 0);

      const p1 = barrier.wait('a');
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(barrier.released).toBe(false);

      // Still functional: the partner arriving late releases normally.
      barrier.wait('b');
      expect(await p1).toEqual({ aborted: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be reused across multiple rounds', async () => {
    // Three barriers for three checkpoints, as used in parallel mode
    const barriers = {
      ready: new SyncBarrier(2),
      start: new SyncBarrier(2),
      stop: new SyncBarrier(2),
    };

    // Both browsers hit ready
    const readyResults = await Promise.all([
      barriers.ready.wait('browser1'),
      barriers.ready.wait('browser2'),
    ]);
    expect(readyResults.every(r => !r.aborted)).toBe(true);

    // Both browsers hit start
    const startResults = await Promise.all([
      barriers.start.wait('browser1'),
      barriers.start.wait('browser2'),
    ]);
    expect(startResults.every(r => !r.aborted)).toBe(true);

    // Both browsers hit stop
    const stopResults = await Promise.all([
      barriers.stop.wait('browser1'),
      barriers.stop.wait('browser2'),
    ]);
    expect(stopResults.every(r => !r.aborted)).toBe(true);
  });
});
