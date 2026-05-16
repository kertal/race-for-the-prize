/**
 * Rich summary display and summary.json generation for race results.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { c, RACER_COLORS } from './colors.js';
import { buildProfileComparison, printProfileAnalysis, buildProfileMarkdown, PROFILE_METRICS } from './profile-analysis.js';
import { determineOverallWinner } from './race-utils.js';

const PLATFORM_NAMES = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

export function formatPlatform(platform) {
  return PLATFORM_NAMES[platform] || platform;
}

/**
 * Collect machine information about the host running the race.
 */
export function getMachineInfo() {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'Unknown';
  return {
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    cpuModel,
    cpuCores: cpus.length,
    totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
    nodeVersion: process.version,
  };
}

// --- Helper functions to eliminate duplication ---

/** Compute the median of a numeric array, ignoring null/undefined values. Returns null if empty. */
function medianOf(values) {
  const vals = values.filter(v => v != null).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/** Count wins per racer from comparisons. Returns { racerName: winCount, ... }. */
function computeWins(racerNames, comparisons) {
  return Object.fromEntries(racerNames.map(name => [name, comparisons.filter(x => x.winner === name).length]));
}

const SYNTHETIC_TOTAL_NAME = 'Total';
const SYNTHETIC_TOTAL_FALLBACK_NAME = 'Total (All Sections)';
const TOTAL_TIE_EPSILON = 1e-9;

function isTotalNamedComparison(comp) {
  return comp?.name === SYNTHETIC_TOTAL_NAME || comp?.name === SYNTHETIC_TOTAL_FALLBACK_NAME;
}

function isSyntheticTotalComparison(comp) {
  return comp?.isSyntheticTotal === true;
}

function getSectionComparisons(comparisons) {
  return comparisons.filter(comp => {
    if (isSyntheticTotalComparison(comp)) return false;
    if (comp?.name === SYNTHETIC_TOTAL_FALLBACK_NAME) return false;
    return true;
  });
}

function getSyntheticTotalName(existingComparisons) {
  const names = new Set(existingComparisons.map(c => c.name));
  return names.has(SYNTHETIC_TOTAL_NAME) ? SYNTHETIC_TOTAL_FALLBACK_NAME : SYNTHETIC_TOTAL_NAME;
}

function appendSyntheticTotalComparison(comparisons, racerNames) {
  const sections = getSectionComparisons(comparisons);
  if (sections.length <= 1) return;
  if (comparisons.some(comp => isSyntheticTotalComparison(comp))) return;

  const totalVals = racerNames.map((_, i) => {
    const durs = sections.map(c => c.racers[i]?.duration);
    if (durs.some(d => d == null)) return null;
    return { duration: durs.reduce((a, b) => a + b, 0) };
  });

  const totalComp = computeComparison(getSyntheticTotalName(comparisons), totalVals, racerNames);
  const validTotals = totalVals
    .map((v, i) => v ? { i, duration: v.duration } : null)
    .filter(Boolean);
  if (validTotals.length >= 2) {
    const best = Math.min(...validTotals.map(v => v.duration));
    const worst = Math.max(...validTotals.map(v => v.duration));
    if (Math.abs(worst - best) <= TOTAL_TIE_EPSILON) {
      totalComp.winner = null;
      totalComp.diff = 0;
      totalComp.diffPercent = 0;
    }
  }
  totalComp.isSyntheticTotal = true;
  comparisons.push(totalComp);
}

/**
 * Determine overall winner. For multiple sections, uses summed time across sections.
 * Racers missing any section are ineligible for the total-based winner.
 */
function computeOverallWinner(racerNames, comparisons) {
  const sections = getSectionComparisons(comparisons);
  if (sections.length === 0) return null;

  if (sections.length === 1) {
    const wins = computeWins(racerNames, sections);
    return determineOverallWinner(wins, racerNames, sections, 0);
  }

  const totals = racerNames.map((name, i) => {
    const durs = sections.map(c => c.racers[i]?.duration);
    if (durs.some(d => d == null)) return { name, total: null };
    return { name, total: durs.reduce((a, b) => a + b, 0) };
  }).filter(r => r.total != null);

  if (totals.length < 2) return null;

  const min = Math.min(...totals.map(r => r.total));
  const fastest = totals.filter(r => Math.abs(r.total - min) <= TOTAL_TIE_EPSILON);
  return fastest.length === 1 ? fastest[0].name : 'tie';
}

/**
 * Compute comparison stats for a single measurement across racers.
 * Returns { name, racers, winner, diff, diffPercent, rankings }.
 */
function computeComparison(name, vals, racerNames) {
  const comp = { name, racers: vals, winner: null, diff: null, diffPercent: null, rankings: [] };
  const racersWithData = vals
    .map((v, i) => v ? { index: i, duration: v.duration } : null)
    .filter(Boolean)
    .sort((a, b) => a.duration - b.duration);

  if (racersWithData.length >= 2) {
    const winIdx = racersWithData[0].index;
    const loseIdx = racersWithData[racersWithData.length - 1].index;
    comp.winner = racerNames[winIdx];
    comp.diff = vals[loseIdx].duration - vals[winIdx].duration;
    comp.diffPercent = vals[winIdx].duration > 0
      ? (comp.diff / vals[winIdx].duration * 100) : 0;
    comp.rankings = racersWithData.map(r => racerNames[r.index]);
  }
  return comp;
}

/**
 * Compute display order from best to worst using average ranking position
 * across all comparisons. Each comparison's `rankings` array gives the full
 * order (fastest to slowest), so this captures 2nd vs 3rd, not just wins.
 * Returns array of original indices into summary.racers.
 */
export function getPlacementOrder(summary) {
  const { racers, comparisons } = summary;
  if (!comparisons || comparisons.length === 0) return racers.map((_, i) => i);

  const avgRank = racers.map((name) => {
    let totalRank = 0;
    let counted = 0;
    for (const comp of comparisons) {
      if (comp.rankings && comp.rankings.length > 0) {
        const rank = comp.rankings.indexOf(name);
        totalRank += rank !== -1 ? rank : racers.length;
        counted++;
      }
    }
    return counted > 0 ? totalRank / counted : racers.length;
  });

  const indices = racers.map((_, i) => i);
  indices.sort((a, b) => (avgRank[a] - avgRank[b]) || (a - b));
  return indices;
}


/**
 * Format a duration cell for markdown: trophy for winner, delta for losers.
 */
function formatDurationCell(dur, bestDur, isWinner, bold) {
  if (dur == null) return bold ? '**-**' : '-';
  const val = `${dur.toFixed(3)}s`;
  let content;
  if (isWinner) {
    content = `${val} (\uD83C\uDFC6)`;
  } else if (bestDur != null) {
    content = `${val} (+${(dur - bestDur).toFixed(3)}s)`;
  } else {
    content = val;
  }
  return bold ? `**${content}**` : content;
}

function sortComparisonsForDisplay(comparisons) {
  return [...comparisons].sort((a, b) => {
    const aIsTotal = isSyntheticTotalComparison(a) || isTotalNamedComparison(a);
    const bIsTotal = isSyntheticTotalComparison(b) || isTotalNamedComparison(b);
    if (aIsTotal && !bIsTotal) return -1;
    if (!aIsTotal && bIsTotal) return 1;
    return 0;
  });
}

/**
 * Build markdown results table rows.
 * Returns array of markdown lines for the table.
 */
function buildResultsTable(comparisons, racers) {
  const lines = [];
  const headerCols = ['Measurement', ...racers];
  lines.push(`| ${headerCols.join(' | ')} |`);
  lines.push(`|${headerCols.map(() => '---').join('|')}|`);
  for (const comp of sortComparisonsForDisplay(comparisons)) {
    const bestDur = comp.winner ? comp.racers[racers.indexOf(comp.winner)]?.duration : null;
    const durations = racers.map((r, i) =>
      formatDurationCell(comp.racers[i]?.duration, bestDur, comp.winner === r, false)
    );
    lines.push(`| ${comp.name} | ${durations.join(' | ')} |`);
  }

  if (comparisons.length > 1) {
    const totalDurations = racers.map((_, i) => {
      const hasData = comparisons.some(comp => comp.racers[i]?.duration != null);
      if (!hasData) return null;
      return comparisons.reduce((acc, comp) => acc + (comp.racers[i]?.duration ?? 0), 0);
    });
    const nonNull = totalDurations.filter(d => d != null);
    const minTotal = nonNull.length >= 2 ? Math.min(...nonNull) : null;
    const isStrictWinner = (dur) =>
      dur != null && minTotal != null && dur === minTotal && nonNull.filter(d => d === minTotal).length === 1;
    const cells = racers.map((_, i) =>
      formatDurationCell(totalDurations[i], minTotal, isStrictWinner(totalDurations[i]), true)
    );
    lines.push(`| **Total** | ${cells.join(' | ')} |`);
  }

  return lines;
}

// --- Main summary functions ---

export function buildSummary(racerNames, results, settings, resultsDir) {
  const measurements = results.map(r => r.measurements || []);

  // Group measurements by name across all racers
  const allNames = new Set(measurements.flat().map(m => m.name));
  const comparisons = [...allNames].map(name => {
    const vals = racerNames.map((_, i) => {
      const m = measurements[i].find(m => m.name === name);
      return m ? { duration: m.duration, startTime: m.startTime, endTime: m.endTime } : null;
    });
    return computeComparison(name, vals, racerNames);
  });

  const wins = computeWins(racerNames, comparisons);
  const overallWinner = computeOverallWinner(racerNames, comparisons);
  appendSyntheticTotalComparison(comparisons, racerNames);

  return {
    timestamp: new Date().toISOString(),
    resultsDir,
    racers: racerNames,
    settings: settings || {},
    comparisons,
    overallWinner,
    wins,
    errors: results.flatMap((r, i) => r.error ? [`${racerNames[i]}: ${r.error}`] : []),
    videos: Object.fromEntries(results.flatMap((r, i) => [
      [racerNames[i], r.videoPath || null],
      [`${racerNames[i]}_full`, r.fullVideoPath || null],
    ])),
    harFiles: Object.fromEntries(racerNames.map((n, i) => [n, results[i].harPath || null])),
    profileMetrics: results.map(r => r.profileMetrics || null),
    profileComparison: buildProfileComparison(racerNames, results.map(r => r.profileMetrics || null)),
    machineInfo: getMachineInfo(),
  };
}

function printBar(label, duration, maxDuration, color, isWinner, width = 30, labelWidth = 12) {
  const filled = maxDuration > 0 ? Math.round((duration / maxDuration) * width) : 0;
  const bar = '▓'.repeat(filled) + '░'.repeat(width - filled);
  const medal = isWinner ? ' 🏆' : '';
  return `    ${color}${c.bold}${label.padEnd(labelWidth)}${c.reset} ${color}${bar}${c.reset}  ${c.bold}${duration.toFixed(3)}s${c.reset}${medal}`;
}

export function printSummary(summary) {
  const { racers, comparisons, overallWinner, wins, errors, profileComparison } = summary;
  const w = 54;
  const labelWidth = Math.max(12, ...racers.map(r => r.length));

  const write = (s) => process.stderr.write(s);

  write(`\n  ${c.dim}🏁 Results${c.reset}\n`);
  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);

  if (errors.length > 0) {
    write(`  ${c.red}${c.bold}⚠ Errors:${c.reset}\n`);
    errors.forEach(err => write(`    ${c.red}${err}${c.reset}\n`));
  }

  if (comparisons.length === 0) {
    write(`  ${c.dim}No measurements recorded.${c.reset}\n`);
    write(`  ${c.dim}Use page.raceStart() / page.raceEnd() in scripts.${c.reset}\n`);
  } else {
    for (const comp of sortComparisonsForDisplay(comparisons)) {
      const maxDur = Math.max(...comp.racers.map(r => r?.duration || 0));

      // Sort racers by duration ascending (best/fastest first), nulls last
      const sorted = racers
        .map((name, i) => ({ name, index: i, racer: comp.racers[i] }))
        .sort((a, b) => {
          if (!a.racer) return 1;
          if (!b.racer) return -1;
          return a.racer.duration - b.racer.duration;
        });
      const bestDur = sorted[0].racer ? sorted[0].racer.duration : null;

      write(`  ${c.dim}⏱ ${comp.name}${c.reset}\n`);
      for (const entry of sorted) {
        const color = RACER_COLORS[entry.index % RACER_COLORS.length];
        if (entry.racer) {
          const isWinner = comp.winner === entry.name;
          let delta = '';
          if (bestDur !== null && entry.racer.duration !== bestDur) {
            delta = ` ${c.dim}(+${(entry.racer.duration - bestDur).toFixed(3)}s)${c.reset}`;
          }
          write(`${printBar(entry.name, entry.racer.duration, maxDur, color, isWinner, 30, labelWidth)}${delta}\n`);
        } else {
          write(`    ${color}${c.bold}${entry.name.padEnd(labelWidth)}${c.reset} ${c.dim}(no data)${c.reset}\n`);
        }
      }
    }

    if (comparisons.length > 1) {
      const totalDurations = racers.map((_, i) => {
        const hasData = comparisons.some(comp => comp.racers[i]?.duration != null);
        if (!hasData) return null;
        return comparisons.reduce((acc, comp) => acc + (comp.racers[i]?.duration ?? 0), 0);
      });
      const nonNull = totalDurations.filter(d => d != null);
      const maxTotal = nonNull.length > 0 ? Math.max(...nonNull) : 0;
      const minTotal = nonNull.length >= 2 ? Math.min(...nonNull) : null;
      const isStrictWinner = (dur) =>
        dur != null && minTotal != null && dur === minTotal && nonNull.filter(d => d === minTotal).length === 1;

      const sortedTotals = racers
        .map((name, i) => ({ name, index: i, duration: totalDurations[i] }))
        .sort((a, b) => {
          if (a.duration == null) return 1;
          if (b.duration == null) return -1;
          return a.duration - b.duration;
        });

      write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);
      write(`  ${c.dim}⏱ Total${c.reset}\n`);
      for (const entry of sortedTotals) {
        const color = RACER_COLORS[entry.index % RACER_COLORS.length];
        if (entry.duration != null) {
          let delta = '';
          if (minTotal !== null && entry.duration !== minTotal) {
            delta = ` ${c.dim}(+${(entry.duration - minTotal).toFixed(3)}s)${c.reset}`;
          }
          write(`${printBar(entry.name, entry.duration, maxTotal, color, isStrictWinner(entry.duration), 30, labelWidth)}${delta}\n`);
        } else {
          write(`    ${color}${c.bold}${entry.name.padEnd(labelWidth)}${c.reset} ${c.dim}(no data)${c.reset}\n`);
        }
      }
    }
  }

  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);
  if (overallWinner === 'tie') {
    write(`  ${c.yellow}${c.bold}🤝 It's a tie!${c.reset}\n`);
  } else if (overallWinner) {
    const winnerIdx = racers.indexOf(overallWinner);
    const winColor = RACER_COLORS[winnerIdx % RACER_COLORS.length];
    write(`  🏆 ${winColor}${c.bold}${overallWinner.toUpperCase()}${c.reset} ${c.bold}wins!${c.reset}\n`);
  }
  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);

  // Profile analysis — only show if metrics were captured
  if (profileComparison && profileComparison.comparisons.length > 0) {
    printProfileAnalysis(profileComparison, racers);
  }
}

