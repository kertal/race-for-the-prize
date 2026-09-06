/**
 * player-sections.js — Build-time HTML section builders for the race player.
 *
 * Each function returns an HTML string (or '' if nothing to show).
 * HTML structures are defined as <template id="build-*"> elements in player.html;
 * videoplayer.js extracts them at load time and passes them via setTemplates().
 */

import { escHtml, render } from './html-templates.js';
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

/** Render one build-* fragment from player.html by name. */
function fill(id, data = {}) {
  if (!(id in T)) throw new Error(`No <template id="build-${id}"> in player.html`);
  return render(T[id], data);
}

// Both live in html-templates.js now; re-exported for the modules and tests
// that have always imported them from here.
export { escHtml, render };

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
    const delta = entry.delta != null ? fill('profile-delta', { delta: entry.delta }) : '';
    html += fill('profile-row', {
      color,
      name: escHtml(entry.name),
      barPct,
      valueText: escHtml(entry.formatted),
      barLabel: escHtml(`${entry.name}: ${entry.formatted}`),
      value: escHtml(entry.formatted) + delta,
      medal: winner === entry.name ? fill('profile-medal') : '',
    });
  }
  return html;
}

function buildCollapsibleSectionMetricHtml(name, rows, open = false) {
  return fill('section-metric', { openAttr: open ? ' open' : '', name: escHtml(name), rows });
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

  /** The current entry is inert text; every other entry links to its report. */
  const navItem = (isCurrent, cls, style, href, label) =>
    isCurrent
      ? fill('run-nav-current', { cls, style, label })
      : fill('run-nav-link', { cls, style, href, label });

  const isMedianCurrent = currentRun === 'median';
  const medianCls = isMedianCurrent ? 'run-nav-btn active' : 'run-nav-btn';
  let items = navItem(isMedianCurrent, medianCls, '', `${escHtml(pathPrefix)}index.html`, 'Median');

  for (let i = 1; i <= totalRuns; i++) {
    const isCurrent = currentRun === i;
    const cls = isCurrent ? 'run-nav-btn active' : 'run-nav-btn';
    const color = winnerColors[i - 1];
    // The winner's colour rides in on --racer-color; .has-winner tells the
    // stylesheet to use it for the border and brighten the label.
    items += navItem(
      isCurrent,
      color ? `${cls} has-winner` : cls,
      color ? ` style="--racer-color:${color}"` : '',
      `${escHtml(pathPrefix)}${i}/index.html`,
      `Run ${i}`
    );
  }
  return fill('run-nav', { items });
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
  return fill('info-grid', { cls: 'race-info', items: items.join('') });
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
  return fill('info-grid', { cls: 'machine-info', items: items.join('') });
}

export function buildErrorsHtml(errors) {
  if (!errors || errors.length === 0) return '';
  const items = errors.map(e => fill('error-item', { message: escHtml(e) })).join('');
  return fill('errors', { items });
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
        return fill('profile-trophies', {
          color, name: escHtml(name), trophies: '&#127942;'.repeat(count),
        });
      }).join('');
  }

  const measuredWins = profileComparison?.measured?.wins || {};
  const totalWins = profileComparison?.total?.wins || {};
  const measuredRows = buildWinRows(measuredWins);
  const totalRows = buildWinRows(totalWins);

  if (!measuredRows && !totalRows && sectionComparisons.length === 0) return '';

  let body = '';

  if (measuredRows) {
    body += fill('profile-metric', { metricClass: 'profile-metric-total', titleAttr: '', name: 'Race', desc: '', rows: measuredRows });
  }
  if (sectionComparisons.length > 0) {
    const openSectionRows = sectionComparisons.length === 1;
    body += sectionComparisons.map(comp => buildCollapsibleSectionMetricHtml(
      formatSectionTitle(comp.name),
      buildMetricRowsHtml(rankComparisonDurations(comp, racers), comp.winner),
      openSectionRows
    )).join('\n');
  }
  if (totalRows) {
    body += fill('profile-metric', { metricClass: '', titleAttr: '', name: 'Total Recording (Including Pre and Post race)', desc: '', rows: totalRows });
  }

  return fill('section', { openAttr: ' open', title: 'Performance Results', body: body + '\n  ' });
}

