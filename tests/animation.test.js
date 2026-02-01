import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RaceAnimation } from '../cli/animation.js';
import { c } from '../cli/colors.js';

describe('c (ANSI color codes)', () => {
  it('exports all expected color codes', () => {
    expect(c.green).toBeDefined();
    expect(c.blue).toBeDefined();
    expect(c.yellow).toBeDefined();
    expect(c.cyan).toBeDefined();
    expect(c.red).toBeDefined();
    expect(c.dim).toBeDefined();
    expect(c.bold).toBeDefined();
    expect(c.reset).toBe('\x1b[0m');
  });
});

describe('RaceAnimation', () => {
  let stderrSpy;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('initializes with correct state', () => {
    const anim = new RaceAnimation(['a', 'b']);
    expect(anim.names).toEqual(['a', 'b']);
    expect(anim.pos).toEqual([0, 0]);
    expect(anim.finished).toEqual([false, false]);
    expect(anim.interval).toBeNull();
  });

  it('start() hides cursor and sets interval', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.start();

    expect(anim.interval).not.toBeNull();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('\x1b[?25l'); // hide cursor
    expect(output).toContain('RaceForThePrice');
    expect(output).toContain('a');
    expect(output).toContain('b');

    anim.stop();
  });

  it('racerFinished sets position and finished flag', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.racerFinished(0);
    expect(anim.finished[0]).toBe(true);
    expect(anim.pos[0]).toBe(50);
    expect(anim.finished[1]).toBe(false);
  });

  it('stop() clears interval and shows cursor', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.start();
    anim.stop();

    expect(anim.interval).toBeNull();
    expect(anim.finished).toEqual([true, true]);
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('\x1b[?25h'); // show cursor
  });

  it('stop() without start() does not throw', () => {
    const anim = new RaceAnimation(['a', 'b']);
    expect(() => anim.stop()).not.toThrow();
  });
});
