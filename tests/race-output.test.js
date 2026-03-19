import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimestamp, buildResultsPaths, waitForEnter } from '../race.js';

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
  it('returns relative paths from cwd', () => {
    const { relResults, relHtml } = buildResultsPaths('/project/races/test/results-2024', '/project');
    expect(relResults).toBe('races/test/results-2024');
    expect(relHtml).toBe('races/test/results-2024/index.html');
  });

  it('always points to top-level index.html', () => {
    const { relHtml } = buildResultsPaths('/project/results', '/project');
    expect(relHtml).toBe('results/index.html');
  });

  it('handles same directory as cwd', () => {
    const { relResults, relHtml } = buildResultsPaths('/project/results', '/project/results');
    expect(relResults).toBe('');
    expect(relHtml).toBe('index.html');
  });
});

function setupTTYStdin() {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
  Object.defineProperty(process.stdin, 'readableEnded', { value: false, writable: true, configurable: true });
  if (!process.stdin.setRawMode) process.stdin.setRawMode = () => {};
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {});
  const setRawModeSpy = vi.spyOn(process.stdin, 'setRawMode').mockImplementation(() => {});
  const pauseSpy = vi.spyOn(process.stdin, 'pause').mockImplementation(() => {});
  const resumeSpy = vi.spyOn(process.stdin, 'resume').mockImplementation(() => {});
  return { stderrSpy, setRawModeSpy, pauseSpy, resumeSpy };
}

describe('waitForEnter', () => {
  let origIsTTY;

  beforeEach(() => {
    origIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });


  it('resolves immediately in non-TTY environments', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {});
    await waitForEnter('test prompt ');
    expect(stderrSpy).toHaveBeenCalledWith('test prompt  (skipped — non-interactive)\n');
    stderrSpy.mockRestore();
  });

  it('resolves when data is received on a TTY stdin', async () => {
    vi.useFakeTimers();
    const { stderrSpy } = setupTTYStdin();

    const promise = waitForEnter('press enter ');
    await vi.runAllTimersAsync(); // advance past the drain timeout
    process.stdin.emit('data', '\n');
    await promise;

    vi.useRealTimers();
    expect(stderrSpy).toHaveBeenCalledWith('press enter ');
  });

  it('resolves when stdin emits end event', async () => {
    vi.useFakeTimers();
    const { stderrSpy } = setupTTYStdin();

    const promise = waitForEnter('prompt ');
    await vi.runAllTimersAsync();
    process.stdin.emit('end');
    await promise;

    vi.useRealTimers();
    expect(stderrSpy).toHaveBeenCalledWith('prompt ');
  });

  it('ignores type-ahead data emitted before the drain timeout', async () => {
    vi.useFakeTimers();
    const { stderrSpy } = setupTTYStdin();

    const promise = waitForEnter('prompt ');
    // Emit data immediately (before drain timeout) — should be discarded
    process.stdin.emit('data', '\n');

    // Advance past the drain timeout
    await vi.runAllTimersAsync();

    // Promise should NOT have resolved yet (the early data was drained)
    let resolved = false;
    promise.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Now emit data after drain — should resolve
    process.stdin.emit('data', '\n');
    await promise;

    vi.useRealTimers();
    stderrSpy.mockRestore();
  });

  it('resolves when stdin emits error event', async () => {
    vi.useFakeTimers();
    setupTTYStdin();

    const promise = waitForEnter('prompt ');
    await vi.runAllTimersAsync();
    process.stdin.emit('error', new Error('test'));
    await promise;

    vi.useRealTimers();
  });
});
