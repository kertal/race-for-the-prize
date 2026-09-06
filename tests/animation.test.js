import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RaceAnimation, startProgress, fitMessageText } from '../cli/animation.js';
import { c } from '../cli/colors.js';

/**
 * Install per-test hooks that mock process.stderr.write and force
 * process.stderr.isTTY to a given value. Returns a getter for the spy.
 */
function setupStderrSpy(isTTY) {
  const ctx = { spy: null, original: null };
  beforeEach(() => {
    ctx.spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    ctx.original = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: isTTY, configurable: true });
  });
  afterEach(() => {
    ctx.spy.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', { value: ctx.original, configurable: true });
  });
  return {
    get stderrSpy() { return ctx.spy; },
    output() { return ctx.spy.mock.calls.map(call => call[0]).join(''); },
  };
}

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
  const stderr = setupStderrSpy(true);

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
    expect(stderr.output()).toContain('\x1b[?25l'); // hide cursor
    expect(stderr.output()).toContain('RaceForThePrize');
    expect(stderr.output()).toContain('a');
    expect(stderr.output()).toContain('b');

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
    expect(stderr.output()).toContain('\x1b[?25h'); // show cursor
  });

  it('stop() without start() does not throw', () => {
    const anim = new RaceAnimation(['a', 'b']);
    expect(() => anim.stop()).not.toThrow();
  });

  it('shows info line when provided', () => {
    const anim = new RaceAnimation(['a', 'b'], 'test info');
    anim.start();
    expect(stderr.output()).toContain('test info');
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

    const output = stderr.output();
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
    expect(output).toContain('gamma');
    expect(output).toContain('vs');
  });

  it('clamps long messages so no rendered line wraps', () => {
    // A line that wraps costs two terminal rows but only one cursor-up rewind,
    // so every tick strands the previous frame on screen.
    const original = process.stderr.columns;
    Object.defineProperty(process.stderr, 'columns', { value: 80, configurable: true });
    try {
      const anim = new RaceAnimation(['encrypted-cache', 'a-racer-name-far-too-long-to-fit-in-any-sensible-terminal-row']);
      anim.start();
      anim.addMessage(0, 'encrypted-cache',
        'Fetched from network in 338 ms, encrypted + cached in 114 ms · rendered in 474 ms total', '0.7');
      anim.addMessage(1, 'a-racer-name-far-too-long-to-fit-in-any-sensible-terminal-row', 'short', '1.2');
      // Only the redraw region has to fit: the header is written once, before
      // the loop, and is never rewound over.
      stderr.stderrSpy.mockClear();
      anim._tick();
      anim.stop();

      const rows = stderr.output().split('\n');
      // eslint-disable-next-line no-control-regex
      const visible = rows.map(row => row.replaceAll(/\x1b\[[0-9;?]*[a-zA-Z]/g, ''));
      expect(visible.some(row => row.includes('encrypted-cache:'))).toBe(true);
      for (const row of visible) expect(row.length).toBeLessThan(80);
    } finally {
      Object.defineProperty(process.stderr, 'columns', { value: original, configurable: true });
    }
  });
});

describe('fitMessageText', () => {
  it('leaves a message that already fits untouched', () => {
    expect(fitMessageText('short', 10, 80)).toBe('short');
  });

  it('truncates so text + chrome stays inside the width', () => {
    const text = 'x'.repeat(200);
    const fitted = fitMessageText(text, 20, 80);
    expect(fitted.length + 20).toBeLessThan(80);
    expect(fitted.endsWith('…')).toBe(true);
  });

  it('never returns more than the room left over', () => {
    // Overflowing by even one column causes the wrap this function prevents,
    // so a narrow terminal gets a stub or nothing rather than a minimum length.
    for (let chrome = 70; chrome <= 82; chrome++) {
      const fitted = fitMessageText('x'.repeat(50), chrome, 80);
      expect(fitted.length).toBeLessThanOrEqual(Math.max(0, 80 - 1 - chrome));
    }
    expect(fitMessageText('x'.repeat(50), 78, 80)).toBe('…');
    expect(fitMessageText('x'.repeat(50), 79, 80)).toBe('');
    expect(fitMessageText('x'.repeat(50), 200, 80)).toBe('');
  });
});

describe('startProgress', () => {
  const stderr = setupStderrSpy(true);

  it('writes initial message to stderr', () => {
    const p = startProgress('Loading...');
    expect(stderr.output()).toContain('Loading...');
    p.done();
  });

  it('done() clears interval and writes completion message', () => {
    const p = startProgress('Working');
    p.done('Done!');
    const output = stderr.output();
    expect(output).toContain('Done!');
    expect(output).toContain('✓');
  });

  it('done() uses original message when no doneMsg provided', () => {
    const p = startProgress('Working');
    p.done();
    expect(stderr.output()).toContain('Working');
  });

  it('update() changes the message', async () => {
    const p = startProgress('Step 1');
    stderr.stderrSpy.mockClear(); // Clear initial write
    p.update('Step 2');

    // Wait for at least one interval tick (100ms interval + 50ms buffer)
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(stderr.output()).toContain('Step 2');
    p.done('Finished');
  });

  it('fail() writes failure message', () => {
    const p = startProgress('Working');
    p.fail('Something went wrong');
    expect(stderr.output()).toContain('Something went wrong');
  });
});

describe('startProgress — non-TTY fallback', () => {
  const stderr = setupStderrSpy(false);

  it('writes the initial message exactly once (no spinner frames)', () => {
    const p = startProgress('Loading');
    // Give any accidental spinner interval time to fire.
    return new Promise(resolve => setTimeout(resolve, 120)).then(() => {
      const writes = stderr.stderrSpy.mock.calls.map(call => call[0]);
      expect(writes).toEqual(['  Loading\n']);
      p.done('Done');
    });
  });

  it('emits no ANSI escape sequences', () => {
    const p = startProgress('Step');
    p.update('Step 2');
    p.done('Finished');
    expect(stderr.output()).not.toMatch(/\x1b\[/);
  });

  it('done() uses plain-text ✓ prefix and falls back to original message', () => {
    const p = startProgress('Working');
    stderr.stderrSpy.mockClear();
    p.done();
    expect(stderr.output()).toBe('  ✓ Working\n');
  });

  it('done() uses the supplied doneMsg', () => {
    const p = startProgress('Working');
    stderr.stderrSpy.mockClear();
    p.done('All set');
    expect(stderr.output()).toBe('  ✓ All set\n');
  });

  it('fail() prints without the ✓ prefix', () => {
    const p = startProgress('Working');
    stderr.stderrSpy.mockClear();
    p.fail('Broken');
    expect(stderr.output()).toBe('  Broken\n');
  });
});

describe('RaceAnimation — non-TTY fallback', () => {
  const stderr = setupStderrSpy(false);

  it('start() emits a plain-text header and no cursor/spinner codes', () => {
    const anim = new RaceAnimation(['alpha', 'beta'], 'my info');
    anim.start();
    const output = stderr.output();
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
    stderr.stderrSpy.mockClear();
    anim.addMessage(0, 'a', 'hello', '1.2');
    expect(stderr.output()).toBe('  a: "hello" (1.2s)\n');
  });

  it('stop() emits plain-text results message without cursor codes', () => {
    const anim = new RaceAnimation(['a', 'b']);
    anim.start();
    stderr.stderrSpy.mockClear();
    anim.stop();
    const output = stderr.output();
    expect(output).toBe('  Calculating results…\n');
    expect(output).not.toContain('\x1b[?25h');
  });
});
