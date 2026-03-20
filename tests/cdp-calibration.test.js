import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { interpolateCdpTimestamp } = require('../cdp-calibration.cjs');

describe('interpolateCdpTimestamp', () => {
  it('returns null for empty mapping', () => {
    expect(interpolateCdpTimestamp([], 1000)).toBeNull();
  });

  it('uses single sample with offset', () => {
    const mapping = [{ cdpTs: 100.0, wallMs: 5000 }];
    // 1 second later → cdpTs should be 101.0
    expect(interpolateCdpTimestamp(mapping, 6000)).toBeCloseTo(101.0, 6);
    // 0.5 seconds earlier → cdpTs should be 99.5
    expect(interpolateCdpTimestamp(mapping, 4500)).toBeCloseTo(99.5, 6);
  });

  it('interpolates between two bracketing samples', () => {
    const mapping = [
      { cdpTs: 100.0, wallMs: 1000 },
      { cdpTs: 102.0, wallMs: 3000 },
    ];
    // Midpoint: wallMs=2000 → cdpTs=101.0
    expect(interpolateCdpTimestamp(mapping, 2000)).toBeCloseTo(101.0, 6);
    // Quarter: wallMs=1500 → cdpTs=100.5
    expect(interpolateCdpTimestamp(mapping, 1500)).toBeCloseTo(100.5, 6);
  });

  it('extrapolates before the first sample', () => {
    const mapping = [
      { cdpTs: 100.0, wallMs: 2000 },
      { cdpTs: 101.0, wallMs: 3000 },
    ];
    // 1s before first sample → cdpTs = 100.0 - 1.0 = 99.0
    expect(interpolateCdpTimestamp(mapping, 1000)).toBeCloseTo(99.0, 6);
  });

  it('extrapolates after the last sample', () => {
    const mapping = [
      { cdpTs: 100.0, wallMs: 2000 },
      { cdpTs: 101.0, wallMs: 3000 },
    ];
    // 2s after last sample → cdpTs = 101.0 + 2.0 = 103.0
    expect(interpolateCdpTimestamp(mapping, 5000)).toBeCloseTo(103.0, 6);
  });

  it('handles many samples and picks the right bracket', () => {
    const mapping = [
      { cdpTs: 10.0, wallMs: 100 },
      { cdpTs: 10.5, wallMs: 600 },
      { cdpTs: 11.0, wallMs: 1100 },
      { cdpTs: 11.5, wallMs: 1600 },
      { cdpTs: 12.0, wallMs: 2100 },
    ];
    // wallMs=1350 is between samples 2 and 3 (1100..1600)
    // frac = (1350-1100)/(1600-1100) = 250/500 = 0.5
    // cdpTs = 11.0 + 0.5 * (11.5-11.0) = 11.25
    expect(interpolateCdpTimestamp(mapping, 1350)).toBeCloseTo(11.25, 6);
  });

  it('returns exact match when wallMs equals a sample', () => {
    const mapping = [
      { cdpTs: 50.0, wallMs: 1000 },
      { cdpTs: 51.0, wallMs: 2000 },
      { cdpTs: 52.0, wallMs: 3000 },
    ];
    expect(interpolateCdpTimestamp(mapping, 2000)).toBeCloseTo(51.0, 6);
  });

  it('handles non-uniform sample spacing (clock skew)', () => {
    const mapping = [
      { cdpTs: 100.0, wallMs: 1000 },
      { cdpTs: 100.1, wallMs: 1200 },   // 200ms gap, 0.1s cdp
      { cdpTs: 101.0, wallMs: 2000 },   // 800ms gap, 0.9s cdp
    ];
    // wallMs=1600 is between samples 1 and 2 (1200..2000)
    // frac = (1600-1200)/(2000-1200) = 400/800 = 0.5
    // cdpTs = 100.1 + 0.5 * (101.0-100.1) = 100.1 + 0.45 = 100.55
    expect(interpolateCdpTimestamp(mapping, 1600)).toBeCloseTo(100.55, 6);
  });
});

describe('wallClockToPts (via createCdpCalibrator mock)', () => {
  // Simulates the PTS computation that createCdpCalibrator.wallClockToPts performs:
  // pts = interpolatedCdpTs - firstCdpTs
  function computePts(mapping, wallMs) {
    if (mapping.length < 2) return null;
    const firstCdpTs = mapping[0].cdpTs;
    const cdpTs = interpolateCdpTimestamp(mapping, wallMs);
    if (cdpTs === null) return null;
    return cdpTs - firstCdpTs;
  }

  it('returns 0 PTS when wallMs matches the first sample', () => {
    const mapping = [
      { cdpTs: 1000.0, wallMs: 5000 },
      { cdpTs: 1001.0, wallMs: 6000 },
    ];
    expect(computePts(mapping, 5000)).toBeCloseTo(0.0, 6);
  });

  it('returns positive PTS for events after recording start', () => {
    const mapping = [
      { cdpTs: 1000.0, wallMs: 5000 },
      { cdpTs: 1001.0, wallMs: 6000 },
      { cdpTs: 1002.0, wallMs: 7000 },
    ];
    // Event at wallMs=6500 → cdpTs=1001.5 → PTS = 1001.5-1000.0 = 1.5s
    expect(computePts(mapping, 6500)).toBeCloseTo(1.5, 6);
  });

  it('returns null when fewer than 2 samples', () => {
    const mapping = [{ cdpTs: 100.0, wallMs: 5000 }];
    expect(computePts(mapping, 5500)).toBeNull();
  });
});
