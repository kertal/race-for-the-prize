import { describe, it, expect } from 'vitest';
import { determineOverallWinner } from '../cli/race-utils.js';

describe('determineOverallWinner', () => {
  it('returns null when there are no comparisons', () => {
    const winner = determineOverallWinner({ a: 0, b: 0 }, ['a', 'b'], []);
    expect(winner).toBeNull();
  });

  it('returns the sole win leader', () => {
    const wins = { a: 2, b: 0 };
    const comparisons = [{}, {}];
    expect(determineOverallWinner(wins, ['a', 'b'], comparisons)).toBe('a');
  });

  it('returns the leader even for a slim single-win margin', () => {
    // A racer that consistently wins by a small margin still wins overall;
    // "how close counts as a win" is decided per-comparison, not re-litigated
    // by an averaged-percentage threshold here.
    const wins = { a: 1, b: 0 };
    const comparisons = [{}];
    expect(determineOverallWinner(wins, ['a', 'b'], comparisons)).toBe('a');
  });

  it('returns tie when win counts are equal', () => {
    const wins = { a: 1, b: 1 };
    const comparisons = [{}, {}];
    expect(determineOverallWinner(wins, ['a', 'b'], comparisons)).toBe('tie');
  });

  it('returns null when nobody won any comparison', () => {
    const wins = { a: 0, b: 0 };
    const comparisons = [{}, {}];
    expect(determineOverallWinner(wins, ['a', 'b'], comparisons)).toBeNull();
  });

  it('resolves a three-way field by highest win count', () => {
    const wins = { a: 0, b: 3, c: 1 };
    const comparisons = [{}, {}, {}, {}];
    expect(determineOverallWinner(wins, ['a', 'b', 'c'], comparisons)).toBe('b');
  });
});
