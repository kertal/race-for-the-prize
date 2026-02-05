/**
 * Tests for the profile analysis module.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildProfileComparison, PROFILE_METRICS, printProfileAnalysis, buildProfileMarkdown } from '../cli/profile-analysis.js';

describe('buildProfileComparison', () => {
  it('returns empty comparisons when no metrics provided', () => {
    const result = buildProfileComparison(['racer1', 'racer2'], [null, null]);
    expect(result.measured.comparisons).toEqual([]);
    expect(result.total.comparisons).toEqual([]);
    expect(result.measured.overallWinner).toBeNull();
    expect(result.total.overallWinner).toBeNull();
  });

  it('compares total network transfer size (lower is better)', () => {
    const metrics1 = {
      total: { networkTransferSize: 1000, networkRequestCount: 5 },
      measured: { networkTransferSize: 500, networkRequestCount: 3 }
    };
    const metrics2 = {
      total: { networkTransferSize: 2000, networkRequestCount: 10 },
      measured: { networkTransferSize: 800, networkRequestCount: 5 }
    };
    const result = buildProfileComparison(['fast', 'slow'], [metrics1, metrics2]);

    // Check total metrics
    const totalTransfer = result.total.comparisons.find(c => c.key === 'total.networkTransferSize');
    expect(totalTransfer.winner).toBe('fast');
    expect(totalTransfer.values).toEqual([1000, 2000]);

    // Check measured metrics
    const measuredTransfer = result.measured.comparisons.find(c => c.key === 'measured.networkTransferSize');
    expect(measuredTransfer.winner).toBe('fast');
    expect(measuredTransfer.values).toEqual([500, 800]);
  });

  it('compares measured script duration (lower is better)', () => {
    const metrics1 = {
      total: { scriptDuration: 1000 },
      measured: { scriptDuration: 500 }
    };
    const metrics2 = {
      total: { scriptDuration: 800 },
      measured: { scriptDuration: 250 }
    };
    const result = buildProfileComparison(['slow', 'fast'], [metrics1, metrics2]);

    const measuredScript = result.measured.comparisons.find(c => c.key === 'measured.scriptDuration');
    expect(measuredScript.winner).toBe('fast');
  });

  it('handles tie when values are equal', () => {
    const metrics1 = {
      total: { networkTransferSize: 1000 },
      measured: { networkTransferSize: 500 }
    };
    const metrics2 = {
      total: { networkTransferSize: 1000 },
      measured: { networkTransferSize: 500 }
    };
    const result = buildProfileComparison(['a', 'b'], [metrics1, metrics2]);

    const totalComp = result.total.comparisons.find(c => c.key === 'total.networkTransferSize');
    expect(totalComp.winner).toBeNull();
  });

  it('calculates separate winners for measured and total', () => {
    const metrics1 = {
      total: { networkTransferSize: 2000, scriptDuration: 100 },
      measured: { networkTransferSize: 500, scriptDuration: 50 }
    };
    const metrics2 = {
      total: { networkTransferSize: 1000, scriptDuration: 200 },
      measured: { networkTransferSize: 1000, scriptDuration: 100 }
    };
    const result = buildProfileComparison(['a', 'b'], [metrics1, metrics2]);

    // 'a' wins both measured metrics
    expect(result.measured.overallWinner).toBe('a');
    // 'b' wins total network, 'a' wins total script -> 'a' = 'b' = 1 win each = tie
    // Actually: 'a' loses total network (2000 vs 1000), wins total script (100 vs 200)
    // So totalWins: a=1, b=1 -> tie
    expect(result.total.overallWinner).toBe('tie');
  });

  it('handles partial metrics from one racer', () => {
    const metrics1 = {
      total: { networkTransferSize: 1000 },
      measured: { networkTransferSize: 500, scriptDuration: 100 }
    };
    const metrics2 = {
      total: { networkTransferSize: 2000 },
      measured: { networkTransferSize: 800 } // missing scriptDuration
    };
    const result = buildProfileComparison(['a', 'b'], [metrics1, metrics2]);

    const totalTransfer = result.total.comparisons.find(c => c.key === 'total.networkTransferSize');
    expect(totalTransfer).toBeDefined();
    expect(totalTransfer.winner).toBe('a');

    const measuredScript = result.measured.comparisons.find(c => c.key === 'measured.scriptDuration');
    // scriptDuration should exist but b's value is null
    expect(measuredScript.values[1]).toBeNull();
  });

  it('groups comparisons by category within each scope', () => {
    const metrics = {
      total: {
        networkTransferSize: 1000,
        networkRequestCount: 5,
        domContentLoaded: 100,
        scriptDuration: 50
      },
      measured: {
        networkTransferSize: 500,
        networkRequestCount: 3,
        scriptDuration: 25
      }
    };
    const result = buildProfileComparison(['a', 'b'], [metrics, metrics]);

    // Check total groupings
    expect(result.total.byCategory.network).toHaveLength(2);
    expect(result.total.byCategory.loading).toHaveLength(1);
    expect(result.total.byCategory.computation).toHaveLength(1);

    // Check measured groupings
    expect(result.measured.byCategory.network).toHaveLength(2);
    expect(result.measured.byCategory.computation).toHaveLength(1);
  });

  it('provides combined comparisons for backward compatibility', () => {
    const metrics = {
      total: { networkTransferSize: 1000 },
      measured: { networkTransferSize: 500 }
    };
    const result = buildProfileComparison(['a', 'b'], [metrics, metrics]);

    // Combined comparisons should include both scopes
    expect(result.comparisons.length).toBe(
      result.measured.comparisons.length + result.total.comparisons.length
    );
  });
});

describe('PROFILE_METRICS', () => {
  it('defines metrics for both measured and total scopes', () => {
    const measuredKeys = Object.keys(PROFILE_METRICS).filter(k => k.startsWith('measured.'));
    const totalKeys = Object.keys(PROFILE_METRICS).filter(k => k.startsWith('total.'));

    expect(measuredKeys.length).toBeGreaterThan(0);
    expect(totalKeys.length).toBeGreaterThan(0);
  });

  it('all metrics have required properties', () => {
    for (const [key, metric] of Object.entries(PROFILE_METRICS)) {
      expect(metric.name).toBeDefined();
      expect(metric.format).toBeInstanceOf(Function);
      expect(metric.category).toBeDefined();
      expect(metric.scope).toMatch(/^(measured|total)$/);
    }
  });

  it('formats bytes correctly', () => {
    const format = PROFILE_METRICS['total.networkTransferSize'].format;
    expect(format(0)).toBe('0 B');
    expect(format(500)).toBe('500.0 B');
    expect(format(1024)).toBe('1.0 KB');
    expect(format(1536)).toBe('1.5 KB');
    expect(format(1048576)).toBe('1.0 MB');
  });

  it('formats milliseconds correctly', () => {
    const format = PROFILE_METRICS['measured.scriptDuration'].format;
    expect(format(0.5)).toContain('μs');
    expect(format(50)).toBe('50.0ms');
    expect(format(1500)).toBe('1.50s');
  });
});

describe('buildProfileComparison percentage calculations', () => {
  it('calculates percentage difference correctly', () => {
    const metrics1 = {
      total: { networkTransferSize: 1000 },
      measured: {}
    };
    const metrics2 = {
      total: { networkTransferSize: 1500 },
      measured: {}
    };
    const result = buildProfileComparison(['a', 'b'], [metrics1, metrics2]);

    const comp = result.total.comparisons.find(c => c.key === 'total.networkTransferSize');
    expect(comp.winner).toBe('a');
    expect(comp.diff).toBe(500); // 1500 - 1000
    expect(comp.diffPercent).toBe(50); // 500/1000 * 100
  });

  it('handles zero values in percentage calculation', () => {
    const metrics1 = {
      total: { networkTransferSize: 0 },
      measured: {}
    };
    const metrics2 = {
      total: { networkTransferSize: 100 },
      measured: {}
    };
    const result = buildProfileComparison(['a', 'b'], [metrics1, metrics2]);

    const comp = result.total.comparisons.find(c => c.key === 'total.networkTransferSize');
    expect(comp.winner).toBe('a');
    expect(comp.diffPercent).toBe(0); // Division by zero guard
  });
});

describe('printProfileAnalysis', () => {
  it('does not throw with valid metrics', () => {
    const metrics = {
      total: { networkTransferSize: 1000, scriptDuration: 50 },
      measured: { networkTransferSize: 500, scriptDuration: 25 }
    };
    const comparison = buildProfileComparison(['a', 'b'], [metrics, metrics]);

    // Mock stderr to prevent output during test
    const mockWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => printProfileAnalysis(comparison, ['a', 'b'])).not.toThrow();

    mockWrite.mockRestore();
  });

  it('handles empty comparisons gracefully', () => {
    const comparison = buildProfileComparison(['a', 'b'], [null, null]);

    const mockWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => printProfileAnalysis(comparison, ['a', 'b'])).not.toThrow();

    mockWrite.mockRestore();
  });
});

describe('buildProfileMarkdown', () => {
  it('returns empty string when no metrics', () => {
    const comparison = buildProfileComparison(['a', 'b'], [null, null]);
    const markdown = buildProfileMarkdown(comparison, ['a', 'b']);

    expect(markdown).toBe('');
  });

  it('generates markdown with headers and tables', () => {
    const metrics1 = {
      total: { networkTransferSize: 1000, scriptDuration: 100 },
      measured: { networkTransferSize: 500 }
    };
    const metrics2 = {
      total: { networkTransferSize: 2000, scriptDuration: 200 },
      measured: { networkTransferSize: 800 }
    };
    const comparison = buildProfileComparison(['racer1', 'racer2'], [metrics1, metrics2]);
    const markdown = buildProfileMarkdown(comparison, ['racer1', 'racer2']);

    expect(markdown).toContain('### Performance Profile Analysis');
    expect(markdown).toContain('Lower values are better');
    expect(markdown).toContain('During Measurement');
    expect(markdown).toContain('Total Session');
    expect(markdown).toContain('| Metric |');
    expect(markdown).toContain('racer1');
    expect(markdown).toContain('racer2');
    expect(markdown).toContain('**Score:**');
  });

  it('includes percentage differences in markdown', () => {
    const metrics1 = {
      total: { networkTransferSize: 1000 },
      measured: {}
    };
    const metrics2 = {
      total: { networkTransferSize: 2000 },
      measured: {}
    };
    const comparison = buildProfileComparison(['a', 'b'], [metrics1, metrics2]);
    const markdown = buildProfileMarkdown(comparison, ['a', 'b']);

    // Should contain the percentage diff (100%)
    expect(markdown).toContain('100.0%');
  });
});

describe('multi-racer support (3-5 racers)', () => {
  it('compares all 4 racers and picks the best', () => {
    const data = [
      { total: { networkTransferSize: 3000 }, measured: { networkTransferSize: 1000 } },
      { total: { networkTransferSize: 1000 }, measured: { networkTransferSize: 500 } },
      { total: { networkTransferSize: 4000 }, measured: { networkTransferSize: 2000 } },
      { total: { networkTransferSize: 2000 }, measured: { networkTransferSize: 800 } },
    ];
    const result = buildProfileComparison(['angular', 'htmx', 'react', 'svelte'], data);

    const totalTransfer = result.total.comparisons.find(c => c.key === 'total.networkTransferSize');
    expect(totalTransfer.winner).toBe('htmx');
    expect(totalTransfer.values).toEqual([3000, 1000, 4000, 2000]);
    // diff = worst (4000) - best (1000) = 3000, diffPercent = 3000/1000*100 = 300%
    expect(totalTransfer.diff).toBe(3000);
    expect(totalTransfer.diffPercent).toBe(300);
  });

  it('tracks wins for all racers', () => {
    const data = [
      { total: { networkTransferSize: 100, scriptDuration: 400 }, measured: {} },
      { total: { networkTransferSize: 200, scriptDuration: 100 }, measured: {} },
      { total: { networkTransferSize: 300, scriptDuration: 200 }, measured: {} },
    ];
    const result = buildProfileComparison(['a', 'b', 'c'], data);

    // 'a' wins network, 'b' wins script
    expect(result.total.wins.a).toBe(1);
    expect(result.total.wins.b).toBe(1);
    expect(result.total.wins.c).toBe(0);
    expect(result.total.overallWinner).toBe('tie');
  });

  it('includes rankings for all racers', () => {
    const data = [
      { total: { networkTransferSize: 2000 }, measured: {} },
      { total: { networkTransferSize: 1000 }, measured: {} },
      { total: { networkTransferSize: 3000 }, measured: {} },
      { total: { networkTransferSize: 1500 }, measured: {} },
    ];
    const result = buildProfileComparison(['a', 'b', 'c', 'd'], data);

    const comp = result.total.comparisons.find(c => c.key === 'total.networkTransferSize');
    expect(comp.rankings).toEqual(['b', 'd', 'a', 'c']);
  });

  it('combined wins include all racers', () => {
    const data = [
      { total: { networkTransferSize: 100 }, measured: { networkTransferSize: 200 } },
      { total: { networkTransferSize: 200 }, measured: { networkTransferSize: 100 } },
      { total: { networkTransferSize: 300 }, measured: { networkTransferSize: 300 } },
    ];
    const result = buildProfileComparison(['a', 'b', 'c'], data);

    expect(result.wins.a).toBeDefined();
    expect(result.wins.b).toBeDefined();
    expect(result.wins.c).toBeDefined();
  });

  it('printProfileAnalysis works with 4 racers', () => {
    const data = [
      { total: { networkTransferSize: 1000 }, measured: { networkTransferSize: 500 } },
      { total: { networkTransferSize: 2000 }, measured: { networkTransferSize: 800 } },
      { total: { networkTransferSize: 1500 }, measured: { networkTransferSize: 600 } },
      { total: { networkTransferSize: 3000 }, measured: { networkTransferSize: 1200 } },
    ];
    const racers = ['angular', 'htmx', 'react', 'svelte'];
    const comparison = buildProfileComparison(racers, data);

    const mockWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => printProfileAnalysis(comparison, racers)).not.toThrow();
    mockWrite.mockRestore();
  });

  it('buildProfileMarkdown generates columns for all racers', () => {
    const data = [
      { total: { networkTransferSize: 1000 }, measured: {} },
      { total: { networkTransferSize: 2000 }, measured: {} },
      { total: { networkTransferSize: 1500 }, measured: {} },
    ];
    const racers = ['angular', 'react', 'svelte'];
    const comparison = buildProfileComparison(racers, data);
    const markdown = buildProfileMarkdown(comparison, racers);

    expect(markdown).toContain('angular');
    expect(markdown).toContain('react');
    expect(markdown).toContain('svelte');
    expect(markdown).toContain('| Metric | angular | react | svelte | Winner | Diff |');
  });
});
