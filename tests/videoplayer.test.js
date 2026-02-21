import { describe, it, expect } from 'vitest';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildProfileComparison } from '../cli/profile-analysis.js';

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
  clickCounts: { lauda: 0, hunt: 0 },
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

// Shared default output — used by many tests that don't need custom summaries
const defaultHtml = buildPlayerHtml(makeSummary(), videoFiles);

describe('buildPlayerHtml', () => {
  it('returns a complete HTML document', () => {
    expect(defaultHtml).toContain('<!DOCTYPE html>');
    expect(defaultHtml).toContain('</html>');
  });

  it('embeds racer names and video sources', () => {
    expect(defaultHtml).toContain('lauda');
    expect(defaultHtml).toContain('hunt');
    expect(defaultHtml).toContain('src="lauda/lauda.race.webm"');
    expect(defaultHtml).toContain('src="hunt/hunt.race.webm"');
  });

  it('includes results with measurement data and deltas', () => {
    expect(defaultHtml).toContain('1.000s');
    expect(defaultHtml).toContain('2.000s');
    expect(defaultHtml).toContain('(+1.000s)');
    expect(defaultHtml).toContain('profile-bar-fill');
  });

  it('shows winner banner', () => {
    expect(defaultHtml).toContain('LAUDA wins!');
  });

  it('shows tie banner when tied', () => {
    const html = buildPlayerHtml(makeSummary({ overallWinner: 'tie' }), videoFiles);
    expect(html).toContain("It's a Tie!");
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
    const html = buildPlayerHtml(makeSummary({ comparisons: [] }), videoFiles);
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
    expect(html).toContain('const raceVideos = [v0, v1, v2]');
  });

  it('supports 4 racers', () => {
    const summary = makeSummary({ racers: ['a', 'b', 'c', 'd'], comparisons: [], overallWinner: null });
    const videos = ['a/a.race.webm', 'b/b.race.webm', 'c/c.race.webm', 'd/d.race.webm'];
    const html = buildPlayerHtml(summary, videos);
    for (let i = 0; i < 4; i++) expect(html).toContain(`id="v${i}"`);
    expect(html).toContain('const raceVideos = [v0, v1, v2, v3]');
  });

  it('supports 5 racers with download links', () => {
    const summary = makeSummary({ racers: ['r1', 'r2', 'r3', 'r4', 'r5'], comparisons: [], overallWinner: 'r1' });
    const videos = ['r1/r1.webm', 'r2/r2.webm', 'r3/r3.webm', 'r4/r4.webm', 'r5/r5.webm'];
    const altFiles = ['r1/r1.gif', 'r2/r2.gif', 'r3/r3.gif', 'r4/r4.gif', 'r5/r5.gif'];
    const html = buildPlayerHtml(summary, videos, 'gif', altFiles);
    expect(html).toContain('id="v4"');
    expect(html).toContain('r1 (.gif)');
    expect(html).toContain('r5 (.gif)');
    expect(html).toContain('const raceVideos = [v0, v1, v2, v3, v4]');
  });

  it('assigns correct colors to racer labels', () => {
    const summary = makeSummary({ racers: ['red', 'blue', 'green'], comparisons: [], overallWinner: null });
    const html = buildPlayerHtml(summary, ['r/r.webm', 'b/b.webm', 'g/g.webm']);
    expect(html).toContain('style="color: #e74c3c"');
    expect(html).toContain('style="color: #3498db"');
    expect(html).toContain('style="color: #27ae60"');
  });

  it('displays time and step counters', () => {
    expect(defaultHtml).toContain('0:00.000 / 0:00.000');
    expect(defaultHtml).toContain('id="timeDisplay"');
    expect(defaultHtml).toContain('0.0s');
    expect(defaultHtml).toContain('id="frameDisplay"');
    expect(defaultHtml).toContain('getTime');
  });

  it('shows mode toggle when full videos provided', () => {
    const fullVideos = ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'];
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { fullVideoFiles: fullVideos });
    expect(html).toContain('id="modeRace"');
    expect(html).toContain('id="modeFull"');
    expect(html).toContain('class="mode-btn active"');
    expect(html).toContain('switchToFull');
    expect(html).toContain('"lauda/lauda.full.webm"');
    expect(html).toContain('"hunt/hunt.full.webm"');
  });

  it('shows merged video button when merged video provided', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { mergedVideoFile: 'lauda-vs-hunt.webm' });
    expect(html).toContain('id="modeMerged"');
    expect(html).toContain('id="mergedVideo"');
    expect(html).toContain('src="lauda-vs-hunt.webm"');
    expect(html).toContain('switchToMerged');
  });

  it('shows all mode buttons when both full and merged provided', () => {
    const fullVideos = ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'];
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { fullVideoFiles: fullVideos, mergedVideoFile: 'merged.webm' });
    expect(html).toContain('id="modeRace"');
    expect(html).toContain('id="modeFull"');
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
    const html = buildPlayerHtml(makeSummary({ profileComparison }), videoFiles);
    expect(html).toContain('Performance Profile');
    expect(html).toContain('Lower values are better');
    expect(html).toContain('During Measurement');
    expect(html).toContain('Total Session');
  });

  it('shows profile racers sorted by value with deltas', () => {
    const metrics1 = { total: { networkTransferSize: 2000 }, measured: {} };
    const metrics2 = { total: { networkTransferSize: 1000 }, measured: {} };
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = buildPlayerHtml(makeSummary({ profileComparison }), videoFiles);
    const profileSection = html.slice(html.indexOf('Total Session'));
    expect(profileSection.indexOf('>hunt<')).toBeLessThan(profileSection.indexOf('>lauda<'));
    expect(profileSection).toContain('(+');
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

  it('shows winner video first when hunt wins', () => {
    const html = buildPlayerHtml(huntWinsSummary(), videoFiles);
    expect(html.indexOf('src="hunt/hunt.race.webm"')).toBeLessThan(html.indexOf('src="lauda/lauda.race.webm"'));
  });

  it('shows winner video first with original colors preserved', () => {
    const html = buildPlayerHtml(huntWinsSummary(), videoFiles);
    const huntLabelMatch = html.match(/color: (#[0-9a-f]+)">hunt/);
    expect(huntLabelMatch[1]).toBe('#3498db');
  });

  it('omits script tag when no videos provided', () => {
    const html = buildPlayerHtml(makeSummary(), [], null, null, {
      runNavigation: { currentRun: 'median', totalRuns: 3, pathPrefix: '' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('Results');
  });

  it('shows median page with videos and source note', () => {
    const html = buildPlayerHtml(makeSummary(), ['2/lauda/lauda.race.webm', '2/hunt/hunt.race.webm'], null, null, {
      runNavigation: { currentRun: 'median', totalRuns: 3, pathPrefix: '' },
      medianRunLabel: 'Run 2',
    });
    expect(html).toContain('<script>');
    expect(html).toContain('src="2/lauda/lauda.race.webm"');
    expect(html).toContain('Videos from Run 2 (closest to median)');
  });

  it('shows run navigation bar', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, {
      runNavigation: { currentRun: 1, totalRuns: 3, pathPrefix: '../' },
    });
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
    expect(html).toContain('4x');
  });

  it('defaults mode to parallel', () => {
    expect(buildPlayerHtml(abSummary(), abVideoFiles)).toContain('parallel');
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

// --- Click counts in results ---

describe('buildPlayerHtml click counts', () => {
  it('shows click counts when present', () => {
    const html = buildPlayerHtml(makeSummary({ comparisons: [], clickCounts: { lauda: 5, hunt: 3 } }), videoFiles);
    expect(html).toContain('Clicks');
    expect(html).toContain('>5<');
    expect(html).toContain('>3<');
  });

  it('omits clicks when all zero', () => {
    expect(buildPlayerHtml(makeSummary({ comparisons: [] }), videoFiles)).not.toContain('Clicks');
  });
});

// --- Clip times (default mode, without --ffmpeg) ---

describe('buildPlayerHtml clipTimes', () => {
  const withClips = (clips, opts = {}) => buildPlayerHtml(opts.summary || makeSummary(), videoFiles, null, null, { clipTimes: clips, ...opts });

  it('shows mode toggle with Full button when clipTimes provided', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.5, end: 3 }]);
    expect(html).toContain('id="modeRace"');
    expect(html).toContain('id="modeFull"');
  });

  it('embeds clipTimes data in player script', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.2, end: 2.8 }]);
    expect(html).toContain('const clipTimes =');
    expect(html).toContain('"start":');
    expect(html).toContain('"end":');
  });

  it('sets clipTimes to null when not provided', () => {
    expect(defaultHtml).toContain('const clipTimes = null');
  });

  it('handles clipTimes with null entries', () => {
    const html = withClips([{ start: 1, end: 2 }, null]);
    expect(html).toContain('id="modeFull"');
    expect(html).toContain('const clipTimes =');
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

  it('orders clipTimes by placement (winner first)', () => {
    const html = withClips([{ start: 1, end: 3 }, { start: 0.5, end: 2.5 }], { summary: huntWinsSummary() });
    const clipMatch = html.match(/const clipTimes = (\[.*?\]);/);
    expect(clipMatch).toBeTruthy();
    const parsed = JSON.parse(clipMatch[1]);
    expect(parsed[0].start).toBe(0.5); // hunt's clip first (winner)
    expect(parsed[1].start).toBe(1); // lauda's clip second
  });

  it('does not show Merged button without mergedVideoFile', () => {
    expect(withClips([{ start: 1, end: 3 }, { start: 1, end: 3 }])).not.toContain('id="modeMerged"');
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
});

// --- Debug mode ---

describe('buildPlayerHtml debug mode', () => {
  const clipTimes = [{ start: 1.52, end: 3 }, { start: 1.2, end: 2.8 }];
  const debugHtml = buildPlayerHtml(makeSummary(), videoFiles, null, null, { clipTimes });

  it('shows Debug button when clipTimes provided', () => {
    expect(debugHtml).toContain('id="modeDebug"');
    expect(debugHtml).toContain('>Debug<');
  });

  it('hides Debug button when no clipTimes or all null', () => {
    expect(defaultHtml).not.toContain('id="modeDebug"');
    const nullClips = buildPlayerHtml(makeSummary(), videoFiles, null, null, { clipTimes: [null, null] });
    expect(nullClips).not.toContain('id="modeDebug"');
  });

  it('renders debug panel with per-racer rows', () => {
    expect(debugHtml).toContain('id="debugPanel"');
    expect(debugHtml).toContain('DEBUG: Clip Start Calibration');
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
    for (const fn of ['FRAME_STEP', 'switchToDebug', 'adjustDebugOffset', 'debugOffsets', 'getAdjustedClipTimes', 'resolveAdjustedClip']) {
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

  it('debug rows ordered by placement (winner first)', () => {
    const html = buildPlayerHtml(huntWinsSummary(), videoFiles, null, null, { clipTimes });
    const panelSection = html.slice(html.indexOf('id="debugPanel"'));
    expect(panelSection.indexOf('>hunt<')).toBeLessThan(panelSection.indexOf('>lauda<'));
  });
});

// --- Export (client-side side-by-side stitching) ---

describe('buildPlayerHtml export', () => {
  it('renders Export button with export functions when videos exist', () => {
    for (const str of ['id="exportBtn"', 'Export', 'startExport', 'MediaRecorder', 'captureStream', 'getExportLayout']) {
      expect(defaultHtml).toContain(str);
    }
  });

  it('does not render Export button when no videos', () => {
    expect(buildPlayerHtml(makeSummary(), [])).not.toContain('id="exportBtn"');
  });
});
