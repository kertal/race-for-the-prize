/**
 * Rich summary display and summary.json generation for race results.
 */

import fs from 'fs';
import path from 'path';
import { c } from './colors.js';

export function buildSummary(racerNames, results, settings, resultsDir) {
  const measurements = results.map(r => r.measurements || []);

  // Group measurements by name across both racers
  const allNames = new Set(measurements.flat().map(m => m.name));
  const comparisons = [...allNames].map(name => {
    const vals = racerNames.map((_, i) => {
      const m = measurements[i].find(m => m.name === name);
      return m ? { duration: m.duration, startTime: m.startTime, endTime: m.endTime } : null;
    });

    const comp = { name, racers: vals, winner: null, diff: null, diffPercent: null };

    if (vals[0] && vals[1]) {
      const winIdx = vals[0].duration <= vals[1].duration ? 0 : 1;
      const loseIdx = 1 - winIdx;
      comp.winner = racerNames[winIdx];
      comp.diff = vals[loseIdx].duration - vals[winIdx].duration;
      comp.diffPercent = vals[winIdx].duration > 0
        ? (comp.diff / vals[winIdx].duration * 100) : 0;
    }
    return comp;
  });

  const wins = racerNames.map(name => comparisons.filter(x => x.winner === name).length);
  let overallWinner = null;
  if (wins[0] > wins[1]) overallWinner = racerNames[0];
  else if (wins[1] > wins[0]) overallWinner = racerNames[1];
  else if (comparisons.length > 0) overallWinner = 'tie';

  return {
    timestamp: new Date().toISOString(),
    resultsDir,
    racers: racerNames,
    settings: settings || {},
    comparisons,
    overallWinner,
    wins: Object.fromEntries(racerNames.map((n, i) => [n, wins[i]])),
    errors: results.flatMap((r, i) => r.error ? [`${racerNames[i]}: ${r.error}`] : []),
    videos: Object.fromEntries(results.flatMap((r, i) => [
      [racerNames[i], r.videoPath || null],
      [`${racerNames[i]}_full`, r.fullVideoPath || null],
    ])),
    clickCounts: Object.fromEntries(racerNames.map((n, i) => [n, (results[i].clickEvents || []).length])),
  };
}

function printBar(label, duration, maxDuration, color, isWinner, width = 30) {
  const filled = maxDuration > 0 ? Math.round((duration / maxDuration) * width) : 0;
  const bar = '▓'.repeat(filled) + '░'.repeat(width - filled);
  const medal = isWinner ? ' 🏆' : '';
  return `    ${color}${c.bold}${label.padEnd(10)}${c.reset} ${color}${bar}${c.reset}  ${c.bold}${duration.toFixed(3)}s${c.reset}${medal}`;
}

export function printSummary(summary) {
  const { racers, comparisons, overallWinner, wins, errors, clickCounts } = summary;
  const colors = [c.red, c.blue];
  const w = 54;

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
      write(`  ${c.dim}⏱ ${comp.name}${c.reset}\n`);
      for (let i = 0; i < 2; i++) {
        if (comp.racers[i]) {
          const isWinner = comp.winner === racers[i];
          write(`${printBar(racers[i], comp.racers[i].duration, maxDur, colors[i], isWinner)}\n`);
        } else {
          write(`    ${colors[i]}${c.bold}${racers[i].padEnd(10)}${c.reset} ${c.dim}(no data)${c.reset}\n`);
        }
      }
      if (comp.diffPercent !== null) {
        const winColor = comp.winner === racers[0] ? colors[0] : colors[1];
        write(`    ${winColor}${c.bold}${comp.winner}${c.reset} is ${c.bold}${comp.diffPercent.toFixed(1)}%${c.reset} faster ${c.dim}(Δ ${comp.diff.toFixed(3)}s)${c.reset}\n`);
      }
    }
  }

  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);
  if (overallWinner === 'tie') {
    write(`  ${c.yellow}${c.bold}🤝 It's a tie!${c.reset}\n`);
  } else if (overallWinner) {
    const winColor = overallWinner === racers[0] ? colors[0] : colors[1];
    write(`  🏆 ${winColor}${c.bold}${overallWinner.toUpperCase()}${c.reset} ${c.bold}wins!${c.reset}\n`);
  }
  write(`  ${c.dim}${'─'.repeat(w)}${c.reset}\n`);

  // Click events — only show if there are any
  const totalClicks = racers.reduce((sum, r) => sum + (clickCounts[r] || 0), 0);
  if (totalClicks > 0) {
    write(`  ${c.bold}🖱  Clicks${c.reset}\n`);
    racers.forEach((r, i) => write(`    ${colors[i]}${r}${c.reset}: ${clickCounts[r]}\n`));
    write('\n');
  }
}

