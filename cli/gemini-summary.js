/**
 * Gemini CLI integration for race analysis and spec generation.
 *
 * Two features:
 *   1. buildGeminiPrompt / runGeminiSummary  — post-race sports reporter commentary
 *   2. buildSpecPrompt / runGeminiSpec       — generate race spec files from a natural-language prompt
 */

import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Invoke the `gemini` CLI, passing `prompt` via stdin. Returns stdout string or throws. */
export function invokeGemini(prompt) {
  const result = spawnSync('gemini', [], { // NOSONAR — gemini CLI resolved via PATH is intentional
    input: prompt,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000, // 2 min — prevent indefinite hang on network issues
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('Gemini CLI not found. Install it with: npm install -g @google/gemini-cli');
    }
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error('Gemini CLI timed out after 120s — check your network connection or Gemini auth');
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
  const { racers = [], comparisons, overallWinner, wins, profileComparison, machineInfo, settings, runs } = summary;

  if (racers.length === 0) {
    throw new Error('Summary has no racers — cannot build prompt');
  }

  const lines = [];

  lines.push('You are an enthusiastic sports reporter covering a browser performance race.');
  lines.push('Write a vivid analysis of the race results using racing metaphors.');
  lines.push('');
  lines.push('IMPORTANT RULES:');
  lines.push('- Focus on the ANALYSIS, not how you gathered or processed the data.');
  lines.push('- CITE SPECIFIC NUMBERS from the data: exact timings, transfer sizes, request counts, layout shift scores.');
  lines.push('- Highlight the MOST SIGNIFICANT metric differences — where one racer clearly outperforms the other.');
  lines.push('- Skip metrics that are roughly equal between racers.');
  lines.push('- Explain WHY the winner was faster by connecting profile metrics to the timing results.');
  lines.push('- Do NOT describe the data format or mention that data was provided to you.');
  lines.push('- Keep it under 300 words.');
  if (runs && runs > 1) {
    lines.push(`- The data below is the MEDIAN of ${runs} runs — mention this to show statistical confidence.\n`);
  } else {
    lines.push('');
  }

  lines.push('## Race participants');
  lines.push(racers.map((r, i) => `  ${i + 1}. ${r}`).join('\n'));

  lines.push('\n## Timing results');
  for (const comp of (comparisons || [])) {
    const times = (comp.racers || []).map((r, i) => r?.duration != null ? `${racers[i]}: ${r.duration.toFixed(3)}s` : null).filter(Boolean);
    const winStr = comp.winner ? ` → winner: ${comp.winner} by ${comp.diff?.toFixed(3)}s (${comp.diffPercent?.toFixed(1)}% faster)` : ' → tie';
    lines.push(`  "${comp.name}": ${times.join(' vs ')}${winStr}`);
  }

  if (overallWinner === 'tie') {
    lines.push('\n  Overall result: TIE');
  } else if (overallWinner) {
    const winsCount = wins?.[overallWinner] ?? 0;
    lines.push(`\n  Overall winner: ${overallWinner} (won ${winsCount} of ${comparisons?.length ?? 0} measurements)`);
  }

  if (profileComparison) {
    lines.push('\n## Performance profile (lower is better for all metrics)');

    for (const scope of ['measured', 'total']) {
      const section = profileComparison[scope];
      if (!section || !section.comparisons) continue;
      lines.push(`\n### ${scope === 'measured' ? 'During measured section' : 'Full session'}`);

      for (const metric of section.comparisons) {
        const vals = (metric.values || []).map((r, i) => typeof r === 'number' && Number.isFinite(r) ? `${racers[i]}: ${formatMetricValue(metric.name, r)}` : null).filter(Boolean);
        if (vals.length === 0) continue;
        const pct = Number.isFinite(metric.diffPercent) ? `, ${metric.diffPercent.toFixed(1)}% better` : '';
        const winStr = metric.winner ? ` [${metric.winner} wins${pct}]` : '';
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
 * Extract http/https URLs from a free-form prompt string.
 * Strips common surrounding punctuation and deduplicates.
 * Returns an empty array when no URLs are found.
 */
export function extractUrls(text) {
  // Split on whitespace, strip enclosing punctuation, filter URLs.
  // Uses atomic-friendly patterns: split first so tokens are short, then strip
  // a fixed set of leading/trailing characters without nested quantifiers.
  const urls = text.split(/\s+/)
    .map(t => {
      while (t.length > 0 && '([\'\"'.includes(t[0])) t = t.slice(1);
      while (t.length > 0 && ')]\'\".,;!?'.includes(t[t.length - 1])) t = t.slice(0, -1);
      return t;
    })
    .filter(t => /^https?:\/\//i.test(t));
  return [...new Set(urls)];
}

/**
 * Parse a hostname as an IPv4 address the liberal way `inet_aton` (and therefore
 * browsers/curl) do: 1–4 dot-separated parts, each decimal, hex (0x…) or octal
 * (0…), with the final part filling the remaining low-order bytes. This is what
 * makes `2130706433`, `0x7f000001`, `0177.1` and `127.1` all resolve to
 * 127.0.0.1. Returns the four octets, or null if the host is not a numeric IPv4.
 */
function parseIPv4Liberal(host) {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = [];
  for (const p of parts) {
    let n;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^(0|[1-9][0-9]*)$/.test(p)) n = parseInt(p, 10);
    else return null; // contains letters/other → a real hostname, not an IP literal
    if (!Number.isSafeInteger(n) || n < 0) return null;
    nums.push(n);
  }
  const N = nums.length;
  const caps = { 1: [0xffffffff], 2: [0xff, 0xffffff], 3: [0xff, 0xff, 0xffff], 4: [0xff, 0xff, 0xff, 0xff] }[N];
  if (nums.some((n, i) => n > caps[i])) return null;
  let value;
  if (N === 1) value = nums[0];
  else if (N === 2) value = nums[0] * 0x1000000 + nums[1];
  else if (N === 3) value = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2];
  else value = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2] * 0x100 + nums[3];
  value = value >>> 0;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** True if the four octets fall in any loopback/private/link-local/reserved range. */
function isPrivateIPv4(octets) {
  const [a, b] = octets;
  return (
    a === 0 ||                            // 0.0.0.0/8 "this host"
    a === 127 ||                          // 127.0.0.0/8 loopback
    a === 10 ||                           // 10.0.0.0/8 private
    (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12 private
    (a === 192 && b === 168) ||           // 192.168.0.0/16 private
    (a === 169 && b === 254) ||           // 169.254.0.0/16 link-local (cloud metadata)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 192 && b === 0) ||             // 192.0.0.0/24 IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224                              // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  );
}

/**
 * Returns true if the URL hostname is a localhost/loopback name or resolves
 * syntactically to a private/link-local/reserved IP literal (IPv4 in any of the
 * numeric forms a browser accepts, or IPv6 loopback/unspecified/ULA/link-local,
 * including IPv4-mapped addresses). Fails closed: an unparseable URL is unsafe.
 *
 * This check is purely syntactic and does NOT perform DNS resolution, so a
 * public hostname that later resolves to a private address (DNS rebinding) is
 * not caught here.
 */
export function isPrivateUrl(urlString) {
  let host;
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    return true; // unparseable — treat as unsafe
  }
  // A rooted FQDN keeps its trailing dot in URL.hostname (`localhost.`,
  // `127.0.0.1.`), which DNS treats as equivalent but string checks do not —
  // strip it so it can't bypass the loopback/private-IP comparisons below.
  host = host.replace(/\.+$/, '');
  if (host === 'localhost' || host === '' || host.endsWith('.localhost')) return true;

  // Strip IPv6 brackets. A ':' means an IPv6 literal.
  const plain = host.replace(/^\[|\]$/g, '');
  if (plain.includes(':')) {
    if (plain === '::1' || plain === '::') return true;            // loopback / unspecified
    const first = plain.split(':')[0];
    if (first.startsWith('fc') || first.startsWith('fd')) return true; // fc00::/7 ULA
    if (/^fe[89ab]/.test(first)) return true;                     // fe80::/10 link-local
    // IPv4-mapped (::ffff:a.b.c.d). Node normalizes the embedded IPv4 to hex
    // groups (e.g. ::ffff:127.0.0.1 -> ::ffff:7f00:1), so handle both forms.
    const mappedDotted = plain.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mappedDotted) {
      const octets = parseIPv4Liberal(mappedDotted[1]);
      if (octets && isPrivateIPv4(octets)) return true;
    }
    const mappedHex = plain.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const octets = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
      if (isPrivateIPv4(octets)) return true;
    }
    return false; // other IPv6 (treated as global)
  }

  const octets = parseIPv4Liberal(plain);
  if (octets) return isPrivateIPv4(octets);
  return false; // a real hostname
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
    // Strip language tag only when it is a pure word followed by a newline,
    // e.g. "javascript\n", "js\n", or CRLF variants like "javascript\r\n".
    // Using + (not *) and a required line break prevents accidentally removing
    // the first line of code when Gemini omits the language tag entirely.
    const content = codeBlock.replace(/^[a-zA-Z0-9-]+\r?\n/, '').trim();
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
    const urls = extractUrls(userPrompt)
      .filter(url => {
        if (isPrivateUrl(url)) {
          // Skip silently — don't expose internal network topology to Gemini
          return false;
        }
        return true;
      })
      .slice(0, 2);
    if (urls.length > 0) {
      // Lazy-load Playwright only when URLs need scraping to avoid startup overhead
      // on normal runs that don't use --gemini-spec.
      const { chromium } = await import('playwright');
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
