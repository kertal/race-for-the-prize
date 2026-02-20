/**
 * Profile analysis module for network and performance metric comparisons.
 * Captures and compares detailed performance metrics when --profile is enabled.
 *
 * Metrics are captured via Chrome DevTools Protocol during race execution.
 * All metrics follow "less is better" - lower values win.
 *
 * Two scopes are tracked:
 * - "measured": metrics captured only during the raceStart/raceEnd measurement period
 * - "total": metrics for the entire browser session
 */

import { c, RACER_COLORS } from './colors.js';

/**
 * Performance metric definitions.
 * Keys use "scope.metric" format; scope/category are derived from the key structure.
 */
const metricDefs = {
  networkTransferSize: { name: 'Network Transfer', format: formatBytes, category: 'network', description: 'Total bytes transferred over the network (compressed). Less data means faster loads on slow connections.' },
  networkRequestCount: { name: 'Network Requests', format: (v) => `${v} req`, category: 'network', description: 'Number of HTTP requests made. Fewer requests reduce connection overhead and latency.' },
  scriptDuration:      { name: 'Script Execution', format: formatMs, category: 'computation', description: 'Time spent executing JavaScript. High values indicate CPU-heavy scripts that may block the main thread.' },
  taskDuration:        { name: 'Task Duration', format: formatMs, category: 'computation', description: 'Total time spent on all browser tasks including script, layout, and rendering. Reflects overall main-thread busyness.' },
  layoutDuration:      { name: 'Layout Time', format: formatMs, category: 'rendering', description: 'Time spent computing element positions and sizes. Frequent layout recalculations ("layout thrashing") hurt performance.' },
  recalcStyleDuration: { name: 'Style Recalculation', format: formatMs, category: 'rendering', description: 'Time spent recalculating CSS styles. Complex selectors or frequent DOM changes increase this cost.' },
  domContentLoaded:    { name: 'DOM Content Loaded', format: formatMs, category: 'loading', description: 'Time until the HTML document is fully parsed and all deferred scripts have executed (DOMContentLoaded event).' },
  domComplete:         { name: 'DOM Complete', format: formatMs, category: 'loading', description: 'Time until the page and all sub-resources (images, stylesheets, etc.) have finished loading.' },
  jsHeapUsedSize:      { name: 'JS Heap Used', format: formatBytes, category: 'memory', description: 'JavaScript memory currently in use. High usage can trigger garbage collection pauses and indicates memory-heavy code.' },
};

// Measured metrics (between raceStart/raceEnd)
const MEASURED_METRICS = ['networkTransferSize', 'networkRequestCount', 'scriptDuration', 'taskDuration', 'layoutDuration', 'recalcStyleDuration'];
// Total metrics (entire session) — includes loading/memory which are total-only
const TOTAL_METRICS = ['networkTransferSize', 'networkRequestCount', 'domContentLoaded', 'domComplete', 'jsHeapUsedSize', 'scriptDuration', 'taskDuration', 'layoutDuration', 'recalcStyleDuration'];

