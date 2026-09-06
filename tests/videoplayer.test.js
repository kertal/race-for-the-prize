import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildRunNavHtml, buildResultsHtml, buildProfileHtml, RACER_CSS_COLORS } from '../cli/player-sections.js';
import { buildProfileComparison } from '../cli/profile-analysis.js';
import { copyFFmpegFiles } from '../cli/results.js';
import { fileURLToPath } from 'node:url';

const makeSummary = (overrides = {}) => ({
  racers: ['lauda', 'hunt'],
  comparisons: [
    { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', diff: 1, diffPercent: 100, rankings: ['lauda', 'hunt'] },
  ],
  overallWinner: 'lauda',
  timestamp: '2025-01-15T12:00:00.000Z',
  settings: {},
  errors: [],
  wins: { lauda: 1, hunt: 0 },
  videos: {},
  ...overrides,
});

const huntWinsSummary = () => makeSummary({
  overallWinner: 'hunt',
  comparisons: [
    { name: 'Load', racers: [{ duration: 2 }, { duration: 1 }], winner: 'hunt', rankings: ['hunt', 'lauda'] },
  ],
});

const videoFiles = ['lauda/lauda.race.webm', 'hunt/hunt.race.webm'];
const abVideoFiles = ['a/a.race.webm', 'b/b.race.webm'];
const abSummary = (overrides = {}) => makeSummary({ racers: ['a', 'b'], comparisons: [], ...overrides });

// Shared helpers — reduce repeated buildPlayerHtml boilerplate
const withSummary = (overrides) => buildPlayerHtml(makeSummary(overrides), videoFiles);
const withOptions = (opts, summary) => buildPlayerHtml(summary || makeSummary(), videoFiles, null, null, opts);
const defaultHtml = withSummary();
const noVideosHtml = buildPlayerHtml(makeSummary(), []);

// Extract and parse the embedded #race-config JSON block from generated HTML.
const getRaceConfig = (html) => {
  const m = html.match(/<script id="race-config" type="application\/json">([\s\S]*?)<\/script>/);
  return m && m[1] ? JSON.parse(m[1]) : null;
};
const loadRenderComparisons = [
  { name: 'Load', racers: [{ duration: 1.1 }, { duration: 1.4 }], winner: 'lauda', rankings: ['lauda', 'hunt'] },
  { name: 'Render', racers: [{ duration: 0.9 }, { duration: 1.2 }], winner: 'lauda', rankings: ['lauda', 'hunt'] },
];

function getProfileSection(html) {
  const profileStart = html.indexOf('Performance Profile');
  expect(profileStart).toBeGreaterThan(-1);
  return html.slice(profileStart);
}

function buildPerSectionMetricFixtures({ includeRender = true, includeMeasuredTotals = true } = {}) {
  const measuredA = includeMeasuredTotals ? { networkTransferSize: 2000, scriptDuration: 40 } : {};
  const measuredB = includeMeasuredTotals ? { networkTransferSize: 2500, scriptDuration: 55 } : {};
  const measuredSectionsA = {
    Load: { networkTransferSize: 1200, networkRequestCount: 4, scriptDuration: 25, layoutDuration: 5, recalcStyleDuration: 2, taskDuration: 35 },
  };
  const measuredSectionsB = {
    Load: { networkTransferSize: 1400, networkRequestCount: 5, scriptDuration: 30, layoutDuration: 6, recalcStyleDuration: 3, taskDuration: 40 },
  };
  if (includeRender) {
    measuredSectionsA.Render = { networkTransferSize: 800, networkRequestCount: 2, scriptDuration: 10, layoutDuration: 3, recalcStyleDuration: 1, taskDuration: 15 };
    measuredSectionsB.Render = { networkTransferSize: 900, networkRequestCount: 3, scriptDuration: 12, layoutDuration: 4, recalcStyleDuration: 2, taskDuration: 18 };
  }
  return [
    { total: {}, measured: measuredA, measuredSections: measuredSectionsA },
    { total: {}, measured: measuredB, measuredSections: measuredSectionsB },
  ];
}

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-test-'));
  try { fn(tmpDir); } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

describe('buildPlayerHtml', () => {
  it('returns a complete HTML document', () => {
    expect(defaultHtml).toContain('<!DOCTYPE html>');
    expect(defaultHtml).toContain('</html>');
  });

  it('inlines CSS from player.css with layoutCss appended', () => {
    expect(defaultHtml).toContain('<style>');
    expect(defaultHtml).toContain('</style>');
    // Known selectors from player.css
    expect(defaultHtml).toContain('.checkered-bar');
    expect(defaultHtml).toContain('.player-container');
    // Dynamic layoutCss rules injected at build time (2 racers → 1400px / 680px)
    expect(defaultHtml).toContain('max-width: 1400px');
    expect(defaultHtml).toContain('max-width: 680px');
  });

  it('embeds racer names and video sources', () => {
    expect(defaultHtml).toContain('lauda');
    expect(defaultHtml).toContain('hunt');
    expect(defaultHtml).toContain('src="lauda/lauda.race.webm"');
    expect(defaultHtml).toContain('src="hunt/hunt.race.webm"');
  });

  it('includes results with measurement data and deltas', () => {
    expect(defaultHtml).toContain('Race Section Load');
    expect(defaultHtml).toContain('1.000s');
    expect(defaultHtml).toContain('2.000s');
    expect(defaultHtml).toContain('(+1.000s)');
    expect(defaultHtml).toContain('profile-bar-fill');
  });

  it('includes section metrics in Performance Results', () => {
    expect(defaultHtml).toContain('Performance Results');
    expect(defaultHtml).toContain('Race Section Load');
  });

  it('orders Performance Results as Race, sections, then Total Recording', () => {
    const metrics1 = { total: { networkTransferSize: 1000, scriptDuration: 100 }, measured: { networkTransferSize: 500 } };
    const metrics2 = { total: { networkTransferSize: 2000, scriptDuration: 200 }, measured: { networkTransferSize: 800 } };
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({ profileComparison });
    const summaryStart = html.indexOf('Performance Results');
    const profileSummary = summaryStart >= 0 ? html.slice(summaryStart) : html;
    const raceIdx = profileSummary.indexOf('>Race<');
    const sectionIdx = profileSummary.indexOf('Race Section Load');
    const totalRecordingIdx = profileSummary.indexOf('Total Recording (Including Pre and Post race)');
    expect(raceIdx).toBeGreaterThan(-1);
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(totalRecordingIdx).toBeGreaterThan(-1);
    expect(raceIdx).toBeLessThan(sectionIdx);
    expect(sectionIdx).toBeLessThan(totalRecordingIdx);
  });

  it('renders Race before section metrics when present', () => {
    const html = withSummary({
      comparisons: [
        { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', diff: 1, diffPercent: 100, rankings: ['lauda', 'hunt'] },
        { name: 'Race', racers: [{ duration: 3 }, { duration: 4 }], winner: 'lauda', diff: 1, diffPercent: 33.3, rankings: ['lauda', 'hunt'], isSyntheticTotal: true },
      ],
    });
    expect(html).toContain('profile-metric-total');
    expect(html).toContain('section-metric');
    const raceIdx = html.indexOf('>Race<');
    const sectionIdx = html.indexOf('Race Section Load');
    expect(raceIdx).toBeGreaterThan(-1);
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(raceIdx).toBeLessThan(sectionIdx);
  });

  it('keeps a real Race section separate from the synthetic fallback total in HTML', () => {
    const html = buildResultsHtml([
      { name: 'Race', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', rankings: ['lauda', 'hunt'] },
      { name: 'Load', racers: [{ duration: 2 }, { duration: 3 }], winner: 'lauda', rankings: ['lauda', 'hunt'] },
      { name: 'Race (All Sections)', racers: [{ duration: 3 }, { duration: 5 }], winner: 'lauda', rankings: ['lauda', 'hunt'], isSyntheticTotal: true },
    ], ['lauda', 'hunt']);

    expect(html.match(/profile-metric-total/g) ?? []).toHaveLength(1);
    expect(html).toContain('<summary><span class="profile-metric-name">Race</span></summary>');
    expect(html.indexOf('Race (All Sections)')).toBeLessThan(html.indexOf('<summary><span class="profile-metric-name">Race</span></summary>'));
  });

  it('prefixes section names that start with Race but are not totals', () => {
    const html = withSummary({
      comparisons: [
        { name: 'Race Setup', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', rankings: ['lauda', 'hunt'] },
      ],
    });

    expect(html).toContain('Race Section Race Setup');
  });

  it('expands single section rows by default', () => {
    const html = withSummary({
      comparisons: [
        { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', diff: 1, diffPercent: 100, rankings: ['lauda', 'hunt'] },
      ],
    });
    expect(html).toContain('<details class="profile-metric section-metric" open>');
    expect(html).toContain('<summary><span class="profile-metric-name">Race Section Load</span></summary>');
  });

  it('keeps multi-section rows collapsed by default', () => {
    const html = withSummary({
      comparisons: [
        { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', diff: 1, diffPercent: 100, rankings: ['lauda', 'hunt'] },
        { name: 'Render', racers: [{ duration: 1.5 }, { duration: 2.5 }], winner: 'lauda', diff: 1, diffPercent: 66.6, rankings: ['lauda', 'hunt'] },
      ],
    });
    expect(html).toContain('<details class="profile-metric section-metric">\n  <summary><span class="profile-metric-name">Race Section Load</span></summary>');
    expect(html).toContain('<details class="profile-metric section-metric">\n  <summary><span class="profile-metric-name">Race Section Render</span></summary>');
  });

  it('shows winner trophy on racer label', () => {
    expect(defaultHtml).toContain('&#127942;');
  });

  it('shows tie trophy on racer labels when tied', () => {
    expect(withSummary({ overallWinner: 'tie' })).toContain('&#129309;');
  });

  it('includes playback controls', () => {
    expect(defaultHtml).toContain('id="playBtn"');
    expect(defaultHtml).toContain('id="scrubber"');
    expect(defaultHtml).toContain('id="speedSelect"');
  });

  it('includes frame navigation and keyboard shortcuts', () => {
    expect(defaultHtml).toContain('id="prevFrame"');
    expect(defaultHtml).toContain('id="nextFrame"');
    expect(defaultHtml).toContain('ArrowLeft');
    expect(defaultHtml).toContain('ArrowRight');
    expect(defaultHtml).toContain('stepFrame');
  });

  it('includes files section with video links', () => {
    expect(defaultHtml).toContain('Files');
    expect(defaultHtml).toContain('href="lauda/lauda.race.webm"');
    expect(defaultHtml).toContain('href="hunt/hunt.race.webm"');
    expect(defaultHtml).toContain('lauda (race)');
    expect(defaultHtml).toContain('hunt (race)');
  });

  it('includes alt format download links in files section', () => {
    const altFiles = ['lauda/lauda.race.gif', 'hunt/hunt.race.gif'];
    const html = buildPlayerHtml(makeSummary(), videoFiles, 'gif', altFiles);
    expect(html).toContain('lauda (.gif)');
    expect(html).toContain('hunt (.gif)');
    expect(html).toContain('href="lauda/lauda.race.gif"');
  });

  it('handles empty comparisons', () => {
    const html = withSummary({ comparisons: [] });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Results');
  });

  it('supports 3 racers', () => {
    const summary = makeSummary({
      racers: ['alpha', 'beta', 'gamma'],
      comparisons: [
        { name: 'Load', racers: [{ duration: 1 }, { duration: 1.5 }, { duration: 2 }], winner: 'alpha', diff: 1, diffPercent: 100 },
      ],
      overallWinner: 'alpha',
    });
    const videos = ['alpha/alpha.race.webm', 'beta/beta.race.webm', 'gamma/gamma.race.webm'];
    const html = buildPlayerHtml(summary, videos);
    for (const name of ['alpha', 'beta', 'gamma']) {
      expect(html).toContain(`src="${name}/${name}.race.webm"`);
      expect(html).toContain(`>${name}<`);
    }
    expect(getRaceConfig(html).videoCount).toBe(3);
  });

  it('supports 4 racers', () => {
    const summary = makeSummary({ racers: ['a', 'b', 'c', 'd'], comparisons: [], overallWinner: null });
    const videos = ['a/a.race.webm', 'b/b.race.webm', 'c/c.race.webm', 'd/d.race.webm'];
    const html = buildPlayerHtml(summary, videos);
    for (let i = 0; i < 4; i++) expect(html).toContain(`id="v${i}"`);
    expect(getRaceConfig(html).videoCount).toBe(4);
  });

  it('supports 5 racers with download links', () => {
    const summary = makeSummary({ racers: ['r1', 'r2', 'r3', 'r4', 'r5'], comparisons: [], overallWinner: 'r1' });
    const videos = ['r1/r1.webm', 'r2/r2.webm', 'r3/r3.webm', 'r4/r4.webm', 'r5/r5.webm'];
    const altFiles = ['r1/r1.gif', 'r2/r2.gif', 'r3/r3.gif', 'r4/r4.gif', 'r5/r5.gif'];
    const html = buildPlayerHtml(summary, videos, 'gif', altFiles);
    expect(html).toContain('id="v4"');
    expect(html).toContain('r1 (.gif)');
    expect(html).toContain('r5 (.gif)');
    expect(getRaceConfig(html).videoCount).toBe(5);
  });

  it('assigns correct colors to racer labels via the --racer-color token', () => {
    const summary = makeSummary({ racers: ['red', 'blue', 'green'], comparisons: [], overallWinner: null });
    const html = buildPlayerHtml(summary, ['r/r.webm', 'b/b.webm', 'g/g.webm']);
    expect(html).toContain('style="--racer-color: #e74c3c"');
    expect(html).toContain('style="--racer-color: #3498db"');
    expect(html).toContain('style="--racer-color: #27ae60"');
  });

  it('displays time and step counters', () => {
    expect(defaultHtml).toContain('0:00.000 / 0:00.000');
    expect(defaultHtml).toContain('id="timeDisplay"');
    expect(defaultHtml).toContain('0.0s');
    expect(defaultHtml).toContain('id="frameDisplay"');
    expect(defaultHtml).toContain('getTime');
  });

  it('embeds full video paths when full videos provided', () => {
    const fullVideos = ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'];
    const html = withOptions({ fullVideoFiles: fullVideos });
    expect(html).not.toContain('id="modeRace"');
    expect(html).not.toContain('id="modeFull"');
    expect(html).toContain('"lauda/lauda.full.webm"');
    expect(html).toContain('"hunt/hunt.full.webm"');
  });

  it('shows merged video button when merged video provided', () => {
    const html = withOptions({ mergedVideoFile: 'lauda-vs-hunt.webm' });
    expect(html).toContain('id="modeMerged"');
    expect(html).toContain('id="mergedVideo"');
    expect(html).toContain('src="lauda-vs-hunt.webm"');
    expect(html).toContain('switchToMerged');
  });

  it('shows merged button when both full and merged provided', () => {
    const fullVideos = ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'];
    const html = withOptions({ fullVideoFiles: fullVideos, mergedVideoFile: 'merged.webm' });
    expect(html).not.toContain('id="modeRace"');
    expect(html).not.toContain('id="modeFull"');
    expect(html).toContain('id="modeMerged"');
  });

  it('hides mode toggle when no additional videos', () => {
    expect(defaultHtml).not.toContain('id="modeFull"');
    expect(defaultHtml).not.toContain('id="modeMerged"');
  });

  it('omits profile section when no profileComparison', () => {
    expect(defaultHtml).not.toContain('Performance Profile');
  });

  it('includes profile section when profileComparison provided', () => {
    const metrics1 = { total: { networkTransferSize: 1000, scriptDuration: 100 }, measured: { networkTransferSize: 500 } };
    const metrics2 = { total: { networkTransferSize: 2000, scriptDuration: 200 }, measured: { networkTransferSize: 800 } };
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({ profileComparison });
    expect(html).toContain('Performance Profile');
    expect(html).toContain('Lower values are better');
    expect(html).toContain('Race');
    expect(html).toContain('<details');
    expect(html).toContain('Total Recording (Including Pre and Post race)');
  });

  it('shows profile racers sorted by value with deltas', () => {
    const metrics1 = { total: {}, measured: { networkTransferSize: 2000 } };
    const metrics2 = { total: {}, measured: { networkTransferSize: 1000 } };
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({ profileComparison });
    const profileSection = getProfileSection(html);
    expect(profileSection.indexOf('>hunt<')).toBeLessThan(profileSection.indexOf('>lauda<'));
    expect(profileSection).toContain('(+');
  });

  it('does not render section timing metrics inside Race profile scope', () => {
    const metrics1 = { total: {}, measured: { networkTransferSize: 2000 } };
    const metrics2 = { total: {}, measured: { networkTransferSize: 1000 } };
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({
      comparisons: loadRenderComparisons,
      profileComparison,
    });
    const profileSection = getProfileSection(html);
    expect(profileSection).not.toContain('Section Timings');
  });

  it('hides per-section measured profile metrics when only one section exists', () => {
    const [metrics1, metrics2] = buildPerSectionMetricFixtures({ includeRender: false, includeMeasuredTotals: true });
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({
      comparisons: [
        { name: 'Load', racers: [{ duration: 1.1 }, { duration: 1.4 }], winner: 'lauda', rankings: ['lauda', 'hunt'] },
      ],
      profileComparison,
      profileMetrics: [metrics1, metrics2],
    });
    const profileSection = getProfileSection(html);
    expect(profileSection).not.toContain('Per-Section Profile Metrics');
  });

  it('shows per-section measured profile metrics when multiple sections exist', () => {
    const [metrics1, metrics2] = buildPerSectionMetricFixtures({ includeRender: true, includeMeasuredTotals: true });
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({
      comparisons: loadRenderComparisons,
      profileComparison,
      profileMetrics: [metrics1, metrics2],
    });
    const profileSection = getProfileSection(html);
    expect(profileSection).toContain('Per-Section Profile Metrics');
    expect(profileSection).toContain('Race Section Load');
    expect(profileSection).toContain('Race Section Render');
    expect(profileSection.indexOf('Per-Section Profile Metrics')).toBeGreaterThan(profileSection.indexOf('Computation'));
  });

  it('renders profile when only per-section measured metrics are available', () => {
    const [metrics1, metrics2] = buildPerSectionMetricFixtures({ includeRender: true, includeMeasuredTotals: false });
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({
      comparisons: loadRenderComparisons,
      profileComparison,
      profileMetrics: [metrics1, metrics2],
    });
    expect(html).toContain('Performance Profile');
    const profileSection = getProfileSection(html);
    expect(profileSection).toContain('Per-Section Profile Metrics');
    expect(profileSection).toContain('Race Section Load');
    expect(profileSection).toContain('Race Section Render');
  });

  it('applies profile significance thresholds to per-section metric winners', () => {
    const metrics1 = {
      total: {},
      measured: {},
      measuredSections: {
        Load: { scriptDuration: 100 },
        Render: { scriptDuration: 80 },
      },
    };
    const metrics2 = {
      total: {},
      measured: {},
      measuredSections: {
        Load: { scriptDuration: 102 },
        Render: { scriptDuration: 120 },
      },
    };
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = buildProfileHtml({
      ...profileComparison,
      rawProfileMetrics: [metrics1, metrics2],
    }, ['lauda', 'hunt']);

    const loadSection = html.slice(
      html.indexOf('Race Section Load'),
      html.indexOf('Race Section Render')
    );
    expect(loadSection).not.toContain('profile-medal');
  });

  it('shows profile with 3+ racers', () => {
    const data = [
      { total: { networkTransferSize: 3000 }, measured: {} },
      { total: { networkTransferSize: 1000 }, measured: {} },
      { total: { networkTransferSize: 2000 }, measured: {} },
    ];
    const racers = ['angular', 'htmx', 'react'];
    const profileComparison = buildProfileComparison(racers, data);
    const html = buildPlayerHtml(makeSummary({ racers, comparisons: [], overallWinner: null, profileComparison }), ['a/a.webm', 'h/h.webm', 'r/r.webm']);
    for (const name of racers) expect(html).toContain(name);
    expect(html).toContain('profile-bar-fill');
  });

  it('keeps each racer on their own colour wherever they finished', () => {
    const html = buildPlayerHtml(huntWinsSummary(), videoFiles);
    const huntCard = html.match(/--racer-color: (#[0-9a-f]+)">\s*<div class="racer-label">(?:(?!<\/div>).)*hunt/s);
    expect(huntCard[1]).toBe('#3498db');
  });

  it('omits script tag when no videos provided', () => {
    const html = buildPlayerHtml(makeSummary(), [], null, null, {
      runNavigation: { currentRun: 'median', totalRuns: 3, pathPrefix: '' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('Results');
  });

  it('inline runtime script contains no premature </script> that would truncate it', () => {
    // A literal </script> anywhere in the runtime source (even in a comment)
    // ends the inline <script> early, breaking the whole player.
    const html = withOptions({
      clipTimes: [
        { start: 1, end: 3, measurements: [{ name: 'Load', startTime: 1, endTime: 2 }] },
        { start: 1, end: 3, measurements: [] },
      ],
    });
    const open = html.indexOf('<script>\n(function() {');
    const close = html.indexOf('})();\n</script>', open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const body = html.slice(open + '<script>'.length, close);
    expect(body).not.toContain('</script');
  });

  it('shows median page with videos', () => {
    const html = buildPlayerHtml(makeSummary(), ['2/lauda/lauda.race.webm', '2/hunt/hunt.race.webm'], null, null, {
      runNavigation: { currentRun: 'median', totalRuns: 3, pathPrefix: '' },
    });
    expect(html).toContain('<script>');
    expect(html).toContain('src="2/lauda/lauda.race.webm"');
    expect(html).not.toContain('closest to median');
  });

  it('shows run navigation bar', () => {
    const html = withOptions({ runNavigation: { currentRun: 1, totalRuns: 3, pathPrefix: '../' } });
    for (let i = 1; i <= 3; i++) expect(html).toContain(`Run ${i}`);
    expect(html).toContain('Median');
    expect(html).toContain('run-nav-btn active');
  });
});

// --- Race Info section ---

describe('buildPlayerHtml race info', () => {
  it('shows racer names in race info', () => {
    const html = buildPlayerHtml(makeSummary({ racers: ['alpha', 'beta'], comparisons: [], timestamp: '2025-06-01T10:00:00.000Z' }), abVideoFiles);
    expect(html).toContain('race-info');
    expect(html).toContain('Racer 1');
    expect(html).toContain('alpha');
    expect(html).toContain('Racer 2');
    expect(html).toContain('beta');
  });

  it('shows mode, network, and CPU settings', () => {
    const html = buildPlayerHtml(abSummary({ settings: { parallel: false, network: 'slow-3g', cpuThrottle: 4 } }), abVideoFiles);
    expect(html).toContain('sequential');
    expect(html).toContain('slow-3g');
    expect(html).toContain('4x slower');
  });

  it('defaults mode to parallel', () => {
    expect(buildPlayerHtml(abSummary(), abVideoFiles)).toContain('parallel');
  });
});

// --- Machine Info section ---

describe('buildPlayerHtml machine info', () => {
  const machineInfo = {
    platform: 'linux',
    arch: 'x64',
    osRelease: '5.15.0',
    cpuModel: 'Intel Core i7-12700K',
    cpuCores: 12,
    totalMemoryMB: 32768,
    nodeVersion: 'v20.11.0',
  };

  it('shows machine info table when provided', () => {
    const html = buildPlayerHtml(abSummary({ machineInfo }), abVideoFiles);
    expect(html).toContain('machine-info');
    expect(html).toContain('Linux');
    expect(html).toContain('5.15.0');
    expect(html).toContain('x64');
    expect(html).toContain('Intel Core i7-12700K');
    expect(html).toContain('12 cores');
    expect(html).toContain('32.0 GB');
    expect(html).toContain('v20.11.0');
  });

  it('omits machine info section when not provided', () => {
    expect(buildPlayerHtml(abSummary(), abVideoFiles)).not.toContain('<div class="machine-info">');
  });

  it('HTML-escapes values', () => {
    const html = buildPlayerHtml(abSummary({
      machineInfo: { ...machineInfo, cpuModel: '<script>alert("xss")</script>' },
    }), abVideoFiles);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

// --- Errors section ---

describe('buildPlayerHtml errors', () => {
  it('shows errors when present', () => {
    const html = buildPlayerHtml(abSummary({ errors: ['a: timeout', 'b: crash'] }), abVideoFiles);
    expect(html).toContain('errors');
    expect(html).toContain('a: timeout');
    expect(html).toContain('b: crash');
  });

  it('omits errors section when no errors', () => {
    expect(buildPlayerHtml(abSummary(), abVideoFiles)).not.toContain('class="errors"');
  });
});

// --- Gemini commentary in notes ---

describe('buildPlayerHtml gemini commentary', () => {
  it('renders commentary into notes textarea when present', () => {
    const html = withSummary({ geminiCommentary: 'What a thrilling race!' });
    expect(html).toContain('What a thrilling race!');
    expect(html).toMatch(/<details class="section" open>/);
  });

  it('leaves notes empty and collapsed when no commentary', () => {
    const html = withSummary({});
    expect(html).toMatch(/<details class="section" >/);
    expect(html).toContain('placeholder="Add notes about this race..."');
  });
});


// --- Run nav winner colors ---

describe('buildRunNavHtml winner colors', () => {
  const racers = ['lauda', 'hunt'];
  const makeRunSummaries = (winners) => winners.map(w => ({ overallWinner: w }));

  it('tints run buttons with the winner colour token', () => {
    const nav = { currentRun: 'median', totalRuns: 2, pathPrefix: '' };
    const html = buildRunNavHtml(nav, racers, makeRunSummaries(['lauda', 'hunt']));
    expect(html).toContain(`--racer-color:${RACER_CSS_COLORS[0]}`);
    expect(html).toContain(`--racer-color:${RACER_CSS_COLORS[1]}`);
    // .has-winner is what tells the stylesheet to use the token
    expect(html.match(/has-winner/g)).toHaveLength(2);
  });

  it('marks the active run button so the stylesheet can invert it', () => {
    const nav = { currentRun: 1, totalRuns: 2, pathPrefix: '../' };
    const html = buildRunNavHtml(nav, racers, makeRunSummaries(['lauda', 'hunt']));
    expect(html).toMatch(/class="run-nav-btn active has-winner"[^>]*>Run 1</);
    expect(html).toMatch(/class="run-nav-btn has-winner"[^>]*>Run 2</);
  });

  it('does not add style for ties', () => {
    const nav = { currentRun: 'median', totalRuns: 2, pathPrefix: '' };
    const html = buildRunNavHtml(nav, racers, makeRunSummaries(['tie', 'lauda']));
    expect(html).toMatch(/<a(?![^>]*style)[^>]*>Run 1<\/a>/);  // no style attr on tie
    expect(html).toContain(`--racer-color:${RACER_CSS_COLORS[0]}`);  // lauda wins run 2
  });

  it('works without runSummaries', () => {
    const nav = { currentRun: 1, totalRuns: 2, pathPrefix: '../' };
    const html = buildRunNavHtml(nav, racers, null);
    expect(html).toContain('Run 1');
    expect(html).not.toContain('border-color');
  });
});

// --- Clip times (default mode, without --ffmpeg) ---

describe('buildPlayerHtml clipTimes', () => {
  const withClips = (clips, opts = {}) => withOptions({ clipTimes: clips, ...opts }, opts.summary);
  const defaultClips = () => [
    { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
    { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
  ];

  it('does not show Race/Full mode buttons when clipTimes provided', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.5, end: 3 }]);
    expect(html).not.toContain('id="modeRace"');
    expect(html).not.toContain('id="modeFull"');
  });

  it('embeds clipTimes data in race config', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const cfg = getRaceConfig(html);
    expect(cfg.clipTimes).toBeTruthy();
    expect(cfg.clipTimes[0]).toHaveProperty('start');
    expect(cfg.clipTimes[0]).toHaveProperty('end');
  });

  it('sets clipTimes to null when not provided', () => {
    expect(getRaceConfig(defaultHtml).clipTimes).toBe(null);
  });

  it('handles clipTimes with null entries', () => {
    const html = withClips([{ start: 1, end: 2 }, null]);
    expect(html).not.toContain('id="modeFull"');
    expect(getRaceConfig(html).clipTimes).toBeTruthy();
  });

  it('hides Full button when all clipTimes entries are null', () => {
    expect(withClips([null, null])).not.toContain('id="modeFull"');
  });

  it('includes clip constraint logic in player script', () => {
    const html = withClips([{ start: 1, end: 5 }, { start: 1, end: 5 }]);
    expect(html).toContain('activeClip');
    expect(html).toContain('clipOffset');
    expect(html).toContain('clipDuration');
    expect(html).toContain('resolveClip');
  });

  it('keeps clipTimes in racer order, winner or not', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 0.5, end: 2.5 }], { summary: huntWinsSummary() });
    const parsed = getRaceConfig(html).clipTimes;
    expect(parsed).toBeTruthy();
    expect(parsed[0].start).toBe(1); // lauda is racer 1, though hunt won
    expect(parsed[1].start).toBe(0.5);
  });

  it('does not show Merged button without mergedVideoFile', () => {
    expect(withClips([{ start: 1, end: 3 }, { start: 1, end: 3 }])).not.toContain('id="modeMerged"');
  });

  it('embeds recordingOffset and wallClockDuration in clipTimes JSON', () => {
    const clips = [
      { start: 1.5, end: 3, recordingOffset: 0.12, wallClockDuration: 5.0 },
      { start: 1.2, end: 2.8, recordingOffset: 0.15, wallClockDuration: 4.8 },
    ];
    const html = withClips(clips);
    const parsed = getRaceConfig(html).clipTimes;
    expect(parsed).toBeTruthy();
    expect(parsed[0].recordingOffset).toBe(0.12);
    expect(parsed[0].wallClockDuration).toBe(5.0);
    expect(parsed[1].recordingOffset).toBe(0.15);
    expect(parsed[1].wallClockDuration).toBe(4.8);
  });

  it('includes trace-based conversion logic in onMeta', () => {
    const html = withClips(defaultClips());
    expect(html).toContain('_converted');
    expect(html).toContain('tracePtsStart');
    expect(html).toContain('hasTraceCalibration(ct)');
  });

  it('does not include canvas-based calibration fallback code (localStorage is present for notes only)', () => {
    const html = withClips(defaultClips());
    expect(html).not.toContain('detectGreenCuePts');
    expect(html).not.toContain('calibrateFromCanvas');
    expect(html).not.toContain('isGreenCue');
    expect(html).not.toContain('restoreFromCache');
    // localStorage is now used for notes persistence (not calibration cache)
    expect(html).not.toContain('calibrationCache');
    expect(html).toContain('race-notes:');
  });

  it('gracefully falls back when trace metadata is missing', () => {
    const html = withClips(defaultClips());
    // Should use raw clip times without fatal error
    expect(html).toContain('_converted = true');
    expect(html).not.toContain('failCalibration');
  });

  it('embeds trace calibration and uses trace-based conversion when present', () => {
    const clips = [
      {
        start: 1,
        end: 3,
        recordingOffset: 0.1,
        wallClockDuration: 5,
        calibratedStart: null,
        traceCalibration: { firstFrameTs: 1_000_000, lastFrameTs: 2_000_000, recordingStartTs: 1_100_000, recordingEndTs: 1_900_000 },
        measurements: [{ name: 'Load', startTime: 1.2, endTime: 2.1, startTraceTs: 1_200_000, endTraceTs: 1_600_000 }],
      },
      {
        start: 1,
        end: 3,
        recordingOffset: 0.1,
        wallClockDuration: 5,
        calibratedStart: null,
        traceCalibration: { firstFrameTs: 1_000_000, lastFrameTs: 2_000_000, recordingStartTs: 1_100_000, recordingEndTs: 1_900_000 },
        measurements: [{ name: 'Load', startTime: 1.3, endTime: 2.2, startTraceTs: 1_250_000, endTraceTs: 1_650_000 }],
      },
    ];
    const html = withClips(clips);
    expect(html).toContain('"traceCalibration"');
    expect(html).toContain('hasTraceCalibration(ct)');
    expect(html).toContain('traceTsToClipPts');
    expect(html).toContain('traceCalibration.firstFrameTs');
  });

  it('does not include blob/canvas fallback helpers', () => {
    const html = withClips(defaultClips());
    expect(html).not.toContain('toBlobVideo');
    expect(html).not.toContain('detectGreenCuePts');
    expect(html).not.toContain('getImageData(0, 0, CUE_DETECT_SIZE, CUE_DETECT_SIZE)');
  });
});

// --- Files section ---

describe('buildPlayerHtml files section', () => {
  const abHtml = (opts) => buildPlayerHtml(abSummary(), abVideoFiles, null, null, opts);

  it('includes race video links', () => {
    const html = abHtml();
    expect(html).toContain('Files');
    expect(html).toContain('href="a/a.race.webm"');
    expect(html).toContain('a (race)');
  });

  it('includes full video links', () => {
    const html = abHtml({ fullVideoFiles: ['a/a.full.webm', 'b/b.full.webm'] });
    expect(html).toContain('href="a/a.full.webm"');
    expect(html).toContain('a (full)');
  });

  it('includes side-by-side link', () => {
    const html = abHtml({ mergedVideoFile: 'a-vs-b.webm' });
    expect(html).toContain('href="a-vs-b.webm"');
    expect(html).toContain('side-by-side');
  });

  it('includes profile trace links when provided', () => {
    const html = abHtml({ traceFiles: ['a/a.trace.json', 'b/b.trace.json'] });
    expect(html).toContain('href="a/a.trace.json"');
    expect(html).toContain('a (profile)');
    expect(html).toContain('chrome://tracing');
  });

  it('omits trace links when not profiling', () => {
    expect(abHtml()).not.toContain('.trace.json');
  });

  it('includes HAR download links when provided', () => {
    const html = abHtml({ harFiles: ['a/a.har', 'b/b.har'] });
    expect(html).toContain('href="a/a.har"');
    expect(html).toContain('a (HAR)');
    expect(html).toContain('download');
  });

  it('omits HAR links when not provided', () => {
    expect(abHtml()).not.toContain('.har');
  });

  it('omits HAR links for racers without HAR files', () => {
    const html = abHtml({ harFiles: ['a/a.har', null] });
    expect(html).toContain('href="a/a.har"');
    expect(html).not.toContain('b (HAR)');
  });
});

// --- Debug mode ---

describe('buildPlayerHtml debug mode', () => {
  const clipTimes = [{ start: 1.52, end: 3 }, { start: 1.2, end: 2.8 }];
  const debugHtml = withOptions({ clipTimes });

  it('shows Calibration button when clipTimes provided', () => {
    expect(debugHtml).toContain('id="modeDebug"');
    expect(debugHtml).toContain('>Calibration<');
  });

  it('calibration button is always in template, hidden by default', () => {
    // Button is in the player template with display:none; runtime shows it when clip times exist
    expect(defaultHtml).toContain('id="modeDebug"');
    expect(defaultHtml).toContain('style="display:none"');
  });

  it('renders debug panel with per-racer rows', () => {
    expect(debugHtml).toContain('id="debugPanel"');
    expect(debugHtml).toContain('Calibration');
    expect(debugHtml).toContain('data-debug-idx="0"');
    expect(debugHtml).toContain('data-debug-idx="1"');
  });

  it('debug panel has frame adjustment buttons', () => {
    for (const delta of ['-5', '-1', '1', '5']) {
      expect(debugHtml).toContain(`data-delta="${delta}"`);
    }
  });

  it('debug panel has action buttons and frame step info', () => {
    expect(debugHtml).toContain('id="debugCopyJson"');
    expect(debugHtml).toContain('Copy JSON');
    expect(debugHtml).toContain('id="debugResetAll"');
    expect(debugHtml).toContain('Reset All');
    expect(debugHtml).toContain('0.040s (assuming 25fps recording)');
  });

  it('script includes debug functions', () => {
    for (const fn of ['FRAME_STEP', 'toggleCalibration', 'adjustDebugOffset', 'debugOffsets', 'getAdjustedClipTimes', 'resolveAdjustedClip']) {
      expect(debugHtml).toContain(fn);
    }
  });

  it('debug panel contains stats with VIDEO INFO header', () => {
    expect(debugHtml).toContain('id="debugStats"');
    expect(debugHtml).toContain('VIDEO INFO');
    expect(debugHtml).toContain('debug-stats-header');
  });

  it('script includes updateDebugStats function', () => {
    expect(debugHtml).toContain('updateDebugStats');
    expect(debugHtml).toContain('getVideoPlaybackQuality');
  });

  it('debug rows follow the racer order', () => {
    const html = withOptions({ clipTimes }, huntWinsSummary());
    const panelSection = html.slice(html.indexOf('id="debugPanel"'));
    expect(panelSection.indexOf('>lauda<')).toBeLessThan(panelSection.indexOf('>hunt<'));
  });

  it('renders FRAME POSITIONS section in debug panel', () => {
    expect(debugHtml).toContain('id="debugFrames"');
    expect(debugHtml).toContain('FRAME POSITIONS');
    expect(debugHtml).toContain('id="debugFrameRow0"');
    expect(debugHtml).toContain('id="debugFrameRow1"');
  });

  it('script includes frame position update showing clip, full, and range', () => {
    expect(debugHtml).toContain('updateFramePositions');
    expect(debugHtml).toContain('clipFrame');
    expect(debugHtml).toContain('clipStartFrame');
    expect(debugHtml).toContain('clipEndFrame');
    expect(debugHtml).toContain("'clip: '");
    expect(debugHtml).toContain("'full: '");
    expect(debugHtml).toContain("'range: '");
  });
});

// --- Timing events in debug mode ---

describe('buildPlayerHtml timing events', () => {
  const clipTimes = [
    { start: 1.5, end: 3, recordingOffset: 0.12, wallClockDuration: 5.0, measurements: [{ name: 'Load', startTime: 1.6, endTime: 2.8 }] },
    { start: 1.2, end: 2.8, recordingOffset: 0.15, wallClockDuration: 4.8, measurements: [{ name: 'Load', startTime: 1.3, endTime: 2.5 }] },
  ];
  const timingHtml = buildPlayerHtml(makeSummary(), videoFiles, null, null, { clipTimes });

  it('renders TIMING EVENTS section in debug panel', () => {
    expect(timingHtml).toContain('TIMING EVENTS');
    expect(timingHtml).toContain('id="debugTiming"');
    expect(timingHtml).toContain('debug-timing');
  });

  it('renders per-racer timing placeholder divs', () => {
    expect(timingHtml).toContain('id="debugTimingRacer0"');
    expect(timingHtml).toContain('id="debugTimingRacer1"');
    expect(timingHtml).toContain('id="debugTimingEvents0"');
    expect(timingHtml).toContain('id="debugTimingEvents1"');
  });

  it('embeds measurements in clipTimes JSON', () => {
    const parsed = getRaceConfig(timingHtml).clipTimes;
    expect(parsed).toBeTruthy();
    expect(parsed[0].measurements).toBeDefined();
    expect(parsed[0].measurements.length).toBeGreaterThan(0);
    expect(parsed[0].measurements[0].name).toBe('Load');
  });

  it('saves _wcStart and _wcEnd in onMeta before trace conversion', () => {
    expect(timingHtml).toContain('_wcStart = ');
    expect(timingHtml).toContain('_wcEnd = ');
    expect(timingHtml).not.toContain('_ptsScale = scale');
  });

  it('script contains timing event labels and column headers', () => {
    expect(timingHtml).toContain('Context created');
    expect(timingHtml).toContain('recordingStartTime (t=0)');
    expect(timingHtml).toContain('raceRecordingStart()');
    expect(timingHtml).toContain('raceRecordingEnd()');
    expect(timingHtml).toContain('Pre-close');
    expect(timingHtml).toContain('Calibration mode');
    expect(timingHtml).toContain("'Event'");
    expect(timingHtml).toContain("'Wall-clock'");
    expect(timingHtml).toContain("'Video time'");
    expect(timingHtml).toContain("'Frame'");
  });

  it('script includes frame number computation', () => {
    expect(timingHtml).toContain('toFrame');
    expect(timingHtml).toContain('Math.round(pts / 0.04)');
  });

  it('includes timingData in Copy JSON handler', () => {
    expect(timingHtml).toContain('timingData');
    expect(timingHtml).toContain('videoDuration');
    expect(timingHtml).toContain('_wcStart');
    expect(timingHtml).toContain('_ptsScale');
  });

  it('handles clipTimes without measurements gracefully', () => {
    const noMeasClips = [
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
    ];
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { clipTimes: noMeasClips });
    expect(html).toContain('TIMING EVENTS');
    expect(html).toContain('id="debugTimingEvents0"');
    // Should still contain measurement iteration code
    expect(html).toContain('const measurements = ct.measurements || []');
  });
});

// --- Export (client-side side-by-side stitching) ---

describe('buildPlayerHtml export', () => {
  it('renders Export button with export functions when videos exist', () => {
    for (const str of ['id="exportBtn"', 'Export', 'startExport', 'MediaRecorder', 'captureStream', 'getExportLayout']) {
      expect(defaultHtml).toContain(str);
    }
  });

  it('renders Export button in header for all pages', () => {
    // Export buttons are always in the header; runtime hides them when < 2 racers
    expect(noVideosHtml).toContain('id="exportBtn"');
    expect(defaultHtml).toContain('id="exportBtn"');
  });

  it('getExportLayout ensures even canvasH for libx264 compatibility', () => {
    // canvasH = rawH + (rawH % 2) rounds odd heights up to even
    expect(defaultHtml).toContain('rawH % 2');
  });

  it('export timer starts from 0 using exportTimeOffset', () => {
    expect(defaultHtml).toContain('exportTimeOffset');
    expect(defaultHtml).toContain('cur - exportTimeOffset');
  });

  it('export modal canvas has max-height to keep buttons visible', () => {
    expect(defaultHtml).toContain('max-height: 50dvh');
  });
});

// --- Browser-based conversion (ffmpeg.wasm) ---

describe('buildPlayerHtml ffmpeg.wasm conversion', () => {
  it('includes convertWithFFmpeg function in player script', () => {
    expect(defaultHtml).toContain('convertWithFFmpeg');
  });

  it('includes loadFFmpeg function using the configured ffmpeg dir', () => {
    expect(defaultHtml).toContain('loadFFmpeg');
    expect(defaultHtml).toContain("import(ffmpegDir + 'index.js')");
    expect(defaultHtml).toContain("ffmpegDir + 'ffmpeg-core.js'");
    expect(defaultHtml).toContain("ffmpegDir + 'ffmpeg-core.wasm'");
    expect(getRaceConfig(defaultHtml).ffmpegDir).toBe('./ffmpeg/');
  });

  it('includes file:// protocol check with helpful error message', () => {
    expect(defaultHtml).toContain("location.protocol === 'file:'");
    expect(defaultHtml).toContain('npx serve');
  });

  it('revokes blob URLs after ffmpeg load to prevent memory leak', () => {
    expect(defaultHtml).toContain('forEach(u => URL.revokeObjectURL(u))');
  });

  it('includes toBlobURL helper for CORS-safe loading', () => {
    expect(defaultHtml).toContain('toBlobURL');
  });


  it('includes GIF conversion args with palette optimization', () => {
    expect(defaultHtml).toContain('palettegen');
    expect(defaultHtml).toContain('paletteuse=dither=bayer');
  });

  it('includes MOV conversion args with H.264', () => {
    expect(defaultHtml).toContain('libx264');
    expect(defaultHtml).toContain('yuv420p');
  });


  it('includes conversion progress UI CSS', () => {
    expect(defaultHtml).toContain('export-convert-row');
  });

  it('uses unique filenames per conversion to prevent conflicts', () => {
    expect(defaultHtml).toContain('convertCounter');
    expect(defaultHtml).toContain("'input_' + runId");
    expect(defaultHtml).toContain("'output_' + runId");
  });

  it('logs cleanup failures instead of silently catching', () => {
    expect(defaultHtml).toContain("console.warn('ffmpeg cleanup:'");
  });

  it('keeps a dismiss button available during conversion', () => {
    expect(defaultHtml).toContain('dismissBtn');
  });


  it('passes clip range for trimming during conversion', () => {
    const html = withOptions({ clipTimes: [{ start: 1, end: 3 }, { start: 1, end: 3 }] });
    expect(html).toContain('clipRange');
    expect(html).toContain("'-ss'");
    expect(html).toContain("'-t'");
  });


  it('checks ff.exec exit code and throws a human-readable error on non-zero or null', () => {
    expect(defaultHtml).toContain('exitCode == null || exitCode !== 0');
    expect(defaultHtml).toContain('ffmpeg exited with code');
    expect(defaultHtml).toContain('conversion failed');
  });

  it('passes a timeout to ff.exec to prevent indefinite hangs', () => {
    // ff.exec(args, 300000) uses the library's built-in timeout
    expect(defaultHtml).toContain('ff.exec(args, 300000)');
  });
});

// --- Clip alignment ---

describe('buildPlayerHtml clip alignment', () => {
  const withClips = (clips, opts = {}) => withOptions({ clipTimes: clips, ...opts }, opts.summary);

  it('resolveClip uses maxDuration, not maxEnd', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 2, end: 3.5 }]);
    expect(html).toContain('maxDuration');
    expect(html).toContain('minStart + maxDuration');
  });

  it('seekAll uses elapsed-time mapping for per-video positioning', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 2, end: 3.5 }]);
    expect(html).toContain('const elapsed = t - activeClip.start');
    expect(html).toContain('target = ct[i].start + elapsed');
  });

  it('resolveAdjustedClip also uses maxDuration', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 2, end: 3.5 }]);
    const script = html.slice(html.indexOf('resolveAdjustedClip'));
    expect(script).toContain('maxDuration');
  });

  it('updateTimeDisplay derives time from scrubber, not primary.currentTime', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 2, end: 3.5 }]);
    const fnMatch = html.match(/function updateTimeDisplay\(\)\s*\{([^}]+)\}/);
    expect(fnMatch).toBeTruthy();
    expect(fnMatch[1]).toContain('scrubber.value');
    expect(fnMatch[1]).not.toContain('primary.currentTime');
  });

  it('timeupdate clip-end handler sets scrubber to 1000 and returns', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 2, end: 3.5 }]);
    expect(html).toContain('scrubber.value = 1000');
  });

  it('stepFrame derives position from scrubber for elapsed-time consistency', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 2, end: 3.5 }]);
    const stepStart = html.indexOf('function stepFrame');
    const nextFn = html.indexOf('\nfunction ', stepStart + 1);
    const endIdx = nextFn > stepStart ? nextFn : stepStart + 500;
    const stepFn = html.slice(stepStart, endIdx);
    expect(stepFn).not.toContain('Math.max.apply');
    expect(stepFn).toContain('scrubber.value');
  });

  it('export seek code uses elapsed-based alignment', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 2, end: 3.5 }]);
    const exportSection = html.slice(html.indexOf('seekPromises'));
    expect(exportSection).toContain('const elapsed = startTime - activeClip.start');
    expect(exportSection).toContain('target = ct[i].start + elapsed');
  });
});

