/**
 * Gemini CLI integration for race analysis and spec generation.
 *
 * Two features:
 *   1. buildGeminiPrompt / runGeminiSummary  — post-race sports reporter commentary
 *   2. buildSpecPrompt / runGeminiSpec       — generate race spec files from a natural-language prompt
 */

import { spawnSync } from 'child_process';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Invoke the `gemini` CLI, passing `prompt` via stdin. Returns stdout string or throws. */
export function invokeGemini(prompt) {
  const result = spawnSync('gemini', [], { // NOSONAR — gemini CLI resolved via PATH is intentional
    input: prompt,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('Gemini CLI not found. Install it with: npm install -g @google/gemini-cli');
    }
    throw new Error(`Gemini CLI error: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || '';
    throw new Error(`Gemini CLI exited with code ${result.status}${stderr ? ': ' + stderr : ''}`);
  }

  return result.stdout?.trim() || '';
}

// ---------------------------------------------------------------------------
// Feature 1: Post-race sports reporter summary
// ---------------------------------------------------------------------------

/**
 * Build a rich text prompt from a race summary object.
 * Includes timing comparisons, profile metrics with descriptions, and machine info.
 */
export function buildGeminiPrompt(summary) {
  const { racers = [], comparisons, overallWinner, wins, profileComparison, machineInfo, settings } = summary;

  if (racers.length === 0) {
    throw new Error('Summary has no racers — cannot build prompt');
  }

  const lines = [];

  lines.push('You are an enthusiastic sports reporter covering a browser performance race.');
  lines.push('Summarize the following race results as if you were commenting live from the pit lane.');
  lines.push('Be vivid, use racing metaphors, and crucially: explain WHY the winner was faster or slower');
  lines.push('by interpreting the performance profile data below.');
  lines.push('Focus on the MOST SIGNIFICANT differences in the profile metrics — highlight metrics where');
  lines.push('one racer clearly outperforms the other (large percentage differences, outsized resource usage,');
  lines.push('or dramatically different network/rendering patterns). Skip metrics that are roughly equal.');
  lines.push('Keep it under 300 words.\n');

  lines.push('## Race participants');
  lines.push(racers.map((r, i) => `  ${i + 1}. ${r}`).join('\n'));

  lines.push('\n## Timing results');
  for (const comp of (comparisons || [])) {
    const times = (comp.racers || []).map((r, i) => r ? `${racers[i]}: ${r.duration.toFixed(3)}s` : null).filter(Boolean);
    const winStr = comp.winner ? ` → winner: ${comp.winner} by ${comp.diff?.toFixed(3)}s (${comp.diffPercent?.toFixed(1)}% faster)` : ' → tie';
    lines.push(`  "${comp.name}": ${times.join(' vs ')}${winStr}`);
  }

  if (overallWinner && overallWinner !== 'tie') {
    const winsCount = wins?.[overallWinner] ?? 0;
    lines.push(`\n  Overall winner: ${overallWinner} (won ${winsCount} of ${comparisons?.length ?? 0} measurements)`);
  } else if (overallWinner === 'tie') {
    lines.push('\n  Overall result: TIE');
  }

  if (profileComparison) {
    lines.push('\n## Performance profile (lower is better for all metrics)');

    for (const scope of ['measured', 'total']) {
      const section = profileComparison[scope];
      if (!section || !section.comparisons) continue;
      lines.push(`\n### ${scope === 'measured' ? 'During measured section' : 'Full session'}`);

      for (const metric of section.comparisons) {
        const vals = (metric.racers || []).map((r, i) => r != null ? `${racers[i]}: ${formatMetricValue(metric.name, r)}` : null).filter(Boolean);
        if (vals.length === 0) continue;
        const winStr = metric.winner ? ` [${metric.winner} wins, ${metric.diffPercent?.toFixed(1)}% better]` : '';
        lines.push(`  ${metric.name}: ${vals.join(' vs ')}${winStr}`);
        if (metric.description) lines.push(`    → ${metric.description}`);
      }
    }
  }

  if (settings) {
    const flags = [];
    if (settings.parallel) flags.push('parallel');
    if (settings.network && settings.network !== 'none') flags.push(`network=${settings.network}`);
    if (settings.cpuThrottle && settings.cpuThrottle > 1) flags.push(`cpu throttle ×${settings.cpuThrottle}`);
    if (flags.length > 0) lines.push(`\n## Race conditions: ${flags.join(', ')}`);
  }

  if (machineInfo) {
    lines.push(`\n## Hardware: ${machineInfo.cpuModel}, ${machineInfo.cpuCores} cores, ${machineInfo.totalMemoryMB}MB RAM (${machineInfo.platform})`);
  }

  return lines.join('\n');
}

