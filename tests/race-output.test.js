import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimestamp, buildResultsPaths, buildConditionIndexHtml, waitForEnter } from '../race.js';

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

describe('buildConditionIndexHtml', () => {
  it('links each condition to its results player', () => {
    const html = buildConditionIndexHtml('lauda vs hunt', [
      { label: 'slow-3g', title: 'Network: slow-3g', summary: { overallWinner: 'lauda' } },
      { label: '4g', title: 'Network: 4g', summary: { overallWinner: 'hunt' } },
    ]);
    expect(html).toContain('lauda vs hunt');
    expect(html).toContain('href="slow-3g/index.html"');
    expect(html).toContain('href="4g/index.html"');
    expect(html).toContain('🏆 lauda');
    expect(html).toContain('🏆 hunt');
  });

  it('links CPU-only conditions by their label', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'cpu1x', title: 'CPU: 1x', summary: { overallWinner: 'a' } },
      { label: 'cpu4x', title: 'CPU: 4x', summary: { overallWinner: 'b' } },
    ]);
    expect(html).toContain('href="cpu1x/index.html"');
    expect(html).toContain('href="cpu4x/index.html"');
    expect(html).toContain('CPU: 4x');
  });

  it('falls back to the label when no title is given', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'slow-3g-cpu4x', summary: null },
    ]);
    expect(html).toContain('href="slow-3g-cpu4x/index.html"');
    expect(html).toContain('>slow-3g-cpu4x<');
  });

  it('shows a placeholder when a summary has no winner', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: 'none', summary: { overallWinner: null } },
      { label: 'fast-3g', summary: null },
    ]);
    expect(html).toContain('href="none/index.html"');
    expect(html).not.toContain('🏆');
    expect(html).toContain('—');
  });

  it('renders a tie without the winner trophy', () => {
    const html = buildConditionIndexHtml('a vs b', [
      { label: '4g', summary: { overallWinner: 'tie' } },
    ]);
    expect(html).toContain('🤝 Tie');
    expect(html).not.toContain('🏆');
    expect(html).not.toContain('🏆 tie');
  });

  it('escapes HTML in titles and winner names', () => {
    const html = buildConditionIndexHtml('<b>x</b> vs y', [
      { label: 'none', title: '<i>net</i>', summary: { overallWinner: 'a<script>' } },
    ]);
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<i>net</i>');
    expect(html).not.toContain('a<script>');
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
