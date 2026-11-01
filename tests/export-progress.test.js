import { describe, it, expect } from 'vitest';
const { encodeDurationUs, conversionProgress } = require('../cli/player-runtime/export-progress.cjs');

describe('export conversion progress', () => {
  it('measures against the recorded wall-clock duration when the export is untrimmed', () => {
    expect(encodeDurationUs(null, 2.5)).toBe(2_500_000);
  });

  it('prefers the trimmed clip range over the recorded duration', () => {
    expect(encodeDurationUs({ start: 1, end: 4 }, 9)).toBe(3_000_000);
  });

  it('reports no duration when neither source is usable', () => {
    expect(encodeDurationUs(null, undefined)).toBeNull();
    expect(encodeDurationUs(null, 0)).toBeNull();
    expect(encodeDurationUs({ start: 4, end: 4 }, 9)).toBeNull();
  });

  it("reads ffmpeg's time as microseconds", () => {
    expect(conversionProgress(1_500_000, 3_000_000)).toBe(0.5);
  });

  it('clamps to the 0–1 range', () => {
    expect(conversionProgress(4_000_000, 3_000_000)).toBe(1);
    expect(conversionProgress(-5, 3_000_000)).toBe(0);
  });

  it('yields nothing when the duration is unknown or time is not a number', () => {
    expect(conversionProgress(1_000, null)).toBeNull();
    expect(conversionProgress(NaN, 3_000_000)).toBeNull();
    expect(conversionProgress(undefined, 3_000_000)).toBeNull();
  });
});
