import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RaceAnimation, startProgress } from '../cli/animation.js';
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
  let originalIsTTY;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    originalIsTTY = process.stderr.isTTY;
    // Force TTY mode so the animated path (spinner + cursor codes) is exercised
    // even under vitest's non-TTY stderr.
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
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

  it('shows info line when provided', () => {
    const anim = new RaceAnimation(['a', 'b'], 'test info');
    anim.start();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('test info');
    anim.stop();
  });

  it('racerFinished is idempotent', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.racerFinished(0);
    anim.racerFinished(0);
    expect(anim.finished[0]).toBe(true);
    expect(anim.finished[1]).toBe(false);
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

describe('startProgress', () => {
  let stderrSpy;
  let originalIsTTY;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('writes initial message to stderr', () => {
    const p = startProgress('Loading...');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Loading...');
    p.done();
  });

  it('done() clears interval and writes completion message', () => {
    const p = startProgress('Working');
    p.done('Done!');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Done!');
    expect(output).toContain('✓');
  });

  it('done() uses original message when no doneMsg provided', () => {
    const p = startProgress('Working');
    p.done();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Working');
  });

  it('update() changes the message', async () => {
    const p = startProgress('Step 1');
    stderrSpy.mockClear(); // Clear initial write
    p.update('Step 2');

    // Wait for at least one interval tick (100ms interval + 50ms buffer)
    await new Promise(resolve => setTimeout(resolve, 150));

    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Step 2');
    p.done('Finished');
  });

  it('fail() writes failure message', () => {
    const p = startProgress('Working');
    p.fail('Something went wrong');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Something went wrong');
  });
});

describe('startProgress — non-TTY fallback', () => {
  let stderrSpy;
  let originalIsTTY;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('writes the initial message exactly once (no spinner frames)', () => {
    const p = startProgress('Loading');
    // Give any accidental spinner interval time to fire.
    return new Promise(resolve => setTimeout(resolve, 120)).then(() => {
      const writes = stderrSpy.mock.calls.map(c => c[0]);
      expect(writes).toEqual(['  Loading\n']);
      p.done('Done');
    });
  });

  it('emits no ANSI escape sequences', () => {
    const p = startProgress('Step');
    p.update('Step 2');
    p.done('Finished');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).not.toMatch(/\x1b\[/);
  });

  it('done() uses plain-text ✓ prefix and falls back to original message', () => {
    const p = startProgress('Working');
    stderrSpy.mockClear();
    p.done();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toBe('  ✓ Working\n');
  });

  it('done() uses the supplied doneMsg', () => {
    const p = startProgress('Working');
    stderrSpy.mockClear();
    p.done('All set');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toBe('  ✓ All set\n');
  });

  it('fail() prints without the ✓ prefix', () => {
    const p = startProgress('Working');
    stderrSpy.mockClear();
    p.fail('Broken');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toBe('  Broken\n');
  });
});

describe('RaceAnimation — non-TTY fallback', () => {
  let stderrSpy;
  let originalIsTTY;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('start() emits a plain-text header and no cursor/spinner codes', () => {
    const anim = new RaceAnimation(['alpha', 'beta'], 'my info');
    anim.start();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('RaceForThePrize');
    expect(output).toContain('alpha vs beta');
    expect(output).toContain('my info');
    expect(output).not.toMatch(/\x1b\[/);
    expect(anim.interval).toBeNull();
    anim.stop();
  });

  it('addMessage() prints plain-text lines without ANSI', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.start();
    stderrSpy.mockClear();
    anim.addMessage(0, 'a', 'hello', '1.2');
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toBe('  a: "hello" (1.2s)\n');
  });

  it('stop() emits plain-text results message without cursor codes', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.start();
    stderrSpy.mockClear();
    anim.stop();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toBe('  Calculating results…\n');
    expect(output).not.toContain('\x1b[?25h');
  });
});