// Build the full PROFILE_METRICS map with scope-prefixed keys
export const PROFILE_METRICS = {};
for (const metric of MEASURED_METRICS) {
  const def = metricDefs[metric];
  PROFILE_METRICS[`measured.${metric}`] = { ...def, scope: 'measured' };
}
for (const metric of TOTAL_METRICS) {
  const def = metricDefs[metric];
  PROFILE_METRICS[`total.${metric}`] = { ...def, scope: 'total' };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Extract a metric value from profile data using dot notation key.
 * @param {Object} profileData - Profile data with total/measured sections
 * @param {string} key - Key like "total.networkTransferSize" or "measured.scriptDuration"
 */
function getMetricValue(profileData, key) {
  if (!profileData) return null;
  const [scope, metric] = key.split('.');
  return profileData[scope]?.[metric] ?? null;
}

/**
 * Build profile comparison from captured metrics.
 * @param {string[]} racerNames - Names of the racers (supports 2-5)
 * @param {Object[]} profileData - Array of profile data for each racer (with total/measured sections)
 * @returns {Object} Profile comparison results with measured and total sections
 */
export function buildProfileComparison(racerNames, profileData) {
  const measuredComparisons = [];
  const totalComparisons = [];
  const measuredWins = Object.fromEntries(racerNames.map(n => [n, 0]));
  const totalWins = Object.fromEntries(racerNames.map(n => [n, 0]));

  for (const [key, metric] of Object.entries(PROFILE_METRICS)) {
    const vals = profileData.map(p => getMetricValue(p, key));

    // Skip if no racer has data for this metric
    if (vals.every(v => v === null)) continue;

    const comp = {
      key,
      name: metric.name,
      category: metric.category,
      scope: metric.scope,
      unit: metric.unit,
      values: vals,
      formatted: vals.map(v => v !== null ? metric.format(v) : '-'),
      winner: null,
      diff: null,
      diffPercent: null,
      rankings: []
    };

    // Determine winner (lower is better for all metrics)
    // Rank all racers that have data, sorted by value ascending
    const racersWithData = vals
      .map((v, i) => v !== null ? { index: i, value: v } : null)
      .filter(Boolean)
      .sort((a, b) => a.value - b.value);

    if (racersWithData.length >= 2) {
      const bestVal = racersWithData[0].value;
      const worstVal = racersWithData[racersWithData.length - 1].value;
      comp.rankings = racersWithData.map(r => racerNames[r.index]);

      // Only declare a winner if best and worst differ
      if (bestVal !== worstVal) {
        const winIdx = racersWithData[0].index;
        comp.winner = racerNames[winIdx];
        comp.diff = worstVal - bestVal;
        comp.diffPercent = bestVal > 0
          ? (comp.diff / bestVal * 100)
          : null;

        if (metric.scope === 'measured') {
          measuredWins[racerNames[winIdx]]++;
        } else {
          totalWins[racerNames[winIdx]]++;
        }
      }
    }

    if (metric.scope === 'measured') {
      measuredComparisons.push(comp);
    } else {
      totalComparisons.push(comp);
    }
  }

  // Determine overall winners
  const measuredOverallWinner = determineOverallWinner(measuredWins, racerNames, measuredComparisons);
  const totalOverallWinner = determineOverallWinner(totalWins, racerNames, totalComparisons);

  return {
    measured: {
      comparisons: measuredComparisons,
      wins: measuredWins,
      overallWinner: measuredOverallWinner,
      byCategory: groupByCategory(measuredComparisons)
    },
    total: {
      comparisons: totalComparisons,
      wins: totalWins,
      overallWinner: totalOverallWinner,
      byCategory: groupByCategory(totalComparisons)
    },
    // Combined
    comparisons: [...measuredComparisons, ...totalComparisons],
    wins: Object.fromEntries(racerNames.map(n => [n, measuredWins[n] + totalWins[n]]))
  };
}

function determineOverallWinner(wins, racerNames, comparisons) {
  if (comparisons.length === 0) return null;
  const maxWins = Math.max(...racerNames.map(n => wins[n]));
  const winnersWithMax = racerNames.filter(n => wins[n] === maxWins);
  if (winnersWithMax.length === 1) return winnersWithMax[0];
  if (maxWins === 0) return null;
  return 'tie';
}

function groupByCategory(comparisons) {
  const groups = {};
  for (const comp of comparisons) {
    if (!groups[comp.category]) {
      groups[comp.category] = [];
    }
    groups[comp.category].push(comp);
  }
  return groups;
}

const categoryLabels = {
  network: '🌐 Network',
  loading: '⏱️ Loading',
  memory: '🧠 Memory',
  computation: '⚡ Computation',
  rendering: '🎨 Rendering'
};

export const categoryDescriptions = {
  network: 'Network activity: data transferred and requests made. Fewer bytes and requests mean faster page loads.',
  loading: 'Page loading milestones measured from navigation start. Indicates how quickly the page becomes usable.',
  memory: 'JavaScript memory usage. Lower memory consumption reduces garbage collection pauses and improves stability.',
  computation: 'CPU time spent on JavaScript execution and browser tasks. Less computation means a more responsive page.',
  rendering: 'Time spent on visual layout and style calculations. Less rendering work means smoother interactions.',
};

/**
 * Print a section of profile metrics.
 */
function printProfileSection(title, section, racers, w, write) {
  const { comparisons, wins, overallWinner, byCategory } = section;

  if (comparisons.length === 0) return;

  write(`\n  ${c.bold}${title}${c.reset}\n`);
  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);

  for (const [category, comps] of Object.entries(byCategory)) {
    write(`  ${c.bold}${categoryLabels[category] || category}${c.reset}\n`);

    for (const comp of comps) {
      const maxVal = Math.max(...comp.values.filter(v => v !== null));
      const metricDef = PROFILE_METRICS[comp.key];

      // Sort racers by value ascending (best first), nulls last
      const sorted = racers
        .map((name, i) => ({ name, index: i, val: comp.values[i], formatted: comp.formatted[i] }))
        .sort((a, b) => {
          if (a.val === null) return 1;
          if (b.val === null) return -1;
          return a.val - b.val;
        });
      const bestVal = sorted[0].val;

      write(`  ${c.dim}${comp.name}${c.reset}\n`);
      for (const entry of sorted) {
        const color = RACER_COLORS[entry.index % RACER_COLORS.length];
        const isWinner = comp.winner === entry.name;
        const medal = isWinner ? ' 🏆' : '';

        const barWidth = 20;
        const filled = entry.val !== null && maxVal > 0
          ? Math.round((entry.val / maxVal) * barWidth)
          : 0;
        const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled);

        // Show delta from best for non-best racers
        let delta = '';
        if (entry.val !== null && bestVal !== null && entry.val !== bestVal) {
          const deltaVal = entry.val - bestVal;
          delta = ` ${c.dim}(+${metricDef.format(deltaVal)})${c.reset}`;
        }

        write(`    ${color}${c.bold}${entry.name.padEnd(12)}${c.reset} ${color}${bar}${c.reset}  ${entry.formatted}${delta}${medal}\n`);
      }
    }
    write('\n');
  }

  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);

  if (overallWinner === 'tie') {
    write(`  ${c.yellow}${c.bold}🤝 Tie!${c.reset}\n`);
  } else if (overallWinner) {
    const winnerIdx = racers.indexOf(overallWinner);
    const winColor = RACER_COLORS[winnerIdx % RACER_COLORS.length];
    write(`  🏆 ${winColor}${c.bold}${overallWinner}${c.reset} wins!\n`);
  }
}

