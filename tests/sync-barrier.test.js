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

    const p1 = barrier.wait('a');

    // Trigger error after a poll cycle
    sharedState.hasError = true;
    await vi.advanceTimersByTimeAsync(150);

    const result = await p1;
    expect(result).toEqual({ aborted: true });
    vi.useRealTimers();
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

  describe('timeout', () => {
    it('releases a hung waiter with timedOut after timeoutMs', async () => {
      vi.useFakeTimers();
      const sharedState = { hasError: false, errorMessage: null };
      const barrier = new SyncBarrier(2, sharedState, { timeoutMs: 1000 });

      const p1 = barrier.wait('recordingStart');
      // The second racer never arrives (e.g. a pure-JS hang)
      await vi.advanceTimersByTimeAsync(1100);

      const result = await p1;
      expect(result).toEqual({ aborted: true, timedOut: true });
      expect(sharedState.hasError).toBe(true);
      expect(sharedState.errorMessage).toContain('timed out');
      vi.useRealTimers();
    });

    it('does not time out when all racers arrive in time', async () => {
      vi.useFakeTimers();
      const barrier = new SyncBarrier(2, null, { timeoutMs: 1000 });

      const p1 = barrier.wait('a');
      await vi.advanceTimersByTimeAsync(500);
      const p2 = barrier.wait('b');

      const results = await Promise.all([p1, p2]);
      expect(results).toEqual([{ aborted: false }, { aborted: false }]);

      // Advancing past the deadline after release must not flip state
      await vi.advanceTimersByTimeAsync(2000);
      expect(barrier.timedOut).toBe(false);
      vi.useRealTimers();
    });

    it('late waiters after a timeout see the timedOut abort', async () => {
      vi.useFakeTimers();
      const barrier = new SyncBarrier(2, { hasError: false }, { timeoutMs: 1000 });

      const p1 = barrier.wait('a');
      await vi.advanceTimersByTimeAsync(1100);
      await p1;

      const late = await barrier.wait('late');
      expect(late).toEqual({ aborted: true, timedOut: true });
      vi.useRealTimers();
    });

    it('no timeout is armed when timeoutMs is 0 (default)', async () => {
      vi.useFakeTimers();
      const barrier = new SyncBarrier(2);

      const p1 = barrier.wait('a');
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(barrier.timedOut).toBe(false);
      expect(barrier.released).toBe(false);

      barrier.wait('b');
      const result = await p1;
      expect(result).toEqual({ aborted: false });
      vi.useRealTimers();
    });
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
