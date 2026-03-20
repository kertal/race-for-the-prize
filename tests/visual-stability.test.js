import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { waitForStability } = require('../visual-stability.cjs');

describe('waitForStability', () => {
  it('resolves quickly when counters are already stable', async () => {
    const counters = { taskDuration: 1.5, layoutCount: 10, recalcStyleCount: 20 };
    const getCounters = async () => ({ ...counters });

    const result = await waitForStability(getCounters, {
      stabilityWindow: 100,
      timeout: 2000,
      pollInterval: 20,
    });

    expect(result.stable).toBe(true);
    expect(result.elapsed).toBeLessThan(500);
  });

  it('waits for counters to stop changing then resolves', async () => {
    let callCount = 0;
    const getCounters = async () => {
      callCount++;
      // Change counters for the first 4 calls, then stabilize
      if (callCount <= 4) {
        return { taskDuration: callCount * 0.1, layoutCount: callCount, recalcStyleCount: callCount };
      }
      return { taskDuration: 0.4, layoutCount: 4, recalcStyleCount: 4 };
    };

    const result = await waitForStability(getCounters, {
      stabilityWindow: 100,
      timeout: 3000,
      pollInterval: 20,
    });

    expect(result.stable).toBe(true);
    expect(callCount).toBeGreaterThan(4);
  });

  it('returns stable: false on timeout when counters never stop changing', async () => {
    let callCount = 0;
    const getCounters = async () => {
      callCount++;
      return { taskDuration: callCount * 0.1, layoutCount: callCount, recalcStyleCount: callCount };
    };

    const result = await waitForStability(getCounters, {
      stabilityWindow: 200,
      timeout: 300,
      pollInterval: 20,
    });

    expect(result.stable).toBe(false);
    expect(result.elapsed).toBeGreaterThanOrEqual(300);
  });

  it('resets stability timer when a single counter changes', async () => {
    let callCount = 0;
    const getCounters = async () => {
      callCount++;
      // layoutCount and recalcStyleCount stabilize immediately,
      // but taskDuration keeps changing for first 5 calls
      const taskDuration = callCount <= 5 ? callCount * 0.1 : 0.5;
      return { taskDuration, layoutCount: 10, recalcStyleCount: 20 };
    };

    const result = await waitForStability(getCounters, {
      stabilityWindow: 80,
      timeout: 2000,
      pollInterval: 20,
    });

    expect(result.stable).toBe(true);
    // Must have polled past the 5 changing calls plus the stability window
    expect(callCount).toBeGreaterThan(5);
  });

  it('uses default options when none provided', async () => {
    const counters = { taskDuration: 1, layoutCount: 5, recalcStyleCount: 3 };
    const getCounters = async () => ({ ...counters });

    const result = await waitForStability(getCounters);

    expect(result.stable).toBe(true);
  });
});
