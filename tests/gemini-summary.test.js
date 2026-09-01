import { describe, it, expect, vi, beforeAll } from 'vitest';
import { buildGeminiPrompt, buildSpecPrompt, parseSpecOutput, extractUrls, isPrivateUrl } from '../cli/gemini-summary.js';

// ---------------------------------------------------------------------------
// buildGeminiPrompt
// ---------------------------------------------------------------------------

describe('buildGeminiPrompt', () => {
  const baseSummary = {
    racers: ['lauda', 'hunt'],
    comparisons: [
      {
        name: 'Load',
        racers: [{ duration: 1.2 }, { duration: 1.8 }],
        winner: 'lauda',
        diff: 0.6,
        diffPercent: 50,
        rankings: ['lauda', 'hunt'],
      },
    ],
    overallWinner: 'lauda',
    wins: { lauda: 1, hunt: 0 },
    profileComparison: null,
    machineInfo: {
      cpuModel: 'Intel Core i9',
      cpuCores: 8,
      totalMemoryMB: 16384,
      platform: 'darwin',
    },
    settings: {},
  };

  it('includes racer names', () => {
    const prompt = buildGeminiPrompt(baseSummary);
    expect(prompt).toContain('lauda');
    expect(prompt).toContain('hunt');
  });

  it('includes timing data with diff', () => {
    const prompt = buildGeminiPrompt(baseSummary);
    expect(prompt).toContain('1.200s');
    expect(prompt).toContain('1.800s');
    expect(prompt).toContain('0.600s');
    expect(prompt).toContain('50.0%');
  });

  it('identifies overall winner', () => {
    const prompt = buildGeminiPrompt(baseSummary);
    expect(prompt).toContain('Overall winner: lauda');
  });

  it('includes machine info', () => {
    const prompt = buildGeminiPrompt(baseSummary);
    expect(prompt).toContain('Intel Core i9');
    expect(prompt).toContain('8 cores');
    expect(prompt).toContain('16384MB RAM');
  });

  it('includes sports reporter instruction', () => {
    const prompt = buildGeminiPrompt(baseSummary);
    expect(prompt.toLowerCase()).toContain('sports reporter');
  });

  it('handles tie result', () => {
    const summary = { ...baseSummary, overallWinner: 'tie' };
    const prompt = buildGeminiPrompt(summary);
    expect(prompt).toContain('TIE');
  });

  it('includes profile comparison when present', () => {
    const summary = {
      ...baseSummary,
      profileComparison: {
        measured: {
          comparisons: [
            {
              name: 'Script Execution',
              values: [120, 80],  // correct field name from buildProfileComparison
              winner: 'hunt',
              diffPercent: 33.3,
              description: 'Time spent executing JavaScript.',
            },
          ],
        },
        total: null,
      },
    };
    const prompt = buildGeminiPrompt(summary);
    expect(prompt).toContain('Script Execution');
    expect(prompt).toContain('Time spent executing JavaScript.');
    expect(prompt).toContain('hunt wins');
  });

  it('profile section is populated (metric.values not metric.racers)', () => {
    // Regression: metric data must appear in the prompt — silently empty output
    // indicates the wrong property name was used.
    const summary = {
      ...baseSummary,
      profileComparison: {
        measured: {
          comparisons: [
            { name: 'Task Duration', values: [50, 90], winner: 'lauda', diffPercent: 80, description: 'Main thread busyness.' },
          ],
        },
        total: null,
      },
    };
    const prompt = buildGeminiPrompt(summary);
    // Both racer values must appear — if metric.racers was used they'd be absent
    expect(prompt).toContain('lauda:');
    expect(prompt).toContain('hunt:');
    expect(prompt).toContain('Task Duration');
  });

  it('includes network/cpu throttle conditions', () => {
    const summary = {
      ...baseSummary,
      settings: { parallel: false, network: 'slow-3g', cpuThrottle: 4 },
    };
    const prompt = buildGeminiPrompt(summary);
    expect(prompt).toContain('network=slow-3g');
    expect(prompt).toContain('cpu throttle ×4');
  });

  it('omits race conditions section when no throttling', () => {
    const summary = { ...baseSummary, settings: { network: 'none', cpuThrottle: 1 } };
    const prompt = buildGeminiPrompt(summary);
    expect(prompt).not.toContain('Race conditions');
  });
});