export function buildProfileHtml(profileComparison, racers) {
  if (!profileComparison) return '';
  const measured = profileComparison.measured || { comparisons: [], byCategory: {}, overallWinner: null };
  const total = profileComparison.total || { comparisons: [], byCategory: {}, overallWinner: null };
  const sectionMeasuredComparisons = buildSectionMeasuredComparisons(profileComparison.rawProfileMetrics || [], racers);
  if (measured.comparisons.length === 0 && total.comparisons.length === 0 && sectionMeasuredComparisons.length === 0) return '';

  let body = '\n  ' + fill('profile-note');

  const scopes = [
    { title: 'Race', desc: 'Metrics captured only between raceStart() and raceEnd() calls \u2014 isolates the code being tested.', section: measured, collapsed: false },
    { title: 'Total Recording (Including Pre and Post race)', desc: 'Metrics for the entire recording window including pre-race setup and post-race teardown.', section: total, collapsed: true },
  ];
  for (const scope of scopes) {
    const showMeasuredSectionMetrics = scope.section === measured && sectionMeasuredComparisons.length > 1;
    if (scope.section.comparisons.length === 0 && !showMeasuredSectionMetrics) continue;

    body += scope.collapsed
      ? fill('profile-collapsible', { title: escHtml(scope.title) })
      : fill('profile-heading', { title: escHtml(scope.title) });
    body += fill('profile-scope-desc', { desc: escHtml(scope.desc) });
    for (const [category, comps] of Object.entries(scope.section.byCategory)) {
      const catLabel = category[0].toUpperCase() + category.slice(1);
      const catDesc = categoryDescriptions[category] || '';
      body += fill('profile-subheading', {
        titleAttr: catDesc ? ` title="${escHtml(catDesc)}"` : '',
        label: escHtml(catLabel),
      });
      if (catDesc) {
        body += fill('profile-category-desc', { desc: escHtml(catDesc) });
      }
      for (const comp of comps) {
        const metricDef = PROFILE_METRICS[comp.key];
        const ranking = rankEntries(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }), metricDef.format);
        const desc = metricDef.description || '';
        body += fill('profile-metric', {
          metricClass: '',
          titleAttr: desc ? `title="${escHtml(desc)}"` : '',
          name: escHtml(comp.name) + (desc ? fill('profile-info-icon') : ''),
          desc: desc ? fill('profile-metric-desc', { desc: escHtml(desc) }) : '',
          rows: buildMetricRowsHtml(ranking, comp.winner),
        }) + '\n';
      }
    }
    if (showMeasuredSectionMetrics) {
      body += fill('profile-subheading', { titleAttr: '', label: 'Per-Section Profile Metrics' });
      for (const section of sectionMeasuredComparisons) {
        let sectionMetricsRows = '';
        for (const comp of section.comparisons) {
          const metricDef = PROFILE_METRICS[comp.key];
          const ranking = rankEntries(racers, i => ({ val: comp.values[i], formatted: comp.formatted[i] }), metricDef.format);
          sectionMetricsRows += fill('profile-metric', {
            metricClass: '',
            titleAttr: '',
            name: escHtml(comp.name),
            desc: '',
            rows: buildMetricRowsHtml(ranking, comp.winner),
          }) + '\n';
        }
        body += buildCollapsibleSectionMetricHtml(formatSectionTitle(section.name), sectionMetricsRows, false) + '\n';
      }
    }
    if (scope.section.overallWinner === 'tie') {
      body += fill('profile-winner-tie');
    } else if (scope.section.overallWinner) {
      const idx = racers.indexOf(scope.section.overallWinner);
      body += fill('profile-winner', {
        color: RACER_CSS_COLORS[idx % RACER_CSS_COLORS.length],
        name: escHtml(scope.section.overallWinner),
      });
    }
    if (scope.collapsed) {
      body += `</details>\n`;
    }
  }

  return fill('section', { openAttr: '', title: 'Performance Profile', body: body + '\n' });
}

/** Render a report-model cell as an HTML <td>: trophy for winner, delta for losers. */
function renderHtmlCell(cell, bold) {
  const template = bold ? 'comparison-cell-bold' : 'comparison-cell';
  if (cell.value == null) return fill(template, { content: '-' });
  let content;
  if (cell.isWinner) {
    content = `${escHtml(cell.formatted)} (\uD83C\uDFC6)`;
  } else if (cell.delta != null) {
    content = escHtml(cell.formatted) + fill('run-delta', { delta: escHtml(cell.delta) });
  } else {
    content = escHtml(cell.formatted);
  }
  return fill(template, { content });
}

export function buildRunComparisonHtml(summaries, medianSummary, racers) {
  if (!summaries || summaries.length <= 1) return '';
  const model = buildRunComparisonModel(summaries, medianSummary, racers, PROFILE_METRICS);
  if (model.isEmpty) return '';

  const header = racers.map((r, i) => fill('comparison-header-cell', {
    color: RACER_CSS_COLORS[i % RACER_CSS_COLORS.length],
    name: escHtml(r),
  })).join('');

  /** A median/average row: the same shape as a run row, but emphasised. */
  const summaryRow = (label, row) => row
    ? fill('comparison-summary-row', {
        label,
        cells: row.cells.map(cell => renderHtmlCell(cell, true)).join(''),
      })
    : '';

  /** Render one table (run rows + median/average rows) from a model entry. */
  const buildTable = ({ runRows, medianRow, averageRow }, caption) => fill('comparison-table', {
    header,
    caption: escHtml(`${caption} per run, by racer`),
    rows: runRows.map(row => fill('comparison-row', {
      label: row.label,
      cells: row.cells.map(cell => renderHtmlCell(cell, false)).join(''),
    })).join('')
      + summaryRow('Median', medianRow)
      + summaryRow('Average', averageRow),
  });

  let body = '';

  // --- Measurement comparisons ---
  for (const measurement of model.measurements) {
    body += fill('profile-heading', { title: escHtml(formatSectionTitle(measurement.name)) });
    body += buildTable(measurement, formatSectionTitle(measurement.name));
  }

  // --- Performance metrics comparisons ---
  for (const scope of model.profileScopes) {
    body += fill('profile-heading', { title: `Performance: ${escHtml(scope.title)}` });

    for (const metric of scope.metrics) {
      body += fill('profile-subheading', { titleAttr: '', label: escHtml(metric.name) });
      body += buildTable(metric, `${metric.name} (${scope.title})`);
    }
  }

  return fill('section', { openAttr: '', title: 'Run-by-Run Comparison', body: body + '\n  ' });
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

  return fill('section', {
    openAttr: '',
    title: 'Files',
    body: '\n' + fill('file-links', { links: links.join('\n      ') }) + '\n  ',
  });
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