export function buildMarkdownSummary(summary, sideBySideName) {
  const { racers, comparisons, overallWinner, wins, errors, videos, settings, timestamp, profileComparison, machineInfo } = summary;
  const lines = [];

  // ASCII art header
  lines.push('```');
  lines.push('    ____                   ____              _   _            ____       _          ');
  lines.push('   / __ \\____ _________   / __/___  _____   / |_/ /_  ___   / __ \\_____(_)_______  ');
  lines.push('  / /_/ / __ `/ ___/ _ \\ / /_/ __ \\/ ___/  / __/ __ \\/ _ \\ / /_/ / ___/ / ___/ _ \\ ');
  lines.push(' / _, _/ /_/ / /__/  __// __/ /_/ / /     / /_/ / / /  __// ____/ /  / / /__/  __/ ');
  lines.push('/_/ |_|\\__,_/\\___/\\___//_/  \\____/_/      \\__/_/ /_/\\___//_/   /_/  /_/\\___/\\___/  ');
  lines.push('```');
  lines.push('');

  // Winner announcement
  if (overallWinner === 'tie') {
    const winsStr = racers.map(r => `${r} ${wins[r]}`).join(' - ');
    lines.push(`## It's a Tie! ${winsStr}`);
  } else if (overallWinner) {
    const winsStr = racers.map(r => wins[r]).join(' - ');
    lines.push(`## Winner: ${overallWinner} (${winsStr})`);
  }
  lines.push('');

  // Info
  lines.push('### Race Info');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Date** | ${new Date(timestamp).toLocaleString()} |`);
  racers.forEach((r, i) => lines.push(`| **Racer ${i + 1}** | ${r} |`));

  if (settings) {
    const mode = settings.parallel === false ? 'sequential' : 'parallel';
    lines.push(`| **Mode** | ${mode} |`);
    if (settings.network && settings.network !== 'none') lines.push(`| **Network** | ${settings.network} |`);
    if (settings.cpuThrottle && settings.cpuThrottle > 1) lines.push(`| **CPU Throttle** | ${settings.cpuThrottle}x |`);
    if (settings.format && settings.format !== 'webm') lines.push(`| **Format** | ${settings.format} |`);
    if (settings.headless) lines.push(`| **Headless** | yes |`);
    if (settings.runs && settings.runs > 1) lines.push(`| **Runs** | ${settings.runs} |`);
  }
  if (machineInfo) {
    lines.push(`| **Machine** | ${formatPlatform(machineInfo.platform)} ${machineInfo.osRelease} (${machineInfo.arch}) |`);
    lines.push(`| **CPU** | ${machineInfo.cpuModel} (${machineInfo.cpuCores} cores) |`);
    if (machineInfo.totalMemoryMB) {
      lines.push(`| **Memory** | ${(machineInfo.totalMemoryMB / 1024).toFixed(1)} GB |`);
    }
    if (machineInfo.nodeVersion) {
      lines.push(`| **Node.js** | ${machineInfo.nodeVersion} |`);
    }
  }
  lines.push('');

  // Errors
  if (errors && errors.length > 0) {
    lines.push('### Errors');
    lines.push('');
    errors.forEach(err => lines.push(`- ${err}`));
    lines.push('');
  }

  // Results
  if (comparisons.length > 0) {
    lines.push('### Results');
    lines.push('');
    lines.push(...buildResultsTable(comparisons, racers));
    lines.push('');
  }

  // Profile analysis
  if (profileComparison && profileComparison.comparisons.length > 0) {
    lines.push(buildProfileMarkdown(profileComparison, racers));
  }

  // Files
  lines.push('### Files');
  lines.push('');
  for (const [key, val] of Object.entries(videos)) {
    if (val) lines.push(`- **${key}**: [${path.basename(val)}](./${path.basename(path.dirname(val))}/${path.basename(val)})`);
  }
  if (sideBySideName) {
    lines.push(`- **side-by-side**: [${sideBySideName}](./${sideBySideName})`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Find the run whose durations are closest to the median values.
 * Returns the 0-based index of the best-matching run.
 */
export function findMedianRunIndex(summaries, medianSummary) {
  const compMaps = summaries.map(s => {
    const map = new Map();
    for (const comp of s.comparisons) map.set(comp.name, comp);
    return map;
  });

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < summaries.length; i++) {
    let totalDist = 0;
    for (const medComp of medianSummary.comparisons) {
      const runComp = compMaps[i].get(medComp.name);
      if (!runComp) continue;
      for (let r = 0; r < medComp.racers.length; r++) {
        const medDur = medComp.racers[r]?.duration;
        const runDur = runComp.racers[r]?.duration;
        if (medDur != null && runDur != null) {
          totalDist += Math.abs(runDur - medDur);
        }
      }
    }
    if (totalDist < bestDist) {
      bestDist = totalDist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * For each racer independently, find the run whose durations are closest to
 * that racer's median values. Returns an array of 0-based run indices, one per racer.
 */
export function findMedianRunIndexPerRacer(summaries, medianSummary) {
  return medianSummary.racers.map((_, racerIdx) => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let runIdx = 0; runIdx < summaries.length; runIdx++) {
      let totalDist = 0;
      for (const medComp of medianSummary.comparisons) {
        const runComp = summaries[runIdx].comparisons.find(comp => comp.name === medComp.name);
        if (!runComp) continue;
        const medDur = medComp.racers[racerIdx]?.duration;
        const runDur = runComp.racers[racerIdx]?.duration;
        if (medDur != null && runDur != null) {
          totalDist += Math.abs(runDur - medDur);
        }
      }
      if (totalDist < bestDist) {
        bestDist = totalDist;
        bestIdx = runIdx;
      }
    }
    return bestIdx;
  });
}

/**
 * For each racer, compute the median value of each profile metric across runs.
 * Returns an array (one per racer) of profile metric objects { total: {...}, measured: {...} }.
 */
function buildMedianProfileMetrics(summaries) {
  if (!summaries || summaries.length === 0) return null;
  const racers = summaries[0].racers;
  const hasAny = summaries.some(s => s.profileMetrics?.some(Boolean));
  if (!hasAny) return null;

  return racers.map((_, racerIdx) => {
    const result = { total: {}, measured: {} };
    for (const key of Object.keys(PROFILE_METRICS)) {
      const [scope, metric] = key.split('.');
      const values = summaries.map(s => s.profileMetrics?.[racerIdx]?.[scope]?.[metric] ?? null);
      const med = medianOf(values);
      if (med !== null) result[scope][metric] = med;
    }
    return (Object.keys(result.total).length || Object.keys(result.measured).length) ? result : null;
  });
}

/** Compute median of each measurement across multiple runs. */
export function buildMedianSummary(summaries, resultsDir) {
  const racers = summaries[0].racers;
  const allNames = new Set(
    summaries.flatMap(s => getSectionComparisons(s.comparisons).map(c => c.name))
  );

  const comparisons = [...allNames].map(name => {
    const vals = racers.map((_, i) => {
      const durations = summaries
        .map(s => s.comparisons.find(comp => comp.name === name)?.racers[i]?.duration)
        .filter(d => d != null);
      const median = medianOf(durations);
      return median != null ? { duration: median } : null;
    });
    return computeComparison(name, vals, racers);
  });

  const wins = computeWins(racers, comparisons);
  let overallWinner = computeOverallWinner(racers, comparisons);

  // If individual runs had inconsistent winners, the result is too noisy to call
  const runWinners = summaries.map(s => s.overallWinner).filter(w => w && w !== 'tie');
  if (new Set(runWinners).size > 1) overallWinner = 'tie';

  appendSyntheticTotalComparison(comparisons, racers);

  const medianProfileMetrics = buildMedianProfileMetrics(summaries);

  return {
    timestamp: new Date().toISOString(),
    resultsDir,
    racers,
    settings: summaries[0].settings,
    comparisons,
    overallWinner,
    wins,
    errors: summaries.flatMap(s => s.errors || []),
    videos: {},
    runs: summaries.length,
    machineInfo: summaries.find(s => s.machineInfo)?.machineInfo,
    profileMetrics: medianProfileMetrics,
    profileComparison: medianProfileMetrics ? buildProfileComparison(racers, medianProfileMetrics) : null,
  };
}

/** Build a collapsible run-by-run comparison table grouped by measurement. */
function buildRunComparisonSection(medianSummary, summaries) {
  const racers = medianSummary.racers;
  const allNames = new Set(summaries.flatMap(s => s.comparisons.map(c => c.name)));
  const hasProfileData = summaries.some(s => s.profileMetrics?.some(Boolean));
  if (allNames.size === 0 && !hasProfileData) return '';

  const lines = ['', '<details>', '<summary><b>Run-by-Run Comparison</b></summary>', ''];

  const orderedNames = sortComparisonsForDisplay([...allNames].map(name => ({ name }))).map(c => c.name);
  for (const name of orderedNames) {
    lines.push(`#### ${name}`, '');
    const headerCols = ['Run', ...racers];
    lines.push(`| ${headerCols.join(' | ')} |`);
    lines.push(`|${headerCols.map(() => '---').join('|')}|`);

    for (let i = 0; i < summaries.length; i++) {
      const comp = summaries[i].comparisons.find(c => c.name === name);
      if (!comp) {
        lines.push(`| ${i + 1} | ${racers.map(() => '-').join(' | ')} |`);
        continue;
      }
      const bestDur = comp.winner ? comp.racers[racers.indexOf(comp.winner)]?.duration : null;
      const durations = racers.map((r, j) =>
        formatDurationCell(comp.racers[j]?.duration, bestDur, comp.winner === r, false)
      );
      lines.push(`| ${i + 1} | ${durations.join(' | ')} |`);
    }

    // Median row
    const medComp = medianSummary.comparisons.find(c => c.name === name);
    if (medComp) {
      const bestDur = medComp.winner ? medComp.racers[racers.indexOf(medComp.winner)]?.duration : null;
      const durations = racers.map((r, j) =>
        formatDurationCell(medComp.racers[j]?.duration, bestDur, medComp.winner === r, true)
      );
      lines.push(`| **Median** | ${durations.join(' | ')} |`);
    }

    // Average row
    const avgDurations = racers.map((_, j) => {
      const vals = summaries
        .map(s => s.comparisons.find(c => c.name === name)?.racers[j]?.duration)
        .filter(d => d != null);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    if (avgDurations.some(v => v != null)) {
      const validAvg = avgDurations.filter(v => v != null);
      const bestAvg = validAvg.length >= 2 ? Math.min(...validAvg) : null;
      const durations = racers.map((_, j) => {
        const isWinner = bestAvg != null && avgDurations[j] === bestAvg;
        return formatDurationCell(avgDurations[j], bestAvg, isWinner, true);
      });
      lines.push(`| **Average** | ${durations.join(' | ')} |`);
    }

    lines.push('');
  }

  // --- Performance metrics ---
  if (hasProfileData) {
    const metricsWithData = [];
    for (const [key, metric] of Object.entries(PROFILE_METRICS)) {
      const [scope, metricName] = key.split('.');
      const hasData = summaries.some(s =>
        racers.some((_, j) => s.profileMetrics?.[j]?.[scope]?.[metricName] != null)
      );
      if (hasData) metricsWithData.push({ metric, scope, metricName });
    }

    const scopes = [
      { scope: 'measured', title: 'Performance: During Measurement' },
      { scope: 'total', title: 'Performance: Total Session' },
    ];
    for (const { scope: scopeName, title: scopeTitle } of scopes) {
      const scopeMetrics = metricsWithData.filter(m => m.scope === scopeName);
      if (scopeMetrics.length === 0) continue;

      lines.push(`#### ${scopeTitle}`, '');

      for (const { metric, metricName } of scopeMetrics) {
        lines.push(`**${metric.name}**`, '');
        const headerCols = ['Run', ...racers];
        lines.push(`| ${headerCols.join(' | ')} |`);
        lines.push(`|${headerCols.map(() => '---').join('|')}|`);

        for (let i = 0; i < summaries.length; i++) {
          const vals = racers.map((_, j) => summaries[i].profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null);
          const withData = vals.map((v, j) => v != null ? { j, v } : null).filter(Boolean).sort((a, b) => a.v - b.v);
          const bestVal = (withData.length >= 2 && withData[0].v !== withData[withData.length - 1].v) ? withData[0].v : null;
          const winnerIdx = bestVal != null ? withData[0].j : -1;
          const formatted = vals.map((v, j) => {
            if (v == null) return '-';
            if (j === winnerIdx) return `${metric.format(v)} (\uD83C\uDFC6)`;
            if (bestVal != null) return `${metric.format(v)} (+${metric.format(v - bestVal)})`;
            return metric.format(v);
          });
          lines.push(`| ${i + 1} | ${formatted.join(' | ')} |`);
        }

        // Median row
        const medVals = racers.map((_, j) => medianSummary.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null);
        const medWithData = medVals.map((v, j) => v != null ? { j, v } : null).filter(Boolean).sort((a, b) => a.v - b.v);
        if (medVals.some(v => v != null)) {
          const bestMedVal = (medWithData.length >= 2 && medWithData[0].v !== medWithData[medWithData.length - 1].v) ? medWithData[0].v : null;
          const medWinnerIdx = bestMedVal != null ? medWithData[0].j : -1;
          const formatted = medVals.map((v, j) => {
            if (v == null) return '-';
            const f = metric.format(v);
            let content;
            if (j === medWinnerIdx) content = `${f} (\uD83C\uDFC6)`;
            else if (bestMedVal != null) content = `${f} (+${metric.format(v - bestMedVal)})`;
            else content = f;
            return `**${content}**`;
          });
          lines.push(`| **Median** | ${formatted.join(' | ')} |`);
        }

        // Average row
        const avgVals = racers.map((_, j) => {
          const vals = summaries
            .map(s => s.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null)
            .filter(v => v != null);
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
        if (avgVals.some(v => v != null)) {
          const avgWithData = avgVals.map((v, j) => v != null ? { j, v } : null).filter(Boolean).sort((a, b) => a.v - b.v);
          const bestAvgVal = (avgWithData.length >= 2 && avgWithData[0].v !== avgWithData[avgWithData.length - 1].v) ? avgWithData[0].v : null;
          const avgWinnerIdx = bestAvgVal != null ? avgWithData[0].j : -1;
          const formatted = avgVals.map((v, j) => {
            if (v == null) return '-';
            const f = metric.format(v);
            let content;
            if (j === avgWinnerIdx) content = `${f} (\uD83C\uDFC6)`;
            else if (bestAvgVal != null) content = `${f} (+${metric.format(v - bestAvgVal)})`;
            else content = f;
            return `**${content}**`;
          });
          lines.push(`| **Average** | ${formatted.join(' | ')} |`);
        }

        lines.push('');
      }
    }
  }

  lines.push('</details>', '');
  return lines.join('\n');
}

/** Build markdown report for multi-run races with individual run details. */
export function buildMultiRunMarkdown(medianSummary, summaries) {
  let md = buildMarkdownSummary(medianSummary, null);
  md = md.replace('### Race Info', `### Median Results (${summaries.length} runs)\n\n### Race Info`);

  // Add collapsible run-by-run comparison table
  md += buildRunComparisonSection(medianSummary, summaries);

  const lines = ['\n---\n', '## Individual Runs', ''];
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    lines.push(`### Run ${i + 1}`, '');
    if (s.comparisons.length > 0) {
      lines.push(...buildResultsTable(s.comparisons, s.racers));
      lines.push('');
    }
    if (s.errors?.length > 0) lines.push(`**Errors:** ${s.errors.join(', ')}`, '');
    lines.push(`Results: [run/${i + 1}](./${i + 1}/)`, '');
  }

  return md + lines.join('\n');
}

export function printRecentRaces(raceDir) {
  let entries;
  try {
    entries = fs.readdirSync(raceDir)
      .filter(f => f.startsWith('results-'))
      .map(f => {
        const fullPath = path.join(raceDir, f);
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) return null;
        let summary = null;
        const sp = path.join(fullPath, 'summary.json');
        if (fs.existsSync(sp)) {
          try { summary = JSON.parse(fs.readFileSync(sp, 'utf-8')); } catch {}
        }
        return { dir: f, fullPath, mtime: stat.mtime, summary };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10);
  } catch (e) {
    process.stderr.write(`  ${c.red}Could not read race directory: ${e.message}${c.reset}\n`);
    return;
  }

  const raceName = path.basename(raceDir);
  const dbl = '═'.repeat(56);
  const line = '─'.repeat(56);
  const write = (s) => process.stderr.write(s);

  write(`\n  ${c.bold}${dbl}${c.reset}\n`);
  write(`  ${c.bold}   📜  RECENT RACES: ${c.cyan}${raceName}${c.reset}\n`);
  write(`  ${c.bold}${dbl}${c.reset}\n\n`);

  if (entries.length === 0) {
    write(`  ${c.dim}No results found. Run a race first!${c.reset}\n\n`);
    return;
  }

  entries.forEach((e, i) => {
    const dateStr = e.mtime.toLocaleString();
    const num = `${c.bold}#${i + 1}${c.reset}`;

    if (!e.summary) {
      write(`  ${num}  ${c.dim}${dateStr}${c.reset}  ${c.dim}(no summary)${c.reset}\n`);
    } else {
      const s = e.summary;
      const racers = s.racers;

      let badge = '';
      if (s.overallWinner === 'tie') badge = `${c.yellow}🤝 Tie${c.reset}`;
      else if (s.overallWinner) {
        const winnerIdx = racers.indexOf(s.overallWinner);
        const wc = RACER_COLORS[winnerIdx % RACER_COLORS.length];
        badge = `${wc}🏆 ${s.overallWinner}${c.reset}`;
      }

      write(`  ${num}  ${c.dim}${dateStr}${c.reset}  ${badge}\n`);

      for (const comp of sortComparisonsForDisplay(s.comparisons)) {
        const durations = comp.racers.map((r, j) => r ? `${r.duration.toFixed(3)}s` : '-');
        // Assign medals based on ranking
        const medals = racers.map(r => {
          if (!comp.rankings || comp.rankings.length === 0) return '';
          const rank = comp.rankings.indexOf(r);
          if (rank === 0) return '🥇';
          if (rank === 1) return '🥈';
          if (rank === 2) return '🥉';
          if (rank >= 0) return `${rank + 1}️⃣`;
          return '';
        });
        const pct = comp.diffPercent !== null ? `${c.dim}(${comp.diffPercent.toFixed(1)}% diff)${c.reset}` : '';
        const racerStr = racers.map((r, j) => {
          const color = RACER_COLORS[j % RACER_COLORS.length];
          return `${color}${r}${c.reset} ${durations[j]} ${medals[j]}`;
        }).join('  ');
        write(`      ${c.cyan}${comp.name}${c.reset}: ${racerStr}  ${pct}\n`);
      }

      if (s.errors?.length > 0) {
        write(`      ${c.red}⚠ ${s.errors.length} error(s)${c.reset}\n`);
      }
    }

    write(`      ${c.dim}${e.fullPath}${c.reset}\n`);
    if (i < entries.length - 1) write(`  ${c.dim}${line}${c.reset}\n`);
  });

  write(`\n  ${c.dim}Showing ${entries.length} result(s)${c.reset}\n\n`);
}