// ---------------------------------------------------------------------------
// extractUrls
// ---------------------------------------------------------------------------

describe('extractUrls', () => {
  it('extracts https URLs', () => {
    const urls = extractUrls('compare https://google.com and https://bing.com homepage load');
    expect(urls).toEqual(['https://google.com', 'https://bing.com']);
  });

  it('extracts http URLs', () => {
    const urls = extractUrls('test http://example.com performance');
    expect(urls).toEqual(['http://example.com']);
  });

  it('deduplicates the same URL', () => {
    const urls = extractUrls('https://a.com vs https://a.com');
    expect(urls).toEqual(['https://a.com']);
  });

  it('returns empty array when no URLs', () => {
    const urls = extractUrls('compare google and bing');
    expect(urls).toEqual([]);
  });

  it('strips trailing punctuation from URLs', () => {
    const urls = extractUrls('Visit https://google.com. Also check https://bing.com!');
    expect(urls).toEqual(['https://google.com', 'https://bing.com']);
  });

  it('strips trailing parentheses and brackets from URLs', () => {
    const urls = extractUrls('(https://example.com) and [https://test.com]');
    expect(urls).toEqual(['https://example.com', 'https://test.com']);
  });
});

// ---------------------------------------------------------------------------
// isPrivateUrl
// ---------------------------------------------------------------------------

