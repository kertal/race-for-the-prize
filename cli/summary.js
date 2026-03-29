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
 * Build markdown results table rows.
 * Returns array of markdown lines for the table.
 */
function buildResultsTable(comparisons, racers, clickCounts = null) {
  const lines = [];
  const headerCols = ['Measurement', ...racers, 'Winner', 'Diff'];
  lines.push(`| ${headerCols.join(' | ')} |`);
  lines.push(`|${headerCols.map(() => '---').join('|')}|`);
  for (const comp of comparisons) {
    const durations = racers.map((_, i) =>
      comp.racers[i] ? `${comp.racers[i].duration.toFixed(3)}s` : '-'
    );
    const winner = comp.winner || '-';
    const diff = comp.diffPercent !== null ? `${comp.diffPercent.toFixed(1)}%` : '-';
    lines.push(`| ${comp.name} | ${durations.join(' | ')} | ${winner} | ${diff} |`);
  }
  if (clickCounts) {
    const clickValues = racers.map(r => clickCounts[r]);
    lines.push(`| Clicks | ${clickValues.join(' | ')} | | |`);
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
  const overallWinner = determineOverallWinner(wins, racerNames, comparisons);

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
    clickCounts: Object.fromEntries(racerNames.map((n, i) => [n, (results[i].clickEvents || []).length])),
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
  const { racers, comparisons, overallWinner, wins, errors, clickCounts, profileComparison } = summary;
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
    for (const comp of comparisons) {
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

  // Click events — only show if there are any
  const totalClicks = racers.reduce((sum, r) => sum + (clickCounts[r] || 0), 0);
  if (totalClicks > 0) {
    write(`  ${c.bold}🖱  Clicks${c.reset}\n`);
    racers.forEach((r, i) => {
      const color = RACER_COLORS[i % RACER_COLORS.length];
      write(`    ${color}${r}${c.reset}: ${clickCounts[r]}\n`);
    });
    write('\n');
  }

  // Profile analysis — only show if metrics were captured
  if (profileComparison && profileComparison.comparisons.length > 0) {
    printProfileAnalysis(profileComparison, racers);
  }
}

export function buildMarkdownSummary(summary, sideBySideName) {
  const { racers, comparisons, overallWinner, wins, errors, videos, clickCounts, settings, timestamp, profileComparison, machineInfo } = summary;
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
    lines.push(...buildResultsTable(comparisons, racers, clickCounts));
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
  const allNames = new Set(summaries.flatMap(s => s.comparisons.map(c => c.name)));

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
  const overallWinner = determineOverallWinner(wins, racers, comparisons);

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
    clickCounts: Object.fromEntries(racers.map(n => [n, 0])),
    runs: summaries.length,
    machineInfo: summaries.find(s => s.machineInfo)?.machineInfo,
    profileMetrics: medianProfileMetrics,
    profileComparison: medianProfileMetrics ? buildProfileComparison(racers, medianProfileMetrics) : null,
  };
}

/** Build markdown report for multi-run races with individual run details. */
export function buildMultiRunMarkdown(medianSummary, summaries) {
  let md = buildMarkdownSummary(medianSummary, null);
  md = md.replace('### Race Info', `### Median Results (${summaries.length} runs)\n\n### Race Info`);

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

      for (const comp of s.comparisons) {
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
