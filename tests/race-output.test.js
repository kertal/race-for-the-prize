import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimestamp, buildResultsPaths, buildConditionIndexHtml, waitForEnter, findMissingBrowser } from '../race.js';

describe('findMissingBrowser', () => {
  const playwright = executablePath => async () => ({ chromium: { executablePath: () => executablePath } });

  it('passes when the Chromium executable is on disk', async () => {
    const result = await findMissingBrowser({
      importPlaywright: playwright('/browsers/chromium/chrome'),
      exists: () => true,
    });
    expect(result).toBeNull();
  });

  it('names the chromium-only download when the browser is missing', async () => {
    // Playwright's own error suggests the full-suite "npx playwright install";
    // this project only ever launches Chromium.
    const result = await findMissingBrowser({
      importPlaywright: playwright('/browsers/chromium/chrome'),
      exists: () => false,
    });
    expect(result).toContain('npx playwright install chromium');
    expect(result).toContain('postinstall');
  });

  it('reports the package itself being absent', async () => {
    const result = await findMissingBrowser({
      importPlaywright: async () => { throw new Error('Cannot find module'); },
      exists: () => true,
    });
    expect(result).toContain('Playwright is not installed');
  });

  it('stays quiet when Playwright will not name an executable', async () => {
    // Custom channels and unusual layouts make executablePath() throw; there is
    // nothing to check, so the runner should get its chance to report instead.
    const result = await findMissingBrowser({
      importPlaywright: async () => ({ chromium: { executablePath: () => { throw new Error('no path'); } } }),
      exists: () => false,
    });
    expect(result).toBeNull();
  });

  it('stays quiet when the executable path is empty', async () => {
    const result = await findMissingBrowser({ importPlaywright: playwright(''), exists: () => false });
    expect(result).toBeNull();
  });
});

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
  /** Render an index page and assert on the strings it must (and must not) contain. */
  const expectIndex = (raceTitle, entries, { has = [], hasNot = [] }) => {
    const html = buildConditionIndexHtml(raceTitle, entries);
    for (const needle of has) expect(html).toContain(needle);
    for (const needle of hasNot) expect(html).not.toContain(needle);
  };

  it('links each condition to its results player', () => {
    expectIndex('lauda vs hunt', [
      { label: 'slow-3g', title: 'Network: slow-3g', summary: { overallWinner: 'lauda' } },
      { label: '4g', title: 'Network: 4g', summary: { overallWinner: 'hunt' } },
    ], { has: ['lauda vs hunt', 'href="slow-3g/index.html"', 'href="4g/index.html"', '🏆 lauda', '🏆 hunt'] });
  });

  it('links CPU-only conditions by their label', () => {
    expectIndex('a vs b', [
      { label: 'cpu1x', title: 'CPU: 1x', summary: { overallWinner: 'a' } },
      { label: 'cpu4x', title: 'CPU: 4x', summary: { overallWinner: 'b' } },
    ], { has: ['href="cpu1x/index.html"', 'href="cpu4x/index.html"', 'CPU: 4x'] });
  });

  it('falls back to the label when no title is given', () => {
    expectIndex('a vs b', [{ label: 'slow-3g-cpu4x', summary: null }], {
      has: ['href="slow-3g-cpu4x/index.html"', '>slow-3g-cpu4x<'],
    });
  });

  it('shows a placeholder when a summary has no winner', () => {
    expectIndex('a vs b', [
      { label: 'none', summary: { overallWinner: null } },
      { label: 'fast-3g', summary: null },
    ], { has: ['href="none/index.html"', '—'], hasNot: ['🏆'] });
  });

  it('renders a tie without the winner trophy', () => {
    expectIndex('a vs b', [{ label: '4g', summary: { overallWinner: 'tie' } }], {
      has: ['🤝 Tie'],
      hasNot: ['🏆'],
    });
  });

  it('escapes HTML in titles and winner names', () => {
    expectIndex('<b>x</b> vs y', [
      { label: 'none', title: '<i>net</i>', summary: { overallWinner: 'a<script>' } },
    ], { has: ['&lt;b&gt;x&lt;/b&gt;'], hasNot: ['<b>x</b>', '<i>net</i>', 'a<script>'] });
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
