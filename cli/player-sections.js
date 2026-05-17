/**
 * player-sections.js — Build-time HTML section builders for the race player.
 *
 * Each function returns an HTML string (or '' if nothing to show).
 * HTML structures are defined as <template id="build-*"> elements in player.html;
 * videoplayer.js extracts them at load time and passes them via setTemplates().
 */

import { PROFILE_METRICS, categoryDescriptions, determineProfileMetricOutcome } from './profile-analysis.js';
import { formatPlatform } from './summary.js';

export const RACER_CSS_COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f1c40f', '#9b59b6'];
const NON_PREFIX_SECTION_NAMES = new Set(['Race', 'Race (All Sections)']);

let T = {};

/** Store build-time templates extracted from player.html. */
export function setTemplates(templates) { T = templates; }

/**
 * Replace {{key}} placeholders in a template string with data values.
 * IMPORTANT: This does NOT auto-escape values. Callers MUST use escHtml() on
 * any user-supplied strings before passing them as data values. Pre-built HTML
 * snippets (e.g. nested template output) should be passed without escaping.
 */
export function render(tmpl, data) {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

/** Escape a string for safe embedding in HTML text/attribute contexts. */
export function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Sort racers by value ascending (best first), nulls last. */
export function sortByValue(racers, getValue) {
  return racers
    .map((name, i) => ({ name, index: i, ...getValue(i) }))
    .sort((a, b) => {
      if (a.val === null) return 1;
      if (b.val === null) return -1;
      return a.val - b.val;
    });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function infoItem(label, value) {
  return `<dt>${escHtml(label)}</dt><dd>${value}</dd>`;
}

function racerName(racers, origIdx) {
  const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
  return render(T['racer-name'], { color, name: escHtml(racers[origIdx]) });
}

function formatSectionTitle(name) {
  if (NON_PREFIX_SECTION_NAMES.has(name)) return name;
  if (/^race section\b/i.test(name)) return name;
  if (/^section\b/i.test(name)) return name.replace(/^section\b/i, 'Race Section');
  return `Race Section ${name}`;
}

function sortComparisonsForDisplay(comparisons) {
  return [...comparisons].sort((a, b) => {
    const aIsTotal = a?.isSyntheticTotal === true;
    const bIsTotal = b?.isSyntheticTotal === true;
    if (aIsTotal && !bIsTotal) return -1;
    if (!aIsTotal && bIsTotal) return 1;
    return 0;
  });
}

function isTotalComparison(comp) {
  return comp?.isSyntheticTotal === true;
}

/** Build sorted bar-chart HTML rows for a single metric. */
function buildMetricRowsHtml(entries, winner, formatDelta) {
  const nonNullVals = entries.filter(e => e.val !== null).map(e => e.val);
  const maxVal = nonNullVals.length > 0 ? Math.max(...nonNullVals) : 0;
  const bestVal = entries[0]?.val;
  let html = '';
  for (const entry of entries) {
    const color = RACER_CSS_COLORS[entry.index % RACER_CSS_COLORS.length];
    const barPct = entry.val !== null && maxVal > 0 ? Math.round((entry.val / maxVal) * 100) : 0;
    let delta = '';
    if (entry.val !== null && bestVal !== null && entry.val !== bestVal) {
      delta = `<span class="profile-delta">(+${formatDelta(entry.val - bestVal)})</span>`;
    }
    html += render(T['profile-row'], {
      color,
      name: escHtml(entry.name),
      barPct,
      ariaValueText: escHtml(entry.formatted),
      ariaLabel: `${escHtml(entry.name)}: ${escHtml(entry.formatted)}`,
      value: escHtml(entry.formatted) + delta,
      medal: winner === entry.name ? '<span class="profile-medal" aria-label="winner">&#127942;</span>' : '',
    });
  }
  return html;
}

function buildCollapsibleSectionMetricHtml(name, rows, open = false) {
  const openAttr = open ? ' open' : '';
  return `<details class="profile-metric section-metric"${openAttr}>
  <summary><span class="profile-metric-name">${escHtml(name)}</span></summary>
  <div>${rows}</div>
</details>`;
}

function buildSectionMeasuredComparisons(rawProfileMetrics, racers) {
  const measuredMetricDefs = Object.entries(PROFILE_METRICS)
    .filter(([_, metric]) => metric.scope === 'measured')
    .map(([key, metric]) => ({ metricName: key.split('.')[1], metric }));

  const sectionNames = [...new Set(
    rawProfileMetrics.flatMap(pm => Object.keys(pm?.measuredSections || {}))
  )];

  return sectionNames.map(sectionName => {
    const comparisons = [];
    for (const { metricName, metric } of measuredMetricDefs) {
      const values = racers.map((_, i) => rawProfileMetrics[i]?.measuredSections?.[sectionName]?.[metricName] ?? null);
      if (values.every(v => v == null)) continue;

      const { winner } = determineProfileMetricOutcome(metric, racers, values);

      comparisons.push({
        key: `measured.${metricName}`,
        name: metric.name,
        category: metric.category,
        values,
        formatted: values.map(v => v != null ? metric.format(v) : '-'),
        winner,
      });
    }
    return { name: sectionName, comparisons };
  }).filter(section => section.comparisons.length > 0);
}

// ---------------------------------------------------------------------------
// Section Builders
// ---------------------------------------------------------------------------

export function buildRunNavHtml(runNav, racers, runSummaries) {
  if (!runNav) return '';
  const { currentRun, totalRuns, pathPrefix } = runNav;

  // Map each run's overall winner to a CSS color
  const winnerColors = [];
  if (runSummaries && racers) {
    for (const s of runSummaries) {
      const idx = s.overallWinner && s.overallWinner !== 'tie' ? racers.indexOf(s.overallWinner) : -1;
      winnerColors.push(idx >= 0 ? RACER_CSS_COLORS[idx % RACER_CSS_COLORS.length] : null);
    }
  }

  let html = '<nav class="run-nav" aria-label="Race runs">';
  const isMedianCurrent = currentRun === 'median';
  if (isMedianCurrent) {
    html += `<span aria-current="page">Median</span>`;
  } else {
    html += `<a href="${escHtml(pathPrefix)}index.html">Median</a>`;
  }
  for (let i = 1; i <= totalRuns; i++) {
    const isCurrent = currentRun === i;
    const color = winnerColors[i - 1];
    const textColor = isCurrent ? '#1a1a1a' : '#fff';
    const style = color ? ` style="border-color:${color};color:${textColor}"` : '';
    if (isCurrent) {
      html += `<span${style} aria-current="page">Run ${i}</span>`;
    } else {
      html += `<a${style} href="${escHtml(pathPrefix)}${i}/index.html">Run ${i}</a>`;
    }
  }
  html += '</nav>';
  return html;
}

export function buildRaceInfoHtml(summary) {
  const { racers, settings, timestamp } = summary;
  const items = [];
  if (timestamp) {
    items.push(infoItem('Timestamp', escHtml(new Date(timestamp).toISOString())));
  }
  racers.forEach((r, i) => items.push(infoItem(`Racer ${i + 1}`, escHtml(r))));
  if (settings) {
    const mode = settings.parallel === false ? 'sequential' : 'parallel';
    items.push(infoItem('Mode', mode));
    if (settings.network && settings.network !== 'none') items.push(infoItem('Network', escHtml(settings.network)));
    if (settings.cpuThrottle && settings.cpuThrottle > 1) items.push(infoItem('CPU Throttle', `${settings.cpuThrottle}x`));
    if (settings.format && settings.format !== 'webm') items.push(infoItem('Format', escHtml(settings.format)));
    if (settings.headless) items.push(infoItem('Headless', 'yes'));
    if (settings.runs && settings.runs > 1) items.push(infoItem('Runs', settings.runs));
  }
  if (items.length === 0) return '';
  return `<dl class="race-info">${items.join('')}</dl>`;
}

export function buildMachineInfoHtml(machineInfo) {
  if (!machineInfo) return '';
  const items = [];
  items.push(infoItem('OS', `${escHtml(formatPlatform(machineInfo.platform))} ${escHtml(machineInfo.osRelease)} (${escHtml(machineInfo.arch)})`));
  items.push(infoItem('CPU', `${escHtml(machineInfo.cpuModel)} (${machineInfo.cpuCores} cores)`));
  if (machineInfo.totalMemoryMB) {
    items.push(infoItem('Memory', `${(machineInfo.totalMemoryMB / 1024).toFixed(1)} GB`));
  }
  if (machineInfo.nodeVersion) {
    items.push(infoItem('Node.js', escHtml(machineInfo.nodeVersion)));
  }
  return `<dl class="machine-info">${items.join('')}</dl>`;
}

export function buildErrorsHtml(errors) {
  if (!errors || errors.length === 0) return '';
  return `<div class="errors" role="alert"><ul>${errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul></div>`;
}

export function buildResultsHtml(comparisons, racers) {
  let html = '';
  const displayComparisons = sortComparisonsForDisplay(comparisons);
  const sectionComparisonCount = displayComparisons.filter(comp => !isTotalComparison(comp)).length;
  const expandSingleSection = sectionComparisonCount === 1;
  for (const comp of displayComparisons) {
    const sorted = sortByValue(racers, i => {
      const r = comp.racers[i];
      return { val: r ? r.duration : null, formatted: r ? `${r.duration.toFixed(3)}s` : '-' };
    });
    const rows = buildMetricRowsHtml(sorted, comp.winner, v => `${v.toFixed(3)}s`);
    if (isTotalComparison(comp)) {
      html += render(T['profile-metric'], {
        metricClass: 'profile-metric-total',
        titleAttr: '',
        name: escHtml(formatSectionTitle(comp.name)),
        desc: '',
        rows,
      }) + '\n';
    } else {
      html += buildCollapsibleSectionMetricHtml(formatSectionTitle(comp.name), rows, expandSingleSection) + '\n';
    }
  }
  return html;
}

export function buildProfileSummaryHtml(profileComparison, racers) {
  const sectionComparisons = (profileComparison?.sectionComparisons || [])
    .filter(comp => !isTotalComparison(comp));

  function buildWinRows(winsMap) {
    if (!racers.some(n => winsMap[n] > 0)) return '';
    return racers
      .map((name, i) => ({ name, i, count: winsMap[name] || 0 }))
      .sort((a, b) => b.count - a.count)
      .map(({ name, i, count }) => {
        const color = RACER_CSS_COLORS[i % RACER_CSS_COLORS.length];
        return `<div class="profile-row"><span class="profile-racer" style="color:${color}">${escHtml(name)}</span><span class="profile-value" style="margin-left:auto">${'&#127942;'.repeat(count)}</span></div>`;
      }).join('');
  }

  const measuredWins = profileComparison?.measured?.wins || {};
  const totalWins = profileComparison?.total?.wins || {};
  const measuredRows = buildWinRows(measuredWins);
  const totalRows = buildWinRows(totalWins);

  if (!measuredRows && !totalRows && sectionComparisons.length === 0) return '';

  let html = `<details open>
  <summary><h2>Performance Results</h2></summary>
  <div>`;

  if (measuredRows) {
    html += render(T['profile-metric'], { metricClass: 'profile-metric-total', titleAttr: '', name: 'Race', desc: '', rows: measuredRows });
  }
  if (sectionComparisons.length > 0) {
    const openSectionRows = sectionComparisons.length === 1;
    html += sectionComparisons.map(comp => {
      const sorted = sortByValue(racers, i => {
        const r = comp.racers[i];
        return { val: r ? r.duration : null, formatted: r ? `${r.duration.toFixed(3)}s` : '-' };
      });
      return buildCollapsibleSectionMetricHtml(
        formatSectionTitle(comp.name),
        buildMetricRowsHtml(sorted, comp.winner, v => `${v.toFixed(3)}s`),
        openSectionRows
      );
    }).join('\n');
  }
  if (totalRows) {
    html += render(T['profile-metric'], { metricClass: '', titleAttr: '', name: 'Total Recording (Including Pre and Post race)', desc: '', rows: totalRows });
  }

  html += `\n  </div>\n</details>`;
  return html;
}

export function buildProfileHtml(profileComparison, racers) {
  if (!profileComparison) return '';
  const measured = profileComparison.measured || { comparisons: [], byCategory: {}, overallWinner: null };
  const total = profileComparison.total || { comparisons: [], byCategory: {}, overallWinner: null };
  const sectionMeasuredComparisons = buildSectionMeasuredComparisons(profileComparison.rawProfileMetrics || [], racers);
  if (measured.comparisons.length === 0 && total.comparisons.length === 0 && sectionMeasuredComparisons.length === 0) return '';

  let html = `<details>
  <summary><h2>Performance Profile</h2></summary>
  <div>
  <p class="profile-note">Lower values are better for all metrics. Hover over metric names for details.</p>\n`;

  const scopes = [
    { title: 'Race', desc: 'Metrics captured only between raceStart() and raceEnd() calls \u2014 isolates the code being tested.', section: measured, collapsed: false },
    { title: 'Total Recording (Including Pre and Post race)', desc: 'Metrics for the entire recording window including pre-race setup and post-race teardown.', section: total, collapsed: true },
  ];
  for (const scope of scopes) {
    const showMeasuredSectionMetrics = scope.section === measured && sectionMeasuredComparisons.length > 1;
    if (scope.section.comparisons.length === 0 && !showMeasuredSectionMetrics) continue;

    if (scope.collapsed) {
      html += `<details>\n<summary><h3>${escHtml(scope.title)}</h3></summary>\n`;
    } else {
      html += `<h3>${escHtml(scope.title)}</h3>\n`;
    }
    html += `<p class="profile-scope-desc">${escHtml(scope.desc)}</p>\n`;
    for (const [category, comps] of Object.entries(scope.section.byCategory)) {
      const catLabel = category[0].toUpperCase() + category.slice(1);
      const catDesc = categoryDescriptions[category] || '';
      html += `<h4 ${catDesc ? `title="${escHtml(catDesc)}"` : ''}>${escHtml(catLabel)}</h4>\n`;
      if (catDesc) {
        html += `<p class="profile-category-desc">${escHtml(catDesc)}</p>\n`;
      }
      for (const comp of comps) {
        const sorted = sortByValue(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }));
        const metricDef = PROFILE_METRICS[comp.key];
        const formatDeltaFn = metricDef.format;
        const desc = metricDef.description || '';
        html += render(T['profile-metric'], {
          metricClass: '',
          titleAttr: desc ? `title="${escHtml(desc)}"` : '',
          name: escHtml(comp.name) + (desc ? ' <span class="profile-info-icon">&#9432;</span>' : ''),
          desc: desc ? `<div class="profile-metric-desc">${escHtml(desc)}</div>` : '',
          rows: buildMetricRowsHtml(sorted, comp.winner, formatDeltaFn),
        }) + '\n';
      }
    }
    if (showMeasuredSectionMetrics) {
      html += `<h4>Per-Section Profile Metrics</h4>\n`;
      for (const section of sectionMeasuredComparisons) {
        let sectionMetricsRows = '';
        for (const comp of section.comparisons) {
          const sorted = sortByValue(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }));
          const metricDef = PROFILE_METRICS[comp.key];
          sectionMetricsRows += render(T['profile-metric'], {
            metricClass: '',
            titleAttr: '',
            name: escHtml(comp.name),
            desc: '',
            rows: buildMetricRowsHtml(sorted, comp.winner, metricDef.format),
          }) + '\n';
        }
        html += buildCollapsibleSectionMetricHtml(formatSectionTitle(section.name), sectionMetricsRows, false) + '\n';
      }
    }
    if (scope.section.overallWinner === 'tie') {
      html += `<div class="profile-winner">&#129309; Tie!</div>`;
    } else if (scope.section.overallWinner) {
      const idx = racers.indexOf(scope.section.overallWinner);
      html += `<div class="profile-winner">&#127942; <span style="color: ${RACER_CSS_COLORS[idx % RACER_CSS_COLORS.length]}">${escHtml(scope.section.overallWinner)}</span> wins!</div>`;
    }
    if (scope.collapsed) {
      html += `</details>\n`;
    }
  }

  html += `</div>\n</details>`;
  return html;
}