// --- seekAllWithVerify (Chrome WebM seek retry) ---

describe('buildPlayerHtml seekAllWithVerify', () => {
  const withClips = (clips, opts = {}) => withOptions({ clipTimes: clips, ...opts }, opts.summary);

  it('defines seekAllWithVerify when clipTimes provided', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    expect(html).toContain('function seekAllWithVerify(');
  });

  it('seekAllWithVerify guards against null clipTimes internally', () => {
    // The function is always included in the template; it early-returns per-video
    // when clipTimes is null, so it is safe to call regardless.
    expect(defaultHtml).toContain('function seekAllWithVerify(');
    const fnStart = defaultHtml.indexOf('function seekAllWithVerify(');
    const fnEnd = defaultHtml.indexOf('\nfunction ', fnStart + 1);
    const fn = defaultHtml.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 600);
    expect(fn).toContain('!clipTimes');
  });

  it('attaches seeked listener with { once: true }', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const fnStart = html.indexOf('function seekAllWithVerify(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 600);
    expect(fn).toContain("addEventListener('seeked'");
    expect(fn).toContain('{ once: true }');
  });

  it('uses SEEK_SNAP_TOLERANCE threshold for retry condition', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const fnStart = html.indexOf('function seekAllWithVerify(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 800);
    expect(fn).toContain('SEEK_SNAP_TOLERANCE');
  });

  it('guards retry with isFinite(v.duration)', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const fnStart = html.indexOf('function seekAllWithVerify(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 600);
    expect(fn).toContain('isFinite(v.duration)');
  });

  it('skips listener when expected position is at or near 0', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const fnStart = html.indexOf('function seekAllWithVerify(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 800);
    expect(fn).toContain('ZERO_START_THRESHOLD');
  });

  it('initSeek uses seekAllWithVerify not plain seekAll', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const initSeekStart = html.indexOf('const initSeek = ()');
    const initSeekEnd = html.indexOf('};', initSeekStart) + 2;
    const initSeekFn = html.slice(initSeekStart, initSeekEnd);
    expect(initSeekFn).toContain('seekAllWithVerify(');
    expect(initSeekFn).not.toMatch(/(^|\W)seekAll\(/); // no plain seekAll call (only seekAllWithVerify)
  });

  it('onMeta recomputes activeSegmentClipTimes after calibration', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const onMetaStart = html.indexOf('function onMeta(');
    const onMetaEnd = html.indexOf('\nfunction ', onMetaStart + 1);
    const onMetaFn = html.slice(onMetaStart, onMetaEnd > onMetaStart ? onMetaEnd : onMetaStart + 2000);
    expect(onMetaFn).toContain('convertedAny && activeSegmentName');
    expect(onMetaFn).toContain('activeSegmentClipTimes = getSegmentClipTimes(activeSegmentName)');
  });

  it('finalizeCalibration convertedAny branch uses seekAllWithVerify', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const fnStart = html.indexOf('function finalizeCalibration(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1500);
    expect(fn).toContain('seekAllWithVerify(');
  });

  it('attaches canplay fallback listener in seekAllWithVerify', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const fnStart = html.indexOf('function seekAllWithVerify(');
    const fnEnd = html.indexOf('\nif (clipTimes)', fnStart);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 800);
    expect(fn).toContain("addEventListener('canplay'");
    expect(fn).toContain('{ once: true }');
  });

  it('canplay fallback re-attempts within a single hard-capped retry budget', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    const fnStart = html.indexOf('function seekAllWithVerify(');
    const fnEnd = html.indexOf('\nif (clipTimes)', fnStart);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 800);
    // Position check still uses the named tolerance constant.
    expect(fn).toContain('SEEK_SNAP_TOLERANCE');
    // Total seeks are capped so MAX_SEEK_RETRIES is a genuine hard ceiling…
    expect(fn).toContain('MAX_SEEK_RETRIES');
    // …and canplay reuses the same retry routine rather than resetting a
    // counter shared by two concurrently-live seeked chains.
    expect(fn).toContain("addEventListener('canplay', reseek");
    expect(fn).not.toContain('retries = 0');
  });
});