function formatMetricValue(metricName, value) {
  const name = metricName.toLowerCase();
  if (name.includes('transfer') || name.includes('heap') || name.includes('bytes')) {
    if (value < 1024) return `${value.toFixed(0)}B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${(value / (1024 * 1024)).toFixed(2)}MB`;
  }
  if (name.includes('count') || name.includes('requests')) return `${Math.round(value)} req`;
  if (name.includes('cls')) return value.toFixed(3);
  if (value < 1) return `${(value * 1000).toFixed(0)}μs`;
  if (value < 1000) return `${value.toFixed(1)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

/**
 * Run the Gemini CLI with a race summary and return the reporter commentary.
 * @param {Object} summary - Output of buildSummary()
 * @returns {string} Gemini's commentary text
 */
export function runGeminiSummary(summary) {
  const prompt = buildGeminiPrompt(summary);
  return invokeGemini(prompt);
}

// ---------------------------------------------------------------------------
// Feature 2: Generate race spec from a natural-language prompt
// ---------------------------------------------------------------------------

const HTML_MAX_LENGTH = 8000;

/**
 * Use Playwright to fetch the HTML source of a URL (rendered DOM, not raw).
 * Accepts an existing Playwright `browser` instance to avoid redundant launches.
 * Returns a truncated string suitable for embedding in a Gemini prompt.
 */
export async function fetchPageHtml(url, browser, maxLength = HTML_MAX_LENGTH) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const html = await page.content();
    // Truncate to keep the prompt manageable, prioritising the <head> and early <body>
    return html.length > maxLength ? html.slice(0, maxLength) + '\n... (truncated)' : html;
  } finally {
    await page.close();
  }
}

/**
 * Extract up to `max` http/https URLs from a free-form prompt string.
 * Falls back to returning an empty array so callers can handle the case.
 */
export function extractUrls(text) {
  // Split on whitespace, strip enclosing punctuation, filter URLs.
  const urls = text.split(/\s+/)
    .map(t => t.replace(/^[(\['"]+/, '').replace(/[)\]'".,;!?]+$/, ''))
    .filter(t => /^https?:\/\//i.test(t));
  return [...new Set(urls)];
}

/**
 * Build the Gemini prompt for spec generation, embedding scraped HTML context.
 */
export function buildSpecPrompt(userPrompt, htmlByUrl) {
  const lines = [];

  lines.push('You are an expert in Playwright browser automation and web performance testing.');
  lines.push('Generate exactly TWO race spec files for the RaceForThePrize tool.');
  lines.push('');
  lines.push('Each spec file is a plain JavaScript file (no imports) that receives a Playwright `page` object.');
  lines.push('Available race helpers injected into `page`:');
  lines.push('  await page.raceRecordingStart()   — start video recording segment');
  lines.push('  await page.raceStart("name")       — start a named measurement');
  lines.push('  page.raceEnd("name")               — end a measurement (sync)');
  lines.push('  page.raceMessage("text")           — send message to CLI');
  lines.push('  await page.raceRecordingEnd()      — end video recording segment');
  lines.push('');
  lines.push('Rules:');
  lines.push('  - Start each file with a descriptive comment explaining what it tests');
  lines.push('  - Use page.goto(), page.waitForSelector(), page.click() etc as needed');
  lines.push('  - Wrap the main measured action with raceRecordingStart/End and raceStart/End');
  lines.push('  - Choose measurement names that are short and descriptive (e.g. "Load", "Search", "Checkout")');
  lines.push('  - Each spec must test a DIFFERENT URL or implementation for a fair race');
  lines.push('  - Do NOT use imports, exports, or require()');
  lines.push('');
  lines.push('USER REQUEST:');
  lines.push(userPrompt);

  if (Object.keys(htmlByUrl).length > 0) {
    lines.push('');
    lines.push('PAGE HTML CONTEXT (use element selectors from this to write accurate spec files):');
    for (const [url, html] of Object.entries(htmlByUrl)) {
      lines.push(`\n--- ${url} ---`);
      lines.push(html);
    }
  }

  lines.push('');
  lines.push('OUTPUT FORMAT — respond with exactly this structure (no extra commentary):');
  lines.push('');
  lines.push('FILE: racer-a.spec.js');
  lines.push('```javascript');
  lines.push('<spec content for first racer>');
  lines.push('```');
  lines.push('');
  lines.push('FILE: racer-b.spec.js');
  lines.push('```javascript');
  lines.push('<spec content for second racer>');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Parse Gemini's output for spec files.
 * Returns { 'racer-a.spec.js': '...', 'racer-b.spec.js': '...' }
 */
export function parseSpecOutput(geminiOutput) {
  const files = {};
  const allowedFiles = new Set(['racer-a.spec.js', 'racer-b.spec.js']);
  // Split on fenced code block boundaries to avoid backtracking regex.
  // Expected format: FILE: <name>\n```<lang>\n<content>\n```
  const blocks = geminiOutput.split('```');
  for (let i = 0; i < blocks.length - 1; i += 2) {
    const header = blocks[i];
    const codeBlock = blocks[i + 1] || '';
    const fileMatch = header.match(/FILE:\s*([\w.-]+\.spec\.js)\s*$/m);
    if (!fileMatch) continue;
    const filename = fileMatch[1];
    if (!allowedFiles.has(filename)) continue;
    // Strip optional language tag from the first line of the code block
    const content = codeBlock.replace(/^[a-zA-Z0-9-]*\n?/, '').trim();
    if (content) files[filename] = content;
  }
  return files;
}

/**
 * Generate race spec files from a natural-language prompt.
 * Scrapes HTML from any URLs found in the prompt, then calls Gemini.
 *
 * @param {string} userPrompt - Natural language description of the race
 * @param {object} options - { fetchHtml: true }
 * @returns {Promise<Object>} Map of filename → file content
 */
export async function runGeminiSpec(userPrompt, { fetchHtml = true } = {}) {
  let htmlByUrl = {};

  if (fetchHtml) {
    const urls = extractUrls(userPrompt).slice(0, 2);
    if (urls.length > 0) {
      // Launch a single browser instance and reuse it across all URLs
      const browser = await chromium.launch({ headless: true });
      try {
        for (const url of urls) {
          try {
            htmlByUrl[url] = await fetchPageHtml(url, browser);
          } catch (e) {
            // Non-fatal: proceed without HTML context for this URL
            htmlByUrl[url] = `(Could not fetch HTML: ${e.message})`;
          }
        }
      } finally {
        await browser.close();
      }
    }
  }

  const prompt = buildSpecPrompt(userPrompt, htmlByUrl);
  const output = invokeGemini(prompt);
  return parseSpecOutput(output);
}