export function buildRunComparisonHtml(summaries, medianSummary, racers) {
  if (!summaries || summaries.length <= 1) return '';
  const allNames = new Set(summaries.flatMap(s => s.comparisons.map(c => c.name)));
  const hasProfileData = summaries.some(s => s.profileMetrics?.some(Boolean));
  if (allNames.size === 0 && !hasProfileData) return '';

  const racerColors = racers.map((_, i) => RACER_CSS_COLORS[i % RACER_CSS_COLORS.length]);
  const coloredHeader = racers.map((r, i) => `<th style="color:${racerColors[i]}">${escHtml(r)}</th>`).join('');

  /** Format a duration cell: trophy for winner, delta for losers. */
  const durationCell = (dur, bestDur, isWinner, bold) => {
    if (dur == null) return bold ? '<td><strong>-</strong></td>' : '<td>-</td>';
    const val = dur.toFixed(3) + 's';
    let content;
    if (isWinner) {
      content = `${escHtml(val)} (\uD83C\uDFC6)`;
    } else if (bestDur != null) {
      const delta = `+${(dur - bestDur).toFixed(3)}s`;
      content = `${escHtml(val)} <span style="opacity:0.5">(${escHtml(delta)})</span>`;
    } else {
      content = escHtml(val);
    }
    return bold ? `<td><strong>${content}</strong></td>` : `<td>${content}</td>`;
  };

  /** Format a generic value cell: trophy for winner, delta for losers. */
  const valueCell = (val, bestVal, isWinner, formatFn, bold) => {
    if (val == null) return bold ? '<td><strong>-</strong></td>' : '<td>-</td>';
    const formatted = formatFn(val);
    let content;
    if (isWinner) {
      content = `${escHtml(formatted)} (\uD83C\uDFC6)`;
    } else if (bestVal != null) {
      const delta = `+${formatFn(val - bestVal)}`;
      content = `${escHtml(formatted)} <span style="opacity:0.5">(${escHtml(delta)})</span>`;
    } else {
      content = escHtml(formatted);
    }
    return bold ? `<td><strong>${content}</strong></td>` : `<td>${content}</td>`;
  };

  let html = `<details>\n  <summary><h2>Run-by-Run Comparison</h2></summary>\n  <div>`;

  // --- Measurement comparisons ---
  const orderedNames = sortComparisonsForDisplay([...allNames].map(name => ({ name }))).map(c => c.name);
  for (const name of orderedNames) {
    const sectionTitle = formatSectionTitle(name);
    html += `<h3>${escHtml(sectionTitle)}</h3>\n`;
    html += `<table class="run-comparison-table"><caption class="sr-only">Per-run durations for ${escHtml(sectionTitle)}</caption><thead><tr><th scope="col">Run</th>`;
    html += coloredHeader;
    html += `</tr></thead><tbody>`;

    for (let i = 0; i < summaries.length; i++) {
      const comp = summaries[i].comparisons.find(c => c.name === name);
      html += `<tr><td>${i + 1}</td>`;
      if (!comp) {
        for (const _ of racers) html += `<td>-</td>`;
        html += `</tr>`;
        continue;
      }
      const bestDur = comp.winner ? comp.racers[racers.indexOf(comp.winner)]?.duration : null;
      for (let j = 0; j < racers.length; j++) {
        const r = comp.racers[j];
        html += durationCell(r?.duration, bestDur, comp.winner === racers[j], false);
      }
      html += `</tr>`;
    }

    const medComp = medianSummary.comparisons.find(c => c.name === name);
    if (medComp) {
      const bestDur = medComp.winner ? medComp.racers[racers.indexOf(medComp.winner)]?.duration : null;
      html += `<tr class="run-comparison-median"><td><strong>Median</strong></td>`;
      for (let j = 0; j < racers.length; j++) {
        html += durationCell(medComp.racers[j]?.duration, bestDur, medComp.winner === racers[j], true);
      }
      html += `</tr>`;
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
      html += `<tr class="run-comparison-median"><td><strong>Average</strong></td>`;
      for (let j = 0; j < racers.length; j++) {
        const isWinner = bestAvg != null && avgDurations[j] === bestAvg;
        html += durationCell(avgDurations[j], bestAvg, isWinner, true);
      }
      html += `</tr>`;
    }

    html += `</tbody></table>`;
  }

  // --- Performance metrics comparisons ---
  if (hasProfileData) {
    const metricsWithData = [];
    for (const [key, metric] of Object.entries(PROFILE_METRICS)) {
      const [scope, metricName] = key.split('.');
      const hasData = summaries.some(s =>
        racers.some((_, j) => s.profileMetrics?.[j]?.[scope]?.[metricName] != null)
      );
      if (hasData) metricsWithData.push({ metric, scope, metricName });
    }

    if (metricsWithData.length > 0) {
      const scopes = [
        { scope: 'measured', title: 'Race' },
        { scope: 'total', title: 'Total Recording (Including Pre and Post race)' },
      ];
      for (const { scope: scopeName, title: scopeTitle } of scopes) {
        const scopeMetrics = metricsWithData.filter(m => m.scope === scopeName);
        if (scopeMetrics.length === 0) continue;

        html += `<h3>Performance: ${escHtml(scopeTitle)}</h3>\n`;

        for (const { metric, metricName } of scopeMetrics) {
          html += `<h4>${escHtml(metric.name)}</h4>\n`;
          html += `<table class="run-comparison-table"><caption class="sr-only">Per-run ${escHtml(metric.name)} (${escHtml(scopeTitle)})</caption><thead><tr><th scope="col">Run</th>`;
          html += coloredHeader;
          html += `</tr></thead><tbody>`;

          for (let i = 0; i < summaries.length; i++) {
            const s = summaries[i];
            html += `<tr><td>${i + 1}</td>`;
            const vals = racers.map((_, j) => s.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null);
            const withData = vals.map((v, j) => v != null ? { j, v } : null).filter(Boolean).sort((a, b) => a.v - b.v);
            const bestVal = (withData.length >= 2 && withData[0].v !== withData[withData.length - 1].v) ? withData[0].v : null;
            const winnerIdx = bestVal != null ? withData[0].j : -1;
            for (let j = 0; j < racers.length; j++) {
              html += valueCell(vals[j], bestVal, j === winnerIdx, metric.format.bind(metric), false);
            }
            html += `</tr>`;
          }

          // Median row
          const medVals = racers.map((_, j) => medianSummary.profileMetrics?.[j]?.[scopeName]?.[metricName] ?? null);
          const medWithData = medVals.map((v, j) => v != null ? { j, v } : null).filter(Boolean).sort((a, b) => a.v - b.v);
          if (medVals.some(v => v != null)) {
            const bestMedVal = (medWithData.length >= 2 && medWithData[0].v !== medWithData[medWithData.length - 1].v) ? medWithData[0].v : null;
            const medWinnerIdx = bestMedVal != null ? medWithData[0].j : -1;
            html += `<tr class="run-comparison-median"><td><strong>Median</strong></td>`;
            for (let j = 0; j < racers.length; j++) {
              html += valueCell(medVals[j], bestMedVal, j === medWinnerIdx, metric.format.bind(metric), true);
            }
            html += `</tr>`;
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
            html += `<tr class="run-comparison-median"><td><strong>Average</strong></td>`;
            for (let j = 0; j < racers.length; j++) {
              html += valueCell(avgVals[j], bestAvgVal, j === avgWinnerIdx, metric.format.bind(metric), true);
            }
            html += `</tr>`;
          }

          html += `</tbody></table>`;
        }
      }
    }
  }

  html += `\n  </div>\n</details>`;
  return html;
}

