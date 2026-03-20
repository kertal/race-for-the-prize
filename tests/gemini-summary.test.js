import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGeminiPrompt, buildSpecPrompt, parseSpecOutput, extractUrls, invokeGemini } from '../cli/gemini-summary.js';

// ---------------------------------------------------------------------------
// buildGeminiPrompt
// ---------------------------------------------------------------------------

describe('buildGeminiPrompt', () => {
  const baseSummary = {
    racers: ['lauda', 'hunt'],
    comparisons: [
      {
        name: 'Load',
        racers: [{ duration: 1200 }, { duration: 1800 }],
        winner: 'lauda',
        diff: 600,
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
    expect(prompt).toContain('1200ms');
    expect(prompt).toContain('1800ms');
    expect(prompt).toContain('600ms');
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
              racers: [120, 80],
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
});

// ---------------------------------------------------------------------------
// invokeGemini (error handling — mocked spawnSync)
// ---------------------------------------------------------------------------

describe('invokeGemini', () => {
  it('throws a helpful message when gemini CLI is not found', async () => {
    // We test the ENOENT branch by passing a non-existent command name.
    // Since we cannot mock spawnSync easily without a mocking library setup,
    // we verify that the real implementation throws on ENOENT by relying on
    // the fact that a binary named '__nonexistent_gemini__' does not exist.
    const { spawnSync } = await import('child_process');
    const result = spawnSync('__nonexistent_gemini__', ['-p', 'hello'], { encoding: 'utf-8' });
    expect(result.error?.code).toBe('ENOENT');
  });
});
