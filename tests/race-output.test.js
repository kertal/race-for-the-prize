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
  let origStdin;
  let origSetRawMode;

  beforeEach(() => {
    origStdin = {
      isTTY: process.stdin.isTTY,
      readableEnded: process.stdin.readableEnded,
    };
    origSetRawMode = process.stdin.setRawMode;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: origStdin.isTTY, writable: true, configurable: true });
    Object.defineProperty(process.stdin, 'readableEnded', { value: origStdin.readableEnded, writable: true, configurable: true });
    if (origSetRawMode) {
      process.stdin.setRawMode = origSetRawMode;
    } else {
      delete process.stdin.setRawMode;
    }
  });

  it('resolves immediately in non-TTY environments', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {});
    await waitForEnter('test prompt ');
    expect(stderrSpy).toHaveBeenCalledWith('test prompt (skipped — non-interactive)\n');
    stderrSpy.mockRestore();
  });

  it('resolves immediately when stdin has already ended', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
    Object.defineProperty(process.stdin, 'readableEnded', { value: true, writable: true, configurable: true });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => {});
    await waitForEnter('test prompt ');
    expect(stderrSpy).toHaveBeenCalledWith('test prompt (skipped — non-interactive)\n');
    stderrSpy.mockRestore();
  });

  it('resolves when Enter key is pressed on a TTY stdin', async () => {
    const { stderrSpy, setRawModeSpy } = setupTTYStdin();

    const promise = waitForEnter('press enter ');
    process.stdin.emit('data', '\r');
    await promise;

    expect(stderrSpy).toHaveBeenCalledWith('press enter ');
    expect(setRawModeSpy).toHaveBeenCalledWith(true);
    expect(setRawModeSpy).toHaveBeenCalledWith(false);
  });

  it('resolves when stdin emits end event', async () => {
    const { stderrSpy } = setupTTYStdin();

    const promise = waitForEnter('prompt ');
    process.stdin.emit('end');
    await promise;

    expect(stderrSpy).toHaveBeenCalledWith('prompt ');
  });

  it('resolves when stdin emits error event', async () => {
    setupTTYStdin();

    const promise = waitForEnter('prompt ');
    process.stdin.emit('error', new Error('test'));
    await promise;
  });

  it('sends SIGINT when Ctrl+C is received in raw mode', async () => {
    setupTTYStdin();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {});

    waitForEnter('prompt ');
    process.stdin.emit('data', '\u0003');

    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT');
    killSpy.mockRestore();
  });

  it('ignores non-Enter keystrokes', async () => {
    setupTTYStdin();

    const promise = waitForEnter('prompt ');
    process.stdin.emit('data', 'a');
    process.stdin.emit('data', 'b');
    process.stdin.emit('data', '\n');
    await promise;
  });
});