describe('isPrivateUrl', () => {
  const blocked = [
    ['localhost', 'https://localhost/admin'],
    ['127.x loopback', 'https://127.0.0.1:8080/'],
    ['127.x loopback (other octets)', 'https://127.1.2.3/'],
    ['10.x private', 'https://10.0.0.1/'],
    ['10.x private (broadcast)', 'https://10.255.255.255/'],
    ['192.168.x private', 'https://192.168.1.1/'],
    ['172.16 private', 'https://172.16.0.1/'],
    ['172.31 private', 'https://172.31.255.255/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['unparseable URL (fail closed)', 'not-a-url'],
    ['cloud metadata link-local', 'http://169.254.169.254/latest/meta-data/'],
    ['link-local (other)', 'http://169.254.0.1/'],
    ['decimal-encoded loopback', 'http://2130706433/'],
    ['hex-encoded loopback', 'http://0x7f000001/'],
    ['octal first octet', 'http://0177.0.0.1/'],
    ['short-form loopback', 'http://127.1/'],
    ['octal-encoded loopback', 'http://017700000001/'],
    ['CGNAT 100.64/10', 'http://100.64.0.1/'],
    ['benchmarking 198.18/15', 'http://198.18.0.1/'],
    ['trailing-dot localhost', 'http://localhost./'],
    ['trailing-dot loopback', 'http://127.0.0.1./'],
    ['trailing-dot metadata', 'http://169.254.169.254./'],
    ['IPv6 ULA', 'http://[fd00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv6 unspecified', 'http://[::]/'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
    // Fully-expanded / zero-padded IPv6 forms: the WHATWG URL parser normalizes
    // these to their compressed form before the checks run, so they must not
    // slip through as "public". Regression guard for the compressed-only checks.
    ['expanded IPv6 loopback', 'http://[0:0:0:0:0:0:0:1]/'],
    ['expanded IPv6 unspecified', 'http://[0:0:0:0:0:0:0:0]/'],
    ['zero-padded expanded loopback', 'http://[0000:0000:0000:0000:0000:0000:0000:0001]/'],
    ['expanded IPv6 ULA', 'http://[fd00:0:0:0:0:0:0:1]/'],
    ['expanded IPv6 link-local', 'http://[fe80:0:0:0:0:0:0:1]/'],
    ['IETF protocol-assignment 192.0.0.0/24', 'http://192.0.0.1/'],
    ['IPv6 ULA with non-zero hextets', 'http://[fd12:3456:789a::1]/'],
  ];
  const allowed = [
    ['public hostname', 'https://google.com/'],
    ['public IP 8.8.8.8', 'https://8.8.8.8/'],
    ['public IP 1.1.1.1', 'https://1.1.1.1/'],
    ['172.15 (below private range)', 'https://172.15.0.1/'],
    ['172.32 (above private range)', 'https://172.32.0.1/'],
    ['genuine public IP', 'https://93.184.216.34/'],
    ['public IPv6', 'https://[2606:2800:220:1:248:1893:25c8:1946]/'],
    // 192.0.0.0/24 must not over-block the rest of 192.0.0.0/16.
    ['192.0.1.x (outside the /24)', 'https://192.0.1.1/'],
    ['192.0.2.x (outside the /24)', 'https://192.0.2.5/'],
    // First hextet 0x00fc is not in fc00::/7 — must not be misclassified as ULA.
    ['IPv6 0x00fc first hextet (not ULA)', 'https://[fc::1]/'],
  ];

  it.each(blocked)('blocks %s', (_desc, url) => {
    expect(isPrivateUrl(url)).toBe(true);
  });

  it.each(allowed)('allows %s', (_desc, url) => {
    expect(isPrivateUrl(url)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSpecPrompt
// ---------------------------------------------------------------------------

describe('buildSpecPrompt', () => {
  it('includes the user prompt', () => {
    const prompt = buildSpecPrompt('compare loading speed of google vs bing', {});
    expect(prompt).toContain('compare loading speed of google vs bing');
  });

  it('includes Playwright API documentation', () => {
    const prompt = buildSpecPrompt('test something', {});
    expect(prompt).toContain('raceStart');
    expect(prompt).toContain('raceEnd');
    expect(prompt).toContain('raceRecordingStart');
  });

  it('includes expected output format instructions', () => {
    const prompt = buildSpecPrompt('test something', {});
    expect(prompt).toContain('FILE: racer-a.spec.js');
    expect(prompt).toContain('FILE: racer-b.spec.js');
  });

  it('embeds HTML context when provided', () => {
    const htmlByUrl = {
      'https://example.com': '<html><body><h1>Example</h1></body></html>',
    };
    const prompt = buildSpecPrompt('test example.com', htmlByUrl);
    expect(prompt).toContain('https://example.com');
    expect(prompt).toContain('<h1>Example</h1>');
  });

  it('omits HTML section when no URLs provided', () => {
    const prompt = buildSpecPrompt('test something', {});
    expect(prompt).not.toContain('PAGE HTML CONTEXT');
  });
});

// ---------------------------------------------------------------------------
// parseSpecOutput
// ---------------------------------------------------------------------------

describe('parseSpecOutput', () => {
  it('parses two spec files from well-formed output', () => {
    const output = `Here are the specs:

FILE: racer-a.spec.js
\`\`\`javascript
await page.goto('https://google.com');
await page.raceStart('Load');
await page.waitForLoadState('networkidle');
page.raceEnd('Load');
\`\`\`

FILE: racer-b.spec.js
\`\`\`javascript
await page.goto('https://bing.com');
await page.raceStart('Load');
await page.waitForLoadState('networkidle');
page.raceEnd('Load');
\`\`\`
`;
    const files = parseSpecOutput(output);
    expect(Object.keys(files)).toHaveLength(2);
    expect(files['racer-a.spec.js']).toContain("goto('https://google.com')");
    expect(files['racer-b.spec.js']).toContain("goto('https://bing.com')");
  });

  it('returns empty object when no files found', () => {
    const files = parseSpecOutput('Sorry, I cannot help with that.');
    expect(files).toEqual({});
  });

  it('handles code blocks without language tag', () => {
    const output = `FILE: racer-a.spec.js
\`\`\`
await page.goto('https://a.com');
\`\`\`
FILE: racer-b.spec.js
\`\`\`
await page.goto('https://b.com');
\`\`\``;
    const files = parseSpecOutput(output);
    expect(Object.keys(files)).toHaveLength(2);
  });

  it('handles ```js shorthand language tag', () => {
    const output = `FILE: racer-a.spec.js
\`\`\`js
await page.goto('https://a.com');
\`\`\`
FILE: racer-b.spec.js
\`\`\`js
await page.goto('https://b.com');
\`\`\``;
    const files = parseSpecOutput(output);
    expect(Object.keys(files)).toHaveLength(2);
    expect(files['racer-a.spec.js']).toContain("goto('https://a.com')");
  });

  it('rejects unexpected filenames (only racer-a/racer-b allowed)', () => {
    const output = `FILE: racer-a.spec.js
\`\`\`javascript
await page.goto('https://a.com');
\`\`\`
FILE: evil.spec.js
\`\`\`javascript
await page.goto('https://evil.com');
\`\`\`
FILE: racer-b.spec.js
\`\`\`javascript
await page.goto('https://b.com');
\`\`\``;
    const files = parseSpecOutput(output);
    expect(Object.keys(files)).toHaveLength(2);
    expect(files['evil.spec.js']).toBeUndefined();
    expect(files['racer-a.spec.js']).toBeDefined();
    expect(files['racer-b.spec.js']).toBeDefined();
  });

  it('strips leading/trailing whitespace from file content', () => {
    const output = `FILE: racer-a.spec.js
\`\`\`javascript
  await page.goto('https://a.com');
  \`\`\`
FILE: racer-b.spec.js
\`\`\`javascript
await page.goto('https://b.com');
\`\`\``;
    const files = parseSpecOutput(output);
    expect(files['racer-a.spec.js']).toBe("await page.goto('https://a.com');");
  });

  it('handles CRLF line endings in language tag', () => {
    // Regression: Windows-style \r\n line endings must not leave "javascript\r"
    // at the start of the generated spec.
    const crlfOutput = `FILE: racer-a.spec.js\r\n\`\`\`javascript\r\nawait page.goto('https://a.com');\r\npage.raceEnd('Load');\r\n\`\`\`\r\nFILE: racer-b.spec.js\r\n\`\`\`javascript\r\nawait page.goto('https://b.com');\r\n\`\`\``;
    const files = parseSpecOutput(crlfOutput);
    expect(Object.keys(files)).toHaveLength(2);
    expect(files['racer-a.spec.js']).toContain("goto('https://a.com')");
    // Language tag must not appear in the output
    expect(files['racer-a.spec.js']).not.toMatch(/^javascript/);
  });

  it('does not corrupt code when Gemini omits the language tag', () => {
    // Regression: the strip regex must not eat the first line of code when
    // Gemini writes ``` with no language tag immediately followed by code.
    const output = `FILE: racer-a.spec.js
\`\`\`
await page.goto('https://a.com');
page.raceEnd('Load');
\`\`\`
FILE: racer-b.spec.js
\`\`\`
await page.goto('https://b.com');
page.raceEnd('Load');
\`\`\``;
    const files = parseSpecOutput(output);
    // The "await" keyword must not be stripped from the first line
    expect(files['racer-a.spec.js']).toContain("await page.goto('https://a.com')");
    expect(files['racer-b.spec.js']).toContain("await page.goto('https://b.com')");
  });
});

// ---------------------------------------------------------------------------
// invokeGemini (error handling — mocked spawnSync)
// ---------------------------------------------------------------------------

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawnSync: vi.fn() };
});

describe('invokeGemini', () => {
  let spawnSync, invokeGemini;

  beforeAll(async () => {
    ({ spawnSync } = await import('child_process'));
    ({ invokeGemini } = await import('../cli/gemini-summary.js'));
  });

  it('throws a helpful install message when gemini CLI is not found (ENOENT)', () => {
    spawnSync.mockReturnValue({ error: { code: 'ENOENT' }, status: null, stdout: '', stderr: '' });
    expect(() => invokeGemini('hello')).toThrow(/Gemini CLI not found.*npm install -g @google\/gemini-cli/s);
  });

  it('throws a timeout message on ETIMEDOUT', () => {
    spawnSync.mockReturnValue({ error: { code: 'ETIMEDOUT' }, status: null, stdout: '', stderr: '' });
    expect(() => invokeGemini('hello')).toThrow(/timed out after 120s/);
  });

  it('throws the stderr message on non-zero exit code', () => {
    spawnSync.mockReturnValue({ error: null, status: 1, stdout: '', stderr: 'auth error' });
    expect(() => invokeGemini('hello')).toThrow('auth error');
  });

  it('returns trimmed stdout on success', () => {
    spawnSync.mockReturnValueOnce({ error: null, status: 0, stdout: '  Great race!\n', stderr: '' });
    expect(invokeGemini('hello')).toBe('Great race!');
  });

  it('passes the prompt via stdin (input option, no -p argument)', () => {
    spawnSync.mockReturnValueOnce({ error: null, status: 0, stdout: 'ok', stderr: '' });
    invokeGemini('my prompt');
    const [cmd, args, opts] = spawnSync.mock.calls.at(-1);
    expect(cmd).toBe('gemini');
    expect(args).toEqual([]);
    expect(opts.input).toBe('my prompt');
  });
});
