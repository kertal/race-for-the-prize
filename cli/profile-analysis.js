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

import { c } from './colors.js';

/**
 * Performance metric definitions.
 * Each metric has a name, description, unit, format function, category, and scope.
 */
export const PROFILE_METRICS = {
  // === MEASURED METRICS (between raceStart/raceEnd) ===
  // Network metrics (measured)
  'measured.networkTransferSize': {
    name: 'Network Transfer',
    description: 'Bytes transferred during measurement',
    unit: 'bytes',
    format: formatBytes,
    category: 'network',
    scope: 'measured'
  },
  'measured.networkRequestCount': {
    name: 'Network Requests',
    description: 'Requests made during measurement',
    unit: 'requests',
    format: (v) => `${v} req`,
    category: 'network',
    scope: 'measured'
  },
  // Computation metrics (measured)
  'measured.scriptDuration': {
    name: 'Script Execution',
    description: 'JavaScript execution during measurement',
    unit: 'ms',
    format: formatMs,
    category: 'computation',
    scope: 'measured'
  },
  'measured.taskDuration': {
    name: 'Task Duration',
    description: 'Browser tasks during measurement',
    unit: 'ms',
    format: formatMs,
    category: 'computation',
    scope: 'measured'
  },
  // Rendering metrics (measured)
  'measured.layoutDuration': {
    name: 'Layout Time',
    description: 'Layout calculations during measurement',
    unit: 'ms',
    format: formatMs,
    category: 'rendering',
    scope: 'measured'
  },
  'measured.recalcStyleDuration': {
    name: 'Style Recalculation',
    description: 'Style recalcs during measurement',
    unit: 'ms',
    format: formatMs,
    category: 'rendering',
    scope: 'measured'
  },

  // === TOTAL METRICS (entire session) ===
  // Network metrics (total)
  'total.networkTransferSize': {
    name: 'Network Transfer',
    description: 'Total bytes transferred over network',
    unit: 'bytes',
    format: formatBytes,
    category: 'network',
    scope: 'total'
  },
  'total.networkRequestCount': {
    name: 'Network Requests',
    description: 'Total number of network requests',
    unit: 'requests',
    format: (v) => `${v} req`,
    category: 'network',
    scope: 'total'
  },
  // Loading metrics (total only - these are page-level)
  'total.domContentLoaded': {
    name: 'DOM Content Loaded',
    description: 'Time until DOMContentLoaded event',
    unit: 'ms',
    format: formatMs,
    category: 'loading',
    scope: 'total'
  },
  'total.domComplete': {
    name: 'DOM Complete',
    description: 'Time until DOM is fully loaded',
    unit: 'ms',
    format: formatMs,
    category: 'loading',
    scope: 'total'
  },
  // Memory metrics (total only - snapshot at end)
  'total.jsHeapUsedSize': {
    name: 'JS Heap Used',
    description: 'JavaScript heap memory used',
    unit: 'bytes',
    format: formatBytes,
    category: 'memory',
    scope: 'total'
  },
  // Computation metrics (total)
  'total.scriptDuration': {
    name: 'Script Execution',
    description: 'Total JavaScript execution time',
    unit: 'ms',
    format: formatMs,
    category: 'computation',
    scope: 'total'
  },
  'total.taskDuration': {
    name: 'Task Duration',
    description: 'Total time spent on browser tasks',
    unit: 'ms',
    format: formatMs,
    category: 'computation',
    scope: 'total'
  },
  // Rendering metrics (total)
  'total.layoutDuration': {
    name: 'Layout Time',
    description: 'Total time spent calculating layouts',
    unit: 'ms',
    format: formatMs,
    category: 'rendering',
    scope: 'total'
  },
  'total.recalcStyleDuration': {
    name: 'Style Recalculation',
    description: 'Total time spent recalculating styles',
    unit: 'ms',
    format: formatMs,
    category: 'rendering',
    scope: 'total'
  }
};

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
 * @param {string[]} racerNames - Names of the two racers
 * @param {Object[]} profileData - Array of profile data for each racer (with total/measured sections)
 * @returns {Object} Profile comparison results with measured and total sections
 */
