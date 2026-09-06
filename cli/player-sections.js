/**
 * player-sections.js — Build-time HTML section builders for the race player.
 *
 * Each function returns an HTML string (or '' if nothing to show).
 * HTML structures are defined as <template id="build-*"> elements in player.html;
 * videoplayer.js extracts them at load time and passes them via setTemplates().
 */

import { PROFILE_METRICS, categoryDescriptions, determineProfileMetricOutcome } from './profile-analysis.js';
import { formatPlatform } from './summary.js';
import {
  isSyntheticTotal,
  buildResultsModel,
  buildRunComparisonModel,
  rankEntries,
  rankComparisonDurations,
} from './report-model.js';

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
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function infoItem(label, value) {
  return render(T['info-item'], { label, value });
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

/** Build sorted bar-chart HTML rows for a single metric from a report-model ranking. */
function buildMetricRowsHtml(ranking, winner) {
  const { entries, maxValue } = ranking;
  let html = '';
  for (const entry of entries) {
    const color = RACER_CSS_COLORS[entry.index % RACER_CSS_COLORS.length];
    const barPct = entry.val !== null && maxValue > 0 ? Math.round((entry.val / maxValue) * 100) : 0;
    const delta = entry.delta != null
      ? `<span class="profile-delta">(+${entry.delta})</span>`
      : '';
    html += render(T['profile-row'], {
      color,
      name: escHtml(entry.name),
      barPct,
      value: escHtml(entry.formatted) + delta,
      medal: winner === entry.name ? '<span class="profile-medal">&#127942;</span>' : '',
    });
  }
  return html;
}

function buildCollapsibleSectionMetricHtml(name, rows, open = false) {
  const openAttr = open ? ' open' : '';
  return `<details class="profile-metric section-metric"${openAttr}>
  <summary><span class="profile-metric-name">${escHtml(name)}</span></summary>
  <div class="section-metric-body">${rows}</div>
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

  let html = '<div class="run-nav">';
  const isMedianCurrent = currentRun === 'median';
  const medianCls = isMedianCurrent ? 'run-nav-btn active' : 'run-nav-btn';
  if (isMedianCurrent) {
    html += `<span class="${medianCls}" aria-current="page">Median</span>`;
  } else {
    html += `<a class="${medianCls}" href="${escHtml(pathPrefix)}index.html">Median</a>`;
  }
  for (let i = 1; i <= totalRuns; i++) {
    const isCurrent = currentRun === i;
    const cls = isCurrent ? 'run-nav-btn active' : 'run-nav-btn';
    const color = winnerColors[i - 1];
    const textColor = isCurrent ? '#1a1a1a' : '#fff';
    const style = color ? ` style="border-color:${color};color:${textColor}"` : '';
    if (isCurrent) {
      html += `<span class="${cls}"${style} aria-current="page">Run ${i}</span>`;
    } else {
      html += `<a class="${cls}"${style} href="${escHtml(pathPrefix)}${i}/index.html">Run ${i}</a>`;
    }
  }
  html += '</div>';
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
    if (settings.cpuThrottle && settings.cpuThrottle > 1) items.push(infoItem('CPU Throttle', `${settings.cpuThrottle}x slower`));
    if (settings.format && settings.format !== 'webm') items.push(infoItem('Format', escHtml(settings.format)));
    if (settings.headless) items.push(infoItem('Headless', 'yes'));
    if (settings.runs && settings.runs > 1) items.push(infoItem('Runs', settings.runs));
  }
  if (items.length === 0) return '';
  return `<div class="race-info">${items.join('')}</div>`;
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
  return `<div class="machine-info">${items.join('')}</div>`;
}

export function buildErrorsHtml(errors) {
  if (!errors || errors.length === 0) return '';
  return `<div class="errors"><ul>${errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul></div>`;
}

export function buildResultsHtml(comparisons, racers) {
  let html = '';
  const { rows: resultRows, sectionCount } = buildResultsModel(comparisons, racers);
  const expandSingleSection = sectionCount === 1;
  for (const row of resultRows) {
    const rows = buildMetricRowsHtml(row.ranking, row.winner);
    if (row.isTotal) {
      html += render(T['profile-metric'], {
        metricClass: 'profile-metric-total',
        titleAttr: '',
        name: escHtml(formatSectionTitle(row.name)),
        desc: '',
        rows,
      }) + '\n';
    } else {
      html += buildCollapsibleSectionMetricHtml(formatSectionTitle(row.name), rows, expandSingleSection) + '\n';
    }
  }
  return html;
}

export function buildProfileSummaryHtml(profileComparison, racers) {
  const sectionComparisons = (profileComparison?.sectionComparisons || [])
    .filter(comp => !isSyntheticTotal(comp));

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

  let html = `<details class="section" open>
  <summary><h2>Performance Results</h2></summary>
  <div class="section-body">`;

  if (measuredRows) {
    html += render(T['profile-metric'], { metricClass: 'profile-metric-total', titleAttr: '', name: 'Race', desc: '', rows: measuredRows });
  }
  if (sectionComparisons.length > 0) {
    const openSectionRows = sectionComparisons.length === 1;
    html += sectionComparisons.map(comp => buildCollapsibleSectionMetricHtml(
      formatSectionTitle(comp.name),
      buildMetricRowsHtml(rankComparisonDurations(comp, racers), comp.winner),
      openSectionRows
    )).join('\n');
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

  let html = `<details class="section">
  <summary><h2>Performance Profile</h2></summary>
  <div class="section-body">
  <p class="profile-note">Lower values are better for all metrics. Hover over metric names for details.</p>\n`;

  const scopes = [
    { title: 'Race', desc: 'Metrics captured only between raceStart() and raceEnd() calls \u2014 isolates the code being tested.', section: measured, collapsed: false },
    { title: 'Total Recording (Including Pre and Post race)', desc: 'Metrics for the entire recording window including pre-race setup and post-race teardown.', section: total, collapsed: true },
  ];
  for (const scope of scopes) {
    const showMeasuredSectionMetrics = scope.section === measured && sectionMeasuredComparisons.length > 1;
    if (scope.section.comparisons.length === 0 && !showMeasuredSectionMetrics) continue;

    if (scope.collapsed) {
      html += `<details class="profile-collapsible">\n<summary><h3 class="profile-collapsible-title">${escHtml(scope.title)}</h3></summary>\n`;
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
        const metricDef = PROFILE_METRICS[comp.key];
        const ranking = rankEntries(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }), metricDef.format);
        const desc = metricDef.description || '';
        html += render(T['profile-metric'], {
          metricClass: '',
          titleAttr: desc ? `title="${escHtml(desc)}"` : '',
          name: escHtml(comp.name) + (desc ? ' <span class="profile-info-icon">&#9432;</span>' : ''),
          desc: desc ? `<div class="profile-metric-desc">${escHtml(desc)}</div>` : '',
          rows: buildMetricRowsHtml(ranking, comp.winner),
        }) + '\n';
      }
    }
    if (showMeasuredSectionMetrics) {
      html += `<h4>Per-Section Profile Metrics</h4>\n`;
      for (const section of sectionMeasuredComparisons) {
        let sectionMetricsRows = '';
        for (const comp of section.comparisons) {
          const metricDef = PROFILE_METRICS[comp.key];
          const ranking = rankEntries(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }), metricDef.format);
          sectionMetricsRows += render(T['profile-metric'], {
            metricClass: '',
            titleAttr: '',
            name: escHtml(comp.name),
            desc: '',
            rows: buildMetricRowsHtml(ranking, comp.winner),
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

/** Render a report-model cell as an HTML <td>: trophy for winner, delta for losers. */
function renderHtmlCell(cell, bold) {
  if (cell.value == null) return bold ? '<td><strong>-</strong></td>' : '<td>-</td>';
  let content;
  if (cell.isWinner) {
    content = `${escHtml(cell.formatted)} (\uD83C\uDFC6)`;
  } else if (cell.delta != null) {
    content = `${escHtml(cell.formatted)} <span style="opacity:0.5">(${escHtml(`+${cell.delta}`)})</span>`;
  } else {
    content = escHtml(cell.formatted);
  }
  return bold ? `<td><strong>${content}</strong></td>` : `<td>${content}</td>`;
}

export function buildRunComparisonHtml(summaries, medianSummary, racers) {
  if (!summaries || summaries.length <= 1) return '';
  const model = buildRunComparisonModel(summaries, medianSummary, racers, PROFILE_METRICS);
  if (model.isEmpty) return '';

  const racerColors = racers.map((_, i) => RACER_CSS_COLORS[i % RACER_CSS_COLORS.length]);
  const coloredHeader = racers.map((r, i) => `<th style="color:${racerColors[i]}">${escHtml(r)}</th>`).join('');

  /** Render one table (run rows + median/average rows) from a model entry. */
  const buildTable = ({ runRows, medianRow, averageRow }) => {
    let table = `<table class="run-comparison-table"><thead><tr><th>Run</th>`;
    table += coloredHeader;
    table += `</tr></thead><tbody>`;
    for (const row of runRows) {
      table += `<tr><td>${row.label}</td>`;
      for (const cell of row.cells) table += renderHtmlCell(cell, false);
      table += `</tr>`;
    }
    if (medianRow) {
      table += `<tr class="run-comparison-median"><td><strong>Median</strong></td>`;
      for (const cell of medianRow.cells) table += renderHtmlCell(cell, true);
      table += `</tr>`;
    }
    if (averageRow) {
      table += `<tr class="run-comparison-median"><td><strong>Average</strong></td>`;
      for (const cell of averageRow.cells) table += renderHtmlCell(cell, true);
      table += `</tr>`;
    }
    table += `</tbody></table>`;
    return table;
  };

  let html = `<details class="section">\n  <summary><h2>Run-by-Run Comparison</h2></summary>\n  <div class="section-body">`;

  // --- Measurement comparisons ---
  for (const measurement of model.measurements) {
    html += `<h3>${escHtml(formatSectionTitle(measurement.name))}</h3>\n`;
    html += buildTable(measurement);
  }

  // --- Performance metrics comparisons ---
  for (const scope of model.profileScopes) {
    html += `<h3>Performance: ${escHtml(scope.title)}</h3>\n`;

    for (const metric of scope.metrics) {
      html += `<h4>${escHtml(metric.name)}</h4>\n`;
      html += buildTable(metric);
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

  return `<details class="section">
  <summary><h2>Files</h2></summary>
  <div class="section-body">
    <div class="file-links">
      ${links.join('\n      ')}
    </div>
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
