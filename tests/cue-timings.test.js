import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { cueTimings } = require('../cue-timings.cjs');

describe('cueTimings', () => {
  const FPS_25 = 0.04;

  it('returns the first green cue as calibratedStart', () => {
    const startCues = [1.0, 1.04, 1.08, 1.12];
    const endCues = [3.0, 3.04, 3.08];
    const { calibratedStart } = cueTimings(startCues, endCues, FPS_25);
    expect(calibratedStart).toBe(1.0);
  });

  it('segment start equals calibratedStart (single source of truth)', () => {
    const startCues = [0.28, 0.32, 0.36, 0.40];
    const endCues = [2.5, 2.54, 2.58];
    const { segments, calibratedStart } = cueTimings(startCues, endCues, FPS_25);
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(calibratedStart);
  });

  it('segment end is one frame before first red cue', () => {
    const startCues = [1.0];
    const endCues = [5.0];
    const { segments } = cueTimings(startCues, endCues, FPS_25);
    expect(segments[0].end).toBeCloseTo(5.0 - FPS_25, 10);
  });

  it('uses default frame duration when not provided', () => {
    const startCues = [1.0];
    const endCues = [5.0];
    const { segments } = cueTimings(startCues, endCues);
    expect(segments[0].end).toBeCloseTo(5.0 - 0.04, 10);
  });

  it('returns empty segments and null calibratedStart when no green cues', () => {
    const { segments, calibratedStart } = cueTimings([], [3.0], FPS_25);
    expect(segments).toEqual([]);
    expect(calibratedStart).toBeNull();
  });

  it('returns empty segments and null calibratedStart when no red cues', () => {
    const { segments, calibratedStart } = cueTimings([1.0], [], FPS_25);
    expect(segments).toEqual([]);
    expect(calibratedStart).toBeNull();
  });

  it('returns empty segments when red cue is before green cue', () => {
    const { segments, calibratedStart } = cueTimings([5.0], [2.0], FPS_25);
    expect(segments).toEqual([]);
    expect(calibratedStart).toBe(5.0);
  });

  it('returns empty segments when cues overlap within one frame', () => {
    const startCues = [1.0];
    const endCues = [1.02];
    const { segments } = cueTimings(startCues, endCues, FPS_25);
    expect(segments).toEqual([]);
  });

  it('handles single-frame green and red cues', () => {
    const startCues = [0.5];
    const endCues = [3.0];
    const { segments, calibratedStart } = cueTimings(startCues, endCues, FPS_25);
    expect(calibratedStart).toBe(0.5);
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(0.5);
    expect(segments[0].end).toBeCloseTo(2.96, 10);
  });

  it('ignores later green cues (uses first, not last)', () => {
    const startCues = [0.28, 0.32, 0.36, 0.40, 0.44, 0.48, 0.52];
    const endCues = [4.0];
    const { segments, calibratedStart } = cueTimings(startCues, endCues, FPS_25);
    expect(calibratedStart).toBe(0.28);
    expect(segments[0].start).toBe(0.28);
  });

  it('works with non-standard frame rates', () => {
    const fps60 = 1 / 60;
    const startCues = [1.0];
    const endCues = [5.0];
    const { segments } = cueTimings(startCues, endCues, fps60);
    expect(segments[0].end).toBeCloseTo(5.0 - fps60, 10);
  });

  it('pairs multiple start/end cue clusters into multiple segments', () => {
    // Two recording windows: green burst at ~1.0s, red burst at ~3.0s;
    // green burst at ~5.0s, red burst at ~8.0s
    const startCues = [1.0, 1.04, 1.08, 5.0, 5.04, 5.08];
    const endCues = [3.0, 3.04, 3.08, 8.0, 8.04, 8.08];
    const { segments, calibratedStart } = cueTimings(startCues, endCues, FPS_25);
    expect(calibratedStart).toBe(1.0);
    expect(segments).toHaveLength(2);
    expect(segments[0].start).toBe(1.0);
    expect(segments[0].end).toBeCloseTo(3.0 - FPS_25, 10);
    expect(segments[1].start).toBe(5.0);
    expect(segments[1].end).toBeCloseTo(8.0 - FPS_25, 10);
  });

  it('skips end cues that precede a start cue', () => {
    // Stray red at 0.5, then proper green at 2.0, red at 4.0
    const startCues = [2.0];
    const endCues = [0.5, 4.0];
    const { segments } = cueTimings(startCues, endCues, FPS_25);
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(2.0);
    expect(segments[0].end).toBeCloseTo(4.0 - FPS_25, 10);
  });
});