export function buildFilesHtml(racers, videoFiles, options) {
  const { fullVideoFiles, mergedVideoFile, traceFiles, harFiles, raceScriptFiles, settingsFileCopied, altFormat, altFiles, placementOrder } = options;
  const links = [];
  const order = placementOrder || racers.map((_, i) => i);

  order.forEach(i => {
    if (videoFiles[i]) links.push(render(T['file-link'], { href: escHtml(videoFiles[i]), attrs: '', text: `${escHtml(racers[i])} (race)` }));
  });
  if (fullVideoFiles) {
    order.forEach(i => {
      if (fullVideoFiles[i]) links.push(render(T['file-link'], { href: escHtml(fullVideoFiles[i]), attrs: '', text: `${escHtml(racers[i])} (full)` }));
    });
  }
  if (mergedVideoFile) {
    links.push(render(T['file-link'], { href: escHtml(mergedVideoFile), attrs: '', text: 'side-by-side' }));
  }
  if (altFormat && altFiles) {
    order.forEach(i => {
      if (altFiles[i]) links.push(render(T['file-link'], { href: escHtml(altFiles[i]), attrs: 'download', text: `${escHtml(racers[i])} (.${escHtml(altFormat)})` }));
    });
  }
  if (traceFiles) {
    order.forEach(i => {
      if (traceFiles[i]) links.push(render(T['file-link'], { href: escHtml(traceFiles[i]), attrs: 'title="Open in chrome://tracing or ui.perfetto.dev"', text: `${escHtml(racers[i])} (profile)` }));
    });
  }
  if (harFiles) {
    order.forEach(i => {
      if (harFiles[i]) links.push(render(T['file-link'], { href: escHtml(harFiles[i]), attrs: 'download title="HTTP Archive — open in browser DevTools or har.tech"', text: `${escHtml(racers[i])} (HAR)` }));
    });
  }
  if (raceScriptFiles && raceScriptFiles.length > 0) {
    for (const f of raceScriptFiles) {
      links.push(render(T['file-link'], { href: escHtml(f), attrs: 'title="Race script \u2014 rerun with: node race.js &lt;dir&gt;"', text: `${escHtml(f)} (script)` }));
    }
  }
  if (settingsFileCopied) {
    links.push(render(T['file-link'], { href: 'settings.json', attrs: '', text: 'settings.json' }));
  }

  if (links.length === 0) return '';

  return `<details>
  <summary><h2>Files</h2></summary>
  <div>
    <ul class="file-links">
      ${links.join('\n      ')}
    </ul>
  </div>
</details>`;
}

