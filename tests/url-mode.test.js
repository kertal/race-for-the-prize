import { describe, it, expect } from 'vitest';
import { isUrl, deriveRacerName, buildDefaultRaceScript, applyDefaults } from '../cli/config.js';

describe('isUrl', () => {
  it('recognizes https URLs', () => {
    expect(isUrl('https://react.dev')).toBe(true);
    expect(isUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('recognizes http URLs', () => {
    expect(isUrl('http://localhost:3000')).toBe(true);
    expect(isUrl('http://example.com')).toBe(true);
  });

  it('is case insensitive for protocol', () => {
    expect(isUrl('HTTPS://example.com')).toBe(true);
    expect(isUrl('Http://example.com')).toBe(true);
  });

  it('rejects non-URL strings', () => {
    expect(isUrl('./races/my-race')).toBe(false);
    expect(isUrl('/absolute/path')).toBe(false);
    expect(isUrl('relative/path')).toBe(false);
    expect(isUrl('example.com')).toBe(false);
    expect(isUrl('ftp://files.example.com')).toBe(false);
    expect(isUrl('--parallel')).toBe(false);
  });

  it('rejects bare protocols without hostname', () => {
    expect(isUrl('https://')).toBe(false);
    expect(isUrl('http://')).toBe(false);
  });

  it('rejects degenerate hostnames (dots only)', () => {
    expect(isUrl('https://.')).toBe(false);
    expect(isUrl('https://..')).toBe(false);
    expect(isUrl('https://...')).toBe(false);
  });
});

describe('deriveRacerName', () => {
  it('extracts hostname from URL', () => {
    expect(deriveRacerName('https://react.dev')).toBe('react.dev');
    expect(deriveRacerName('https://angular.dev')).toBe('angular.dev');
  });

  it('strips www prefix', () => {
    expect(deriveRacerName('https://www.example.com')).toBe('example.com');
    expect(deriveRacerName('https://www.google.com/search')).toBe('google.com');
  });

  it('handles URLs with ports', () => {
    expect(deriveRacerName('http://localhost:3000')).toBe('localhost');
  });

  it('handles URLs with paths', () => {
    expect(deriveRacerName('https://docs.python.org/3/library')).toBe('docs.python.org');
  });

  it('handles invalid URLs with fallback', () => {
    const name = deriveRacerName('not-a-url');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('sanitizes filesystem-unsafe characters from hostnames', () => {
    // IPv6 addresses have colons which are invalid on some filesystems
    const name = deriveRacerName('https://[::1]:8080/path');
    expect(name).not.toContain(':');
    expect(name).not.toContain('[');
    expect(name).not.toContain(']');
  });

  it('rejects dangerous filesystem names like . and ..', () => {
    expect(deriveRacerName('https://.')).toBe('url');
    expect(deriveRacerName('https://..')).toBe('url');
  });

  it('strips leading and trailing dots from hostnames', () => {
    expect(deriveRacerName('https://example.com.')).toBe('example.com');
    expect(deriveRacerName('https://.hidden')).toBe('hidden');
  });

  it('truncates very long hostnames', () => {
    const longHost = 'a'.repeat(50) + '.example.com';
    const name = deriveRacerName(`https://${longHost}`);
    expect(name.length).toBeLessThanOrEqual(40);
  });
});

describe('buildDefaultRaceScript', () => {
  it('generates a script that navigates to the URL', () => {
    const script = buildDefaultRaceScript('https://react.dev');
    expect(script).toContain("page.goto(\"https://react.dev\"");
    expect(script).toContain("waitUntil: 'load'");
  });

  it('includes raceStart and raceEnd calls with try/finally', () => {
    const script = buildDefaultRaceScript('https://example.com');
    expect(script).toContain("page.raceStart('Page Load')");
    expect(script).toContain("page.raceEnd('Page Load')");
    expect(script).toContain('try {');
    expect(script).toContain('} finally {');
  });

  it('properly escapes URLs with special characters', () => {
    const script = buildDefaultRaceScript('https://example.com/path?q=1&b=2');
    expect(script).toContain('https://example.com/path?q=1&b=2');
  });

  it('generates different scripts for different URLs', () => {
    const script1 = buildDefaultRaceScript('https://a.com');
    const script2 = buildDefaultRaceScript('https://b.com');
    expect(script1).not.toBe(script2);
  });
});

describe('applyDefaults', () => {
  it('provides all default values for empty settings', () => {
    const result = applyDefaults({});
    expect(result.parallel).toBe(false);
    expect(result.headless).toBe(false);
    expect(result.runs).toBe(1);
    expect(result.format).toBe('webm');
    expect(result.network).toBe('none');
    expect(result.cpuThrottle).toBe(1);
    expect(result.slowmo).toBe(0);
  });

  it('preserves explicitly set values', () => {
    const result = applyDefaults({ parallel: true, runs: 3, format: 'mov' });
    expect(result.parallel).toBe(true);
    expect(result.runs).toBe(3);
    expect(result.format).toBe('mov');
    // Other defaults still applied
    expect(result.headless).toBe(false);
    expect(result.network).toBe('none');
  });

  it('strips null values so defaults apply', () => {
    const result = applyDefaults({ runs: null, format: null });
    expect(result.runs).toBe(1);
    expect(result.format).toBe('webm');
  });

  it('strips undefined values so defaults apply', () => {
    const result = applyDefaults({ runs: undefined, network: undefined });
    expect(result.runs).toBe(1);
    expect(result.network).toBe('none');
  });

  it('keeps falsy but valid values (0, false, empty string)', () => {
    const result = applyDefaults({ slowmo: 0, parallel: false });
    expect(result.slowmo).toBe(0);
    expect(result.parallel).toBe(false);
  });
});
