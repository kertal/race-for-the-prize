import { describe, it, expect } from 'vitest';
import { determineOverallWinner, DRAW_THRESHOLD_PERCENT } from '../cli/race-utils.js';

describe('determineOverallWinner', () => {
  it('returns null when there are no comparisons', () => {
    const winner = determineOverallWinner({ a: 0, b: 0 }, ['a', 'b'], []);
    expect(winner).toBeNull();
  });

  it('returns tie when average diff is below threshold, even with a win leader', () => {
    const wins = { a: 2, b: 0 };
    const comparisons = [
      { diffPercent: DRAW_THRESHOLD_PERCENT - 0.5 },
      { diffPercent: DRAW_THRESHOLD_PERCENT - 0.1 },
    ];
    const winner = determineOverallWinner(wins, ['a', 'b'], comparisons);
    expect(winner).toBe('tie');
  });

  it('returns leader when average diff is at or above threshold', () => {
    const wins = { a: 2, b: 0 };
    const comparisons = [
      { diffPercent: DRAW_THRESHOLD_PERCENT },
      { diffPercent: DRAW_THRESHOLD_PERCENT + 2 },
    ];
    const winner = determineOverallWinner(wins, ['a', 'b'], comparisons);
    expect(winner).toBe('a');
  });

  it('returns tie when wins are equal and threshold does not force tie', () => {
    const wins = { a: 1, b: 1 };
    const comparisons = [
      { diffPercent: DRAW_THRESHOLD_PERCENT + 3 },
      { diffPercent: DRAW_THRESHOLD_PERCENT + 1 },
    ];
    const winner = determineOverallWinner(wins, ['a', 'b'], comparisons);
    expect(winner).toBe('tie');
  });

  it('ignores null diffPercent values and still resolves winner from wins', () => {
    const wins = { a: 0, b: 2 };
    const comparisons = [{ diffPercent: null }, { diffPercent: undefined }];
    const winner = determineOverallWinner(wins, ['a', 'b'], comparisons);
    expect(winner).toBe('b');
  });
});
