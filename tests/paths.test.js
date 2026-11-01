import { describe, it, expect } from 'vitest';
import { raceVideoFile, fullVideoFile, traceFile, harFile, racerRelative } from '../cli/paths.js';
import { FORMAT_EXTENSIONS } from '../cli/media-config.js';

describe('paths', () => {
  it('builds race video filenames, defaulting to webm', () => {
    expect(raceVideoFile('lauda')).toBe('lauda.race.webm');
    expect(raceVideoFile('lauda', FORMAT_EXTENSIONS.mov)).toBe('lauda.race.mov');
    expect(raceVideoFile('lauda', FORMAT_EXTENSIONS.gif)).toBe('lauda.race.gif');
  });

  it('builds full video filenames, defaulting to webm', () => {
    expect(fullVideoFile('hunt')).toBe('hunt.full.webm');
    expect(fullVideoFile('hunt', FORMAT_EXTENSIONS.mov)).toBe('hunt.full.mov');
  });

  it('builds trace and har filenames', () => {
    expect(traceFile('lauda')).toBe('lauda.trace.json');
    expect(harFile('lauda')).toBe('lauda.har');
  });

  it('builds racer-relative paths with forward slashes', () => {
    expect(racerRelative('lauda', raceVideoFile('lauda'))).toBe('lauda/lauda.race.webm');
    expect(racerRelative('hunt', traceFile('hunt'))).toBe('hunt/hunt.trace.json');
    expect(racerRelative('hunt', harFile('hunt'))).toBe('hunt/hunt.har');
  });
});