describe('buildPlayerHtml onMeta _durationForced (Chrome WebM Infinity duration)', () => {
  const withClips = (clips) => withOptions({ clipTimes: clips });

  it('declares _durationForced WeakMap', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 1, end: 3 }]);
    expect(html).toContain('_durationForced');
    expect(html).toContain('WeakMap');
  });

  it('ensureFiniteDurations triggers 1e10 seek when duration is non-finite', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 1, end: 3 }]);
    const fnStart = html.indexOf('function ensureFiniteDurations(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1500);
    expect(fn).toContain('1e10');
    expect(fn).toContain('durationchange');
  });

  it('ensureFiniteDurations always returns early while any video has non-finite duration', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 1, end: 3 }]);
    const fnStart = html.indexOf('function ensureFiniteDurations(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1500);
    // The return must be unconditional — i.e. it appears after the closing brace
    // of the if (!_durationForced.has(v)) { ... } block, not inside it.
    // Search for the actual assignment (not a comment mention) to find the right position.
    const seek1e10Idx = fn.indexOf('currentTime = 1e10');
    expect(seek1e10Idx).toBeGreaterThan(-1);
    // Find the closing brace of the has-guard block (after the 1e10 assignment)
    const closingBraceIdx = fn.indexOf('}', seek1e10Idx);
    const returnIdx = fn.indexOf('return false;', closingBraceIdx);
    expect(returnIdx).toBeGreaterThan(closingBraceIdx);
    // Only whitespace/comments between the closing brace and return false;
    const between = fn.slice(closingBraceIdx + 1, returnIdx).replace(/\/\/[^\n]*/g, '').trim();
    expect(between).toBe('');
  });

  it('ensureFiniteDurations only triggers 1e10 seek once per src (WeakMap guard)', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 1, end: 3 }]);
    const fnStart = html.indexOf('function ensureFiniteDurations(');
    const fnEnd = html.indexOf('\nfunction ', fnStart + 1);
    const fn = html.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1500);
    // WeakMap API: set() inside the guard, get() !== srcKey as the condition
    expect(fn).toContain('_durationForced.set(v');
    const getGuardIdx = fn.indexOf('_durationForced.get(v)');
    const setIdx = fn.indexOf('_durationForced.set(v', getGuardIdx);
    const seek1e10Idx = fn.indexOf('1e10', getGuardIdx);
    expect(getGuardIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(getGuardIdx);
    expect(seek1e10Idx).toBeGreaterThan(getGuardIdx);
  });
});

