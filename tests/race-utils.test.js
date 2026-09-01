import { describe, it, expect } from 'vitest';
import { determineOverallWinner } from '../cli/race-utils.js';

describe('determineOverallWinner', () => {
  // [description, wins, racerNames, comparisons, expected]
  const cases = [
    ['returns null when there are no comparisons', { a: 0, b: 0 }, ['a', 'b'], [], null],
    ['returns the sole win leader', { a: 2, b: 0 }, ['a', 'b'], [{}, {}], 'a'],
    // A racer that consistently wins by a small margin still wins overall; "how
    // close counts as a win" is decided per-comparison, not re-litigated here.
    ['returns the leader even for a slim single-win margin', { a: 1, b: 0 }, ['a', 'b'], [{}], 'a'],
    ['returns tie when win counts are equal', { a: 1, b: 1 }, ['a', 'b'], [{}, {}], 'tie'],
    ['returns null when nobody won any comparison', { a: 0, b: 0 }, ['a', 'b'], [{}, {}], null],
    ['resolves a three-way field by highest win count', { a: 0, b: 3, c: 1 }, ['a', 'b', 'c'], [{}, {}, {}, {}], 'b'],
  ];

  it.each(cases)('%s', (_desc, wins, racerNames, comparisons, expected) => {
    expect(determineOverallWinner(wins, racerNames, comparisons)).toBe(expected);
  });
});
