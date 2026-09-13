import { describe, it, expect } from 'vitest';
const { racerFinishResult } = require('../cli/player-runtime/finish-results.cjs');
const entries = [
  { traceCalibration: { firstFrameTs: 1000000 }, measurements: [{ name: 'Race', startTraceTs: 3000000, endTraceTs: 6000000 }] },
  { traceCalibration: { firstFrameTs: 20000000 }, measurements: [{ name: 'Race', startTraceTs: 24000000, endTraceTs: 26000000 }] },
];
const results = [{ name: 'Race', durations: [3, 2] }];
describe('independent finish placements', () => {
  it('uses each video finish and final duration, not recording or arrival order', () => {
    expect(racerFinishResult(entries, results, 0, 4.99)).toBeNull();
    expect(racerFinishResult(entries, results, 0, 5)).toMatchObject({ place: 2, label: '🥈 2nd · 3.000s total' });
    expect(racerFinishResult(entries, results, 1, 5.99)).toBeNull();
    expect(racerFinishResult(entries, results, 1, 6)).toMatchObject({ place: 1 });
    expect(racerFinishResult(entries, results, 0, 2)).toBeNull();
  });
  it('handles ties and incomplete results without inventing winners', () => {
    expect(racerFinishResult(entries, [{ name: 'Race', durations: [2, 2] }], 0, 5).label).toBe('🥇 Joint 1st · 2.000s total');
    expect(racerFinishResult(entries, [{ name: 'Race', durations: [null, 2] }], 1, 6)).toBeNull();
  });
  it('shows the total only after all sections, even when the last section has a different winner', () => {
    const clips = structuredClone(entries);
    clips[0].measurements.push({ name: 'Next', startTraceTs: 8000000, endTraceTs: 9000000 });
    const ranks = [...results, { name: 'Next', durations: [1, 1.5] },
      { name: 'Race total', isSyntheticTotal: true, durations: [4, 3.5] }];
    expect(racerFinishResult(clips, ranks, 0, 5)).toBeNull();
    expect(racerFinishResult(clips, ranks, 0, 7)).toBeNull();
    expect(racerFinishResult(clips, ranks, 0, 8)).toMatchObject({
      name: 'Total race', place: 2, duration: 4, label: '🥈 2nd · 4.000s total',
    });
  });
  it('matches the summary tolerance for tied total times', () => {
    const ranks = [...results, { name: 'Next', durations: [1, 2.005] }];
    expect(racerFinishResult(entries, ranks, 0, 5).label).toBe('🥇 Joint 1st · 4.000s total');
  });
  it('supports calibrated exports without trace metadata', () => {
    const clips = [{ start: 2, _wcStart: 1, measurements: [{ name: 'Race', startTime: 1, endTime: 4 }] }];
    expect(racerFinishResult(clips, results, 0, 4.9)).toBeNull();
    expect(racerFinishResult(clips, results, 0, 5).place).toBe(2);
  });
});