export function buildDebugPanelHtml(racers, placementOrder, clipTimes) {
  const orderedClipTimes = placementOrder.map(i => clipTimes[i] || null);

  const debugRows = placementOrder.map((origIdx, displayIdx) => {
    const clip = orderedClipTimes[displayIdx];
    const startVal = clip && Number.isFinite(clip.start) ? clip.start.toFixed(3) : '0.000';
    return render(T['debug-row'], { displayIdx, racerNameSpan: racerName(racers, origIdx), startVal });
  }).join('');

  const statsRows = placementOrder.map((origIdx, displayIdx) =>
    render(T['debug-stats-row'], { displayIdx, racerNameSpan: racerName(racers, origIdx) })
  ).join('\n');

  const frameRows = placementOrder.map((origIdx, displayIdx) =>
    render(T['debug-frame-row'], { displayIdx, racerNameSpan: racerName(racers, origIdx) })
  ).join('\n');

  const timingRows = placementOrder.map((origIdx, displayIdx) =>
    render(T['debug-timing-racer'], { displayIdx, racerNameSpan: racerName(racers, origIdx) })
  ).join('\n');

  return render(T['debug-panel'], { debugRows, statsRows, frameRows, timingRows });
}

export function buildPlayerSectionHtml(videoElements, mergedVideoElement) {
  return render(T['player-section'], {
    videoElements,
    mergedVideoElement: mergedVideoElement || '',
  });
}
