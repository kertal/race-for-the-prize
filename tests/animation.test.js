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
    expect(anim.finished).toEqual([false, false]);
    expect(anim.interval).toBeNull();
  });

  it('start() hides cursor and sets interval', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.start();

    expect(anim.interval).not.toBeNull();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('\x1b[?25l'); // hide cursor
    expect(output).toContain('RaceForThePrize');
    expect(output).toContain('a');
    expect(output).toContain('b');

    anim.stop();
  });

  it('racerFinished sets finished flag', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.racerFinished(0);
    expect(anim.finished[0]).toBe(true);
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

  it('initializes finished array for 3 racers', () => {
    const anim = new RaceAnimation(['a', 'b', 'c']);
    expect(anim.finished).toEqual([false, false, false]);
  });

  it('initializes finished array for 5 racers', () => {
    const anim = new RaceAnimation(['a', 'b', 'c', 'd', 'e']);
    expect(anim.finished).toEqual([false, false, false, false, false]);
  });

  it('racerFinished works for any index', () => {
    const anim = new RaceAnimation(['a', 'b', 'c', 'd', 'e']);
    anim.racerFinished(2);
    anim.racerFinished(4);
    expect(anim.finished).toEqual([false, false, true, false, true]);
  });

  it('stop() marks all racers as finished', () => {
    const anim = new RaceAnimation(['a', 'b', 'c', 'd']);
    anim.start();
    anim.stop();
    expect(anim.finished).toEqual([true, true, true, true]);
  });

  it('header includes all racer names', () => {
    const anim = new RaceAnimation(['alpha', 'beta', 'gamma']);
    anim.start();
    anim.stop();

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
    expect(output).toContain('gamma');
    expect(output).toContain('vs');
  });
});
