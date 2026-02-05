import { describe, it, expect } from 'vitest';
import { formatTimestamp, buildResultsPaths } from '../race.js';

describe('formatTimestamp', () => {
  it('formats date as YYYY-MM-DD_HH-MM-SS', () => {
    const date = new Date('2024-03-15T09:05:07');
    expect(formatTimestamp(date)).toBe('2024-03-15_09-05-07');
  });

  it('pads single-digit values with zeros', () => {
    const date = new Date('2024-01-02T03:04:05');
    expect(formatTimestamp(date)).toBe('2024-01-02_03-04-05');
  });

  it('handles end of year dates', () => {
    const date = new Date('2024-12-31T23:59:59');
    expect(formatTimestamp(date)).toBe('2024-12-31_23-59-59');
  });
});

describe('buildResultsPaths', () => {
  it('returns correct paths for single run', () => {
    const { relResults, relHtml } = buildResultsPaths('/project/races/test/results-2024', 1, '/project');
    expect(relResults).toBe('races/test/results-2024');
    expect(relHtml).toBe('races/test/results-2024/index.html');
  });

  it('returns correct paths for multiple runs', () => {
    const { relResults, relHtml } = buildResultsPaths('/project/races/test/results-2024', 3, '/project');
    expect(relResults).toBe('races/test/results-2024');
    expect(relHtml).toBe('races/test/results-2024/1/index.html');
  });

  it('includes subdirectory 1 for 2 runs', () => {
    const { relHtml } = buildResultsPaths('/project/results', 2, '/project');
    expect(relHtml).toBe('results/1/index.html');
  });

  it('handles same directory as cwd', () => {
    const { relResults, relHtml } = buildResultsPaths('/project/results', 1, '/project/results');
    expect(relResults).toBe('');
    expect(relHtml).toBe('index.html');
  });
});
