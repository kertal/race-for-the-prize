import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { deriveTraceTiming } = require('../trace-calibration.cjs');

function buildTrace(events) {
  return JSON.stringify({ traceEvents: events });
}

describe('deriveTraceTiming', () => {
  it('extracts segments, measurements and trace calibration', () => {
    const trace = buildTrace([
      { name: 'Screenshot', ts: 1_000_000 },
      { name: 'race:recording:start', ts: 1_500_000 },
      { name: 'race:measure:start:Load', ts: 1_700_000 },
      { name: 'race:measure:end:Load', ts: 2_300_000 },
      { name: 'race:recording:end', ts: 2_500_000 },
      { name: 'Screenshot', ts: 2_800_000 },
    ]);

    const out = deriveTraceTiming(trace);
    expect(out).toBeTruthy();
    expect(out.traceCalibration.firstFrameTs).toBe(1_000_000);
    expect(out.traceCalibration.recordingStartTs).toBe(1_500_000);
    expect(out.recordingSegments).toEqual([
      {
        start: 0,
        end: 1.0,
        startTraceTs: 1_500_000,
        endTraceTs: 2_500_000,
      },
    ]);
    expect(out.ptsSegments[0].start).toBeCloseTo(0.5, 6);
    expect(out.ptsSegments[0].end).toBeCloseTo(1.5, 6);
    expect(out.calibratedStartPts).toBeCloseTo(0.5, 6);
    expect(out.measurements).toHaveLength(1);
    expect(out.measurements[0].name).toBe('Load');
    expect(out.measurements[0].startTime).toBeCloseTo(0.2, 6);
    expect(out.measurements[0].endTime).toBeCloseTo(0.8, 6);
    expect(out.measurements[0].duration).toBeCloseTo(0.6, 6);
    expect(out.measurements[0].startTraceTs).toBe(1_700_000);
    expect(out.measurements[0].endTraceTs).toBe(2_300_000);
  });

  it('supports encoded measurement names', () => {
    const encoded = encodeURIComponent('First Paint');
    const trace = buildTrace([
      { name: 'Screenshot', ts: 1_000_000 },
      { name: 'race:recording:start', ts: 1_500_000 },
      { name: `race:measure:start:${encoded}`, ts: 1_700_000 },
      { name: `race:measure:end:${encoded}`, ts: 2_100_000 },
      { name: 'race:recording:end', ts: 2_500_000 },
    ]);

    const out = deriveTraceTiming(trace);
    expect(out.measurements[0].name).toBe('First Paint');
  });

  it('returns null when recording start mark is missing', () => {
    const trace = buildTrace([
      { name: 'Screenshot', ts: 1_000_000 },
      { name: 'race:recording:end', ts: 2_000_000 },
    ]);
    expect(deriveTraceTiming(trace)).toBeNull();
  });

  it('falls back to empty pts segments when screenshots are unavailable', () => {
    const trace = buildTrace([
      { name: 'race:recording:start', ts: 1_500_000 },
      { name: 'race:recording:end', ts: 2_500_000 },
    ]);
    const out = deriveTraceTiming(trace);
    expect(out.recordingSegments).toHaveLength(1);
    expect(out.ptsSegments).toEqual([]);
    expect(out.calibratedStartPts).toBeNull();
  });
});