// --- convertVideos scale filter for MOV ---

describe('convertVideos MOV scale filter', () => {
  it('includes scale=trunc for MOV to ensure even dimensions', () => {
    // Read results.js source directly to verify the scale filter is present
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'results.js'), 'utf-8');
    expect(src).toContain("'scale=trunc(iw/2)*2:trunc(ih/2)*2'");
    expect(src).toContain("format === 'mov'");
  });
});

// --- copyFFmpegFiles ---

describe('copyFFmpegFiles', () => {
  it('copies ffmpeg.wasm files to ffmpeg/ subdirectory', () => {
    withTmpDir(tmpDir => {
      expect(copyFFmpegFiles(tmpDir)).toBe(true);
      const ffmpegDir = path.join(tmpDir, 'ffmpeg');
      expect(fs.existsSync(ffmpegDir)).toBe(true);
      for (const file of ['index.js', 'classes.js', 'worker.js', 'ffmpeg-core.js', 'ffmpeg-core.wasm']) {
        expect(fs.existsSync(path.join(ffmpegDir, file))).toBe(true);
      }
      const wasmPath = path.join(ffmpegDir, 'ffmpeg-core.wasm');
      expect(fs.existsSync(wasmPath)).toBe(true);
      expect(fs.statSync(wasmPath).size).toBeGreaterThan(1024 * 1024);
    });
  });

  it('returns false and logs warning on copy failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      withTmpDir(tmpDir => {
        fs.writeFileSync(path.join(tmpDir, 'blocker'), ''); // regular file blocks mkdir inside it
        expect(copyFFmpegFiles(path.join(tmpDir, 'blocker'))).toBe(false);
        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toContain('Could not copy ffmpeg.wasm files');
        expect(fs.existsSync(path.join(path.join(tmpDir, 'blocker'), 'ffmpeg'))).toBe(false);
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('buildPlayerHtml run-by-run comparison', () => {
  const runSummaries = [
    {
      racers: ['lauda', 'hunt'],
      comparisons: [
        { name: 'Load', racers: [{ duration: 1.0 }, { duration: 3.0 }], winner: 'lauda', diffPercent: 200, rankings: ['lauda', 'hunt'] },
      ],
      errors: [],
      profileMetrics: [
        { measured: { scriptDuration: 100 }, total: {} },
        { measured: { scriptDuration: 200 }, total: {} },
      ],
    },
    {
      racers: ['lauda', 'hunt'],
      comparisons: [
        { name: 'Load', racers: [{ duration: 2.0 }, { duration: 4.0 }], winner: 'lauda', diffPercent: 100, rankings: ['lauda', 'hunt'] },
      ],
      errors: [],
      profileMetrics: [
        { measured: { scriptDuration: 120 }, total: {} },
        { measured: { scriptDuration: 180 }, total: {} },
      ],
    },
  ];

  const medianSummary = makeSummary({
    comparisons: [
      { name: 'Load', racers: [{ duration: 1.5 }, { duration: 3.5 }], winner: 'lauda', diff: 2, diffPercent: 133.3, rankings: ['lauda', 'hunt'] },
    ],
    runs: 2,
    profileMetrics: [
      { measured: { scriptDuration: 110 }, total: {} },
      { measured: { scriptDuration: 190 }, total: {} },
    ],
  });

  it('renders run-by-run comparison section with color-coded racer headers', () => {
    const html = buildPlayerHtml(medianSummary, videoFiles, null, null, { runSummaries });
    expect(html).toContain('Run-by-Run Comparison');
    // Racer headers carry the racer colour as a token the stylesheet reads
    expect(html).toContain('style="--racer-color:#e74c3c">lauda');
    expect(html).toContain('style="--racer-color:#3498db">hunt');
  });

  it('shows trophy for winner and delta for loser in comparison table', () => {
    const html = buildPlayerHtml(medianSummary, videoFiles, null, null, { runSummaries });
    // Winner gets trophy, no separate Winner column
    expect(html).toContain('1.000s (\uD83C\uDFC6)');
    expect(html).not.toMatch(/<th>Winner<\/th>/);
    // Loser gets delta (3.0 - 1.0 = 2.0)
    expect(html).toContain('+2.000s');
  });

  it('includes measurement rows and median row', () => {
    const html = buildPlayerHtml(medianSummary, videoFiles, null, null, { runSummaries });
    expect(html).toContain('1.000s');
    expect(html).toContain('4.000s');
    expect(html).toContain('run-comparison-median');
    expect(html).toContain('<strong>Median</strong>');
    expect(html).toContain('1.500s');
  });

  it('includes performance metrics comparison tables', () => {
    const html = buildPlayerHtml(medianSummary, videoFiles, null, null, { runSummaries });
    expect(html).toContain('Performance: Race');
    expect(html).toContain('Script Execution');
  });

  it('omits comparison section when only one run', () => {
    const html = buildPlayerHtml(medianSummary, videoFiles, null, null, { runSummaries: [runSummaries[0]] });
    expect(html).not.toContain('Run-by-Run Comparison');
  });

  it('omits comparison section when no runSummaries provided', () => {
    const html = buildPlayerHtml(medianSummary, videoFiles);
    expect(html).not.toContain('Run-by-Run Comparison');
  });
});

// --- Semantics & accessibility ---

describe('buildPlayerHtml semantics', () => {
  const multiRunHtml = withOptions({
    runSummaries: [makeSummary(), huntWinsSummary(), makeSummary()],
    runNavigation: { currentRun: 1, totalRuns: 3, pathPrefix: '../' },
  });

  it('wraps the report in landmarks and offers a skip link into it', () => {
    expect(defaultHtml).toContain('<a class="skip-link" href="#main">');
    expect(defaultHtml).toContain('<main id="main">');
    expect(defaultHtml).toContain('</main>');
    expect(defaultHtml).toMatch(/<header class="header-bar">/);
    expect(defaultHtml).toMatch(/<footer>[\s\S]*checkered-bar[\s\S]*<\/footer>/);
  });

  it('hides the purely decorative ornaments from assistive tech', () => {
    expect(defaultHtml).toContain('<div class="checkered-bar" aria-hidden="true">');
    expect(defaultHtml).toContain('class="header-icon header-icon-left" aria-hidden="true"');
  });

  it('names the two navigation regions', () => {
    expect(defaultHtml).toContain('<nav class="header-icon header-icon-right" aria-label="Player actions">');
    expect(multiRunHtml).toContain('<nav class="run-nav" aria-label="Race runs">');
  });

  it('gives every button an explicit type so none can submit a form', () => {
    const buttons = defaultHtml.match(/<button\b[^>]*>/g) || [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter(b => !b.includes('type="button"'))).toEqual([]);
  });

  it('wires disclosure and toggle state onto the controls that own it', () => {
    expect(defaultHtml).toContain('id="settingsToggle" title="Settings" aria-label="Toggle settings" aria-expanded="false" aria-controls="settingsPanel"');
    expect(defaultHtml).toContain('id="shareToggle"');
    expect(defaultHtml).toMatch(/id="shareToggle"[^>]*aria-expanded="false" aria-controls="shareMenu"/);
    expect(defaultHtml).toMatch(/id="fullscreenBtn"[^>]*aria-pressed="false"/);
    // …and the runtime keeps all three in sync as they are operated.
    expect(defaultHtml).toContain("settingsToggle.setAttribute('aria-expanded', String(visible))");
    expect(defaultHtml).toContain("shareToggle.setAttribute('aria-expanded', String(visible))");
    expect(defaultHtml).toContain("fullscreenBtn.setAttribute('aria-pressed', String(fs))");
    expect(defaultHtml).toContain("btn.setAttribute('aria-pressed', 'false')");
  });

  it('announces the scrubber as a time, not a percentage', () => {
    expect(defaultHtml).toContain("scrubber.setAttribute('aria-valuetext', readout)");
  });

  it('exposes bar charts as progress bars carrying their measured value', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toMatch(/<span class="profile-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="\d+"/);
    expect(html).toMatch(/aria-valuetext="[^"]+" aria-label="lauda: [^"]+"/);
  });

  it('keeps the export progress bar value in step with its width', () => {
    expect(defaultHtml).toContain('role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"');
    expect(defaultHtml).toContain("bar.setAttribute('aria-valuenow', String(Math.round(clamped)))");
    // The helper is the only thing that moves the fill, so the width and the
    // announced value can never disagree.
    expect(defaultHtml.match(/progressFill\.style\.width = /g)).toHaveLength(1);
  });

  it('interrupts with racer failures rather than leaving them unread', () => {
    const html = withSummary({ errors: ['hunt crashed'] });
    expect(html).toContain('<div class="errors" role="alert">');
  });

  it('captions comparison tables and scopes their header cells', () => {
    expect(multiRunHtml).toContain('<caption class="sr-only">Race Section Load per run, by racer</caption>');
    expect(multiRunHtml).toContain('<th scope="col">Run</th>');
    expect(multiRunHtml).toMatch(/<th scope="col" style="--racer-color:[^"]+">lauda<\/th>/);
  });

  it('marks the video grid, the transport bar and the calibration panel', () => {
    expect(defaultHtml).toContain('<section class="player-container" id="playerContainer" aria-label="Race recordings">');
    expect(defaultHtml).toContain('<div class="controls" role="toolbar" aria-label="Playback controls">');
    const clipTimes = [
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 2 },
      { start: 1.2, end: 3.4, recordingOffset: 0.2, wallClockDuration: 2.2 },
    ];
    const debugHtml = withOptions({ clipTimes });
    expect(debugHtml).toContain('<aside class="debug-panel" id="debugPanel" aria-label="Calibration">');
    expect(debugHtml).toContain('<h4 class="debug-stats-header">VIDEO INFO</h4>');
  });

  it('treats the export overlay as a modal dialog', () => {
    expect(defaultHtml).toContain('role="dialog" aria-modal="true" aria-labelledby="exportDialogTitle"');
    expect(defaultHtml).toContain('<h3 id="exportDialogTitle">');
  });
});

// --- Racer order & fullscreen labels ---

describe('buildPlayerHtml racer order', () => {
  // hunt wins, but lauda is racer 1: the grid, the config arrays and the file
  // links all stay in the order the racers were declared.
  const html = buildPlayerHtml(huntWinsSummary(), videoFiles, null, null, {
    fullVideoFiles: ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'],
    clipTimes: [{ start: 1, end: 3 }, { start: 0.5, end: 2.5 }],
  });

  it('lays the videos out in racer order, not placement order', () => {
    expect(html.indexOf('data-racer-name="lauda"')).toBeLessThan(html.indexOf('data-racer-name="hunt"'));
    expect(html).toContain('<video id="v0" src="lauda/lauda.race.webm"');
    expect(html).toContain('<video id="v1" src="hunt/hunt.race.webm"');
  });

  it('keeps every injected array aligned with that order', () => {
    const config = getRaceConfig(html);
    expect(config.racerNames).toEqual(['lauda', 'hunt']);
    expect(config.raceVideoPaths).toEqual(videoFiles);
    expect(config.fullVideoPaths).toEqual(['lauda/lauda.full.webm', 'hunt/hunt.full.webm']);
    expect(config.racerColors).toEqual([RACER_CSS_COLORS[0], RACER_CSS_COLORS[1]]);
  });

  it('still marks the winner with a trophy wherever they are placed', () => {
    const huntCard = html.slice(html.indexOf('data-racer-name="hunt"') - 400, html.indexOf('data-racer-name="hunt"'));
    expect(huntCard).toContain('class="trophy"');
  });

  it('lists the files in racer order too', () => {
    const files = html.slice(html.indexOf('file-links'));
    expect(files.indexOf('lauda/lauda.race.webm')).toBeLessThan(files.indexOf('hunt/hunt.race.webm'));
  });
});

describe('buildPlayerHtml fullscreen labels', () => {
  const fullscreenCss = (html) => html
    .split('\n')
    .filter(line => line.includes(':fullscreen'))
    .join('\n');

  it('shows the racer name over its video instead of hiding it', () => {
    const css = fullscreenCss(defaultHtml);
    expect(css).toContain('.fullscreen-wrapper:is(:fullscreen, :-webkit-full-screen) .racer-label {');
    expect(css).not.toContain('.racer-label { display: none; }');
  });

  it('overlays the label so it steals no height from the video grid', () => {
    const block = defaultHtml.slice(defaultHtml.indexOf(':-webkit-full-screen) .racer-label {'));
    const rule = block.slice(0, block.indexOf('}'));
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('pointer-events: none');
    expect(defaultHtml).toContain(':-webkit-full-screen) .racer { position: relative; }');
  });
});