export function buildProfileComparison(racerNames, profileData) {
  const measuredComparisons = [];
  const totalComparisons = [];
  const measuredWins = { [racerNames[0]]: 0, [racerNames[1]]: 0 };
  const totalWins = { [racerNames[0]]: 0, [racerNames[1]]: 0 };

  for (const [key, metric] of Object.entries(PROFILE_METRICS)) {
    const vals = profileData.map(p => getMetricValue(p, key));

    // Skip if neither racer has data for this metric
    if (vals[0] === null && vals[1] === null) continue;

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
      diffPercent: null
    };

    // Determine winner (lower is better for all metrics)
    if (vals[0] !== null && vals[1] !== null && vals[0] !== vals[1]) {
      const winIdx = vals[0] <= vals[1] ? 0 : 1;
      const loseIdx = 1 - winIdx;
      comp.winner = racerNames[winIdx];
      comp.diff = vals[loseIdx] - vals[winIdx];
      comp.diffPercent = vals[winIdx] > 0
        ? (comp.diff / vals[winIdx] * 100)
        : 0;

      if (metric.scope === 'measured') {
        measuredWins[racerNames[winIdx]]++;
      } else {
        totalWins[racerNames[winIdx]]++;
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
    // Combined for backward compatibility
    comparisons: [...measuredComparisons, ...totalComparisons],
    wins: {
      [racerNames[0]]: measuredWins[racerNames[0]] + totalWins[racerNames[0]],
      [racerNames[1]]: measuredWins[racerNames[1]] + totalWins[racerNames[1]]
    }
  };
}

function determineOverallWinner(wins, racerNames, comparisons) {
  if (wins[racerNames[0]] > wins[racerNames[1]]) {
    return racerNames[0];
  } else if (wins[racerNames[1]] > wins[racerNames[0]]) {
    return racerNames[1];
  } else if (comparisons.length > 0) {
    return 'tie';
  }
  return null;
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

/**
 * Print a section of profile metrics.
 */
function printProfileSection(title, section, racers, colors, w, write) {
  const { comparisons, wins, overallWinner, byCategory } = section;

  if (comparisons.length === 0) return;

  write(`\n  ${c.bold}${title}${c.reset}\n`);
  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);

  for (const [category, comps] of Object.entries(byCategory)) {
    write(`  ${c.bold}${categoryLabels[category] || category}${c.reset}\n`);

    for (const comp of comps) {
      const maxVal = Math.max(...comp.values.filter(v => v !== null));

      write(`  ${c.dim}${comp.name}${c.reset}\n`);
      for (let i = 0; i < 2; i++) {
        const val = comp.values[i];
        const formatted = comp.formatted[i];
        const isWinner = comp.winner === racers[i];
        const medal = isWinner ? ' 🏆' : '';

        // Simple bar visualization
        const barWidth = 20;
        const filled = val !== null && maxVal > 0
          ? Math.round((val / maxVal) * barWidth)
          : 0;
        const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled);

        write(`    ${colors[i]}${c.bold}${racers[i].padEnd(10)}${c.reset} ${colors[i]}${bar}${c.reset}  ${formatted}${medal}\n`);
      }

      if (comp.winner && comp.diffPercent !== null) {
        const winColor = comp.winner === racers[0] ? colors[0] : colors[1];
        write(`    ${winColor}${c.bold}${comp.winner}${c.reset} is ${c.bold}${comp.diffPercent.toFixed(1)}%${c.reset} better\n`);
      }
    }
    write('\n');
  }

  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);
  write(`  ${c.bold}Score: ${c.reset}`);
  write(`${colors[0]}${racers[0]}${c.reset} ${wins[racers[0]]} - ${wins[racers[1]]} ${colors[1]}${racers[1]}${c.reset}\n`);

  if (overallWinner === 'tie') {
    write(`  ${c.yellow}${c.bold}🤝 Tie!${c.reset}\n`);
  } else if (overallWinner) {
    const winColor = overallWinner === racers[0] ? colors[0] : colors[1];
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
  const colors = [c.red, c.blue];
  const w = 54;

  const write = (s) => process.stderr.write(s);

  if (measured.comparisons.length === 0 && total.comparisons.length === 0) {
    write(`\n  ${c.dim}No profile metrics available.${c.reset}\n`);
    return;
  }

  write(`\n  ${c.bold}📊 Performance Profile Analysis${c.reset}\n`);

  // Print measured metrics first (between raceStart/raceEnd)
  if (measured.comparisons.length > 0) {
    printProfileSection('⏱️  During Measurement (raceStart → raceEnd)', measured, racers, colors, w, write);
  }

  // Print total metrics
  if (total.comparisons.length > 0) {
    printProfileSection('📈 Total Session', total, racers, colors, w, write);
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

  const categoryLabelsPlain = {
    network: 'Network',
    loading: 'Loading',
    memory: 'Memory',
    computation: 'Computation',
    rendering: 'Rendering'
  };

  for (const [category, comps] of Object.entries(byCategory)) {
    lines.push(`**${categoryLabelsPlain[category] || category}**`);
    lines.push('');
    lines.push(`| Metric | ${racers[0]} | ${racers[1]} | Winner | Diff |`);
    lines.push('|---|---|---|---|---|');

    for (const comp of comps) {
      const winner = comp.winner || '-';
      const diff = comp.diffPercent !== null ? `${comp.diffPercent.toFixed(1)}%` : '-';
      lines.push(`| ${comp.name} | ${comp.formatted[0]} | ${comp.formatted[1]} | ${winner} | ${diff} |`);
    }
    lines.push('');
  }

  lines.push(`**Score:** ${racers[0]} ${wins[racers[0]]} - ${wins[racers[1]]} ${racers[1]}`);
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