export function buildMarkdownSummary(summary, sideBySideName) {
  const { racers, comparisons, overallWinner, wins, errors, videos, clickCounts, settings, timestamp } = summary;
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
    lines.push(`## It\'s a Tie! ${racers[0]} ${wins[racers[0]]} - ${wins[racers[1]]} ${racers[1]}`);
  } else if (overallWinner) {
    lines.push(`## Winner: ${overallWinner} (${wins[racers[0]]} - ${wins[racers[1]]})`);
  }
  lines.push('');

  // Info
  lines.push('### Race Info');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Date** | ${new Date(timestamp).toLocaleString()} |`);
  lines.push(`| **Racer 1** | ${racers[0]} |`);
  lines.push(`| **Racer 2** | ${racers[1]} |`);

  if (settings) {
    const mode = settings.parallel === false ? 'sequential' : 'parallel';
    lines.push(`| **Mode** | ${mode} |`);
    if (settings.network && settings.network !== 'none') lines.push(`| **Network** | ${settings.network} |`);
    if (settings.cpuThrottle && settings.cpuThrottle > 1) lines.push(`| **CPU Throttle** | ${settings.cpuThrottle}x |`);
    if (settings.format && settings.format !== 'webm') lines.push(`| **Format** | ${settings.format} |`);
    if (settings.headless) lines.push(`| **Headless** | yes |`);
    if (settings.runs && settings.runs > 1) lines.push(`| **Runs** | ${settings.runs} |`);
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
    lines.push(`| Measurement | ${racers[0]} | ${racers[1]} | Winner | Diff |`);
    lines.push(`|---|---|---|---|---|`);
    for (const comp of comparisons) {
      const d0 = comp.racers[0] ? `${comp.racers[0].duration.toFixed(3)}s` : '-';
      const d1 = comp.racers[1] ? `${comp.racers[1].duration.toFixed(3)}s` : '-';
      const winner = comp.winner || '-';
      const diff = comp.diffPercent !== null ? `${comp.diffPercent.toFixed(1)}%` : '-';
      lines.push(`| ${comp.name} | ${d0} | ${d1} | ${winner} | ${diff} |`);
    }
    lines.push('');

    lines.push(`| Clicks | ${clickCounts[racers[0]]} | ${clickCounts[racers[1]]} | | |`);
    lines.push('');
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

/** Compute median of each measurement across multiple runs. */
export function buildMedianSummary(summaries, resultsDir) {
  const racers = summaries[0].racers;
  const allNames = new Set(summaries.flatMap(s => s.comparisons.map(c => c.name)));

  const comparisons = [...allNames].map(name => {
    const vals = [0, 1].map(i => {
      const durations = summaries
        .map(s => s.comparisons.find(c => c.name === name)?.racers[i]?.duration)
        .filter(d => d != null)
        .sort((a, b) => a - b);
      if (durations.length === 0) return null;
      const mid = Math.floor(durations.length / 2);
      const median = durations.length % 2 === 1 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
      return { duration: median };
    });

    const comp = { name, racers: vals, winner: null, diff: null, diffPercent: null };
    if (vals[0] && vals[1]) {
      const winIdx = vals[0].duration <= vals[1].duration ? 0 : 1;
      const loseIdx = 1 - winIdx;
      comp.winner = racers[winIdx];
      comp.diff = vals[loseIdx].duration - vals[winIdx].duration;
      comp.diffPercent = vals[winIdx].duration > 0
        ? (comp.diff / vals[winIdx].duration * 100) : 0;
    }
    return comp;
  });

  const wins = racers.map(name => comparisons.filter(x => x.winner === name).length);
  let overallWinner = null;
  if (wins[0] > wins[1]) overallWinner = racers[0];
  else if (wins[1] > wins[0]) overallWinner = racers[1];
  else if (comparisons.length > 0) overallWinner = 'tie';

  return {
    timestamp: new Date().toISOString(),
    resultsDir,
    racers,
    settings: summaries[0].settings,
    comparisons,
    overallWinner,
    wins: Object.fromEntries(racers.map((n, i) => [n, wins[i]])),
    errors: summaries.flatMap(s => s.errors || []),
    videos: {},
    clickCounts: Object.fromEntries(racers.map(n => [n, 0])),
    runs: summaries.length,
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
      lines.push(`| Measurement | ${s.racers[0]} | ${s.racers[1]} | Winner | Diff |`);
      lines.push(`|---|---|---|---|---|`);
      for (const comp of s.comparisons) {
        const d0 = comp.racers[0] ? `${comp.racers[0].duration.toFixed(3)}s` : '-';
        const d1 = comp.racers[1] ? `${comp.racers[1].duration.toFixed(3)}s` : '-';
        lines.push(`| ${comp.name} | ${d0} | ${d1} | ${comp.winner || '-'} | ${comp.diffPercent !== null ? `${comp.diffPercent.toFixed(1)}%` : '-'} |`);
      }
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
      const colors = [c.red, c.blue];

      let badge = '';
      if (s.overallWinner === 'tie') badge = `${c.yellow}🤝 Tie${c.reset}`;
      else if (s.overallWinner) {
        const wc = s.overallWinner === racers[0] ? colors[0] : colors[1];
        badge = `${wc}🏆 ${s.overallWinner}${c.reset}`;
      }

      write(`  ${num}  ${c.dim}${dateStr}${c.reset}  ${badge}\n`);

      for (const comp of s.comparisons) {
        const durations = comp.racers.map((r, j) => r ? `${r.duration.toFixed(3)}s` : '-');
        const medals = racers.map(r => comp.winner === r ? '🥇' : '🥈');
        const pct = comp.diffPercent !== null ? `${c.dim}(${comp.diffPercent.toFixed(1)}% diff)${c.reset}` : '';
        write(`      ${c.cyan}${comp.name}${c.reset}: ${colors[0]}${racers[0]}${c.reset} ${durations[0]} ${medals[0]}  ${colors[1]}${racers[1]}${c.reset} ${durations[1]} ${medals[1]}  ${pct}\n`);
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