/**
 * Print profile analysis to terminal.
 * @param {Object} profileComparison - Result from buildProfileComparison
 * @param {string[]} racers - Racer names
 */
export function printProfileAnalysis(profileComparison, racers) {
  const { measured, total } = profileComparison;
  const w = 54;

  const write = (s) => process.stderr.write(s);

  if (measured.comparisons.length === 0 && total.comparisons.length === 0) {
    write(`\n  ${c.dim}No profile metrics available.${c.reset}\n`);
    return;
  }

  write(`\n  ${c.bold}📊 Performance Profile Analysis${c.reset}\n`);

  if (measured.comparisons.length > 0) {
    printProfileSection('⏱️  During Measurement (raceStart → raceEnd)', measured, racers, w, write);
  }

  if (total.comparisons.length > 0) {
    printProfileSection('📈 Total Session', total, racers, w, write);
  }
}

/**
 * Build markdown section for a profile scope.
 */
function buildScopeMarkdown(title, section, racers) {
  const { comparisons, wins, overallWinner, byCategory } = section;
  const lines = [];

  if (comparisons.length === 0) return '';

  lines.push(`#### ${title}`);
  lines.push('');

  for (const [category, comps] of Object.entries(byCategory)) {
    lines.push(`**${category[0].toUpperCase() + category.slice(1)}**`);
    lines.push('');
    const headerCols = ['Metric', ...racers, 'Winner', 'Diff'];
    lines.push(`| ${headerCols.join(' | ')} |`);
    lines.push(`|${headerCols.map(() => '---').join('|')}|`);

    for (const comp of comps) {
      const winner = comp.winner || '-';
      const diff = comp.diffPercent !== null ? `${comp.diffPercent.toFixed(1)}%` : '-';
      lines.push(`| ${comp.name} | ${comp.formatted.join(' | ')} | ${winner} | ${diff} |`);
    }
    lines.push('');
  }

  if (overallWinner && overallWinner !== 'tie') {
    lines.push(`**Winner:** ${overallWinner}`);
  } else if (overallWinner === 'tie') {
    lines.push('**Result:** Tie');
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Build markdown section for profile analysis.
 * @param {Object} profileComparison - Result from buildProfileComparison
 * @param {string[]} racers - Racer names
 * @returns {string} Markdown content
 */
export function buildProfileMarkdown(profileComparison, racers) {
  const { measured, total } = profileComparison;
  const lines = [];

  if (measured.comparisons.length === 0 && total.comparisons.length === 0) return '';

  lines.push('### Performance Profile Analysis');
  lines.push('');
  lines.push('*Lower values are better for all metrics*');
  lines.push('');

  if (measured.comparisons.length > 0) {
    lines.push(buildScopeMarkdown('During Measurement (raceStart → raceEnd)', measured, racers));
  }

  if (total.comparisons.length > 0) {
    lines.push(buildScopeMarkdown('Total Session', total, racers));
  }

  return lines.join('\n');
}
