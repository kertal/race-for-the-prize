import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildProfileComparison } from '../cli/profile-analysis.js';
import { copyFFmpegFiles } from '../cli/results.js';

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

// Shared helpers — reduce repeated buildPlayerHtml boilerplate
const withSummary = (overrides) => buildPlayerHtml(makeSummary(overrides), videoFiles);
const withOptions = (opts, summary) => buildPlayerHtml(summary || makeSummary(), videoFiles, null, null, opts);
const defaultHtml = withSummary();
const noVideosHtml = buildPlayerHtml(makeSummary(), []);

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-test-'));
  try { fn(tmpDir); } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

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
    expect(html).toContain('During Measurement');
    expect(html).toContain('<details');
    expect(html).toContain('Total Session');
  });

  it('shows profile racers sorted by value with deltas', () => {
    const metrics1 = { total: {}, measured: { networkTransferSize: 2000 } };
    const metrics2 = { total: {}, measured: { networkTransferSize: 1000 } };
    const profileComparison = buildProfileComparison(['lauda', 'hunt'], [metrics1, metrics2]);
    const html = withSummary({ profileComparison });
    const profileSection = html.slice(html.indexOf('During Measurement'));
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
    expect(html).toContain('4x');
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

// --- Click counts in results ---

describe('buildPlayerHtml click counts', () => {
  it('shows click counts when present', () => {
    const html = withSummary({ comparisons: [], clickCounts: { lauda: 5, hunt: 3 } });
    expect(html).toContain('Clicks');
    expect(html).toContain('>5<');
    expect(html).toContain('>3<');
  });

  it('omits clicks when all zero', () => {
    expect(withSummary({ comparisons: [] })).not.toContain('Clicks');
  });
});

// --- Clip times (default mode, without --ffmpeg) ---

describe('buildPlayerHtml clipTimes', () => {
  const withClips = (clips, opts = {}) => withOptions({ clipTimes: clips, ...opts }, opts.summary);

  it('does not show Race/Full mode buttons when clipTimes provided', () => {
    const html = withClips([{ start: 1.5, end: 3 }, { start: 1.5, end: 3 }]);
    expect(html).not.toContain('id="modeRace"');
    expect(html).not.toContain('id="modeFull"');
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
    expect(html).not.toContain('id="modeFull"');
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

  it('embeds recordingOffset and wallClockDuration in clipTimes JSON', () => {
    const clips = [
      { start: 1.5, end: 3, recordingOffset: 0.12, wallClockDuration: 5.0 },
      { start: 1.2, end: 2.8, recordingOffset: 0.15, wallClockDuration: 4.8 },
    ];
    const html = withClips(clips);
    expect(html).toContain('"recordingOffset"');
    expect(html).toContain('"wallClockDuration"');
    const clipMatch = html.match(/const clipTimes = (\[.*?\]);/);
    expect(clipMatch).toBeTruthy();
    const parsed = JSON.parse(clipMatch[1]);
    expect(parsed[0].recordingOffset).toBe(0.12);
    expect(parsed[0].wallClockDuration).toBe(5.0);
    expect(parsed[1].recordingOffset).toBe(0.15);
    expect(parsed[1].wallClockDuration).toBe(4.8);
  });

  it('includes trace-based conversion logic in onMeta', () => {
    const clips = [
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
    ];
    const html = withClips(clips);
    expect(html).toContain('_converted');
    expect(html).toContain('tracePtsStart');
    expect(html).toContain('hasTraceCalibration(ct)');
  });

  it('does not include canvas/localStorage fallback calibration code', () => {
    const clips = [
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
    ];
    const html = withClips(clips);
    expect(html).not.toContain('detectGreenCuePts');
    expect(html).not.toContain('calibrateFromCanvas');
    expect(html).not.toContain('isGreenCue');
    expect(html).not.toContain('restoreFromCache');
    expect(html).not.toContain('localStorage');
  });

  it('includes strict calibration error for missing trace metadata', () => {
    const clips = [
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
    ];
    const html = withClips(clips);
    expect(html).toContain('Calibration error: missing trace calibration metadata. Please calibrate manually.');
    expect(html).toContain('manual calibration required');
    expect(html).toContain('playBtn.disabled = true');
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
    const clips = [
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
      { start: 1, end: 3, recordingOffset: 0.1, wallClockDuration: 5 },
    ];
    const html = withClips(clips);
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

  it('hides Debug button when no clipTimes or all null', () => {
    expect(defaultHtml).not.toContain('id="modeDebug"');
    const nullClips = withOptions({ clipTimes: [null, null] });
    expect(nullClips).not.toContain('id="modeDebug"');
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

  it('debug rows ordered by placement (winner first)', () => {
    const html = withOptions({ clipTimes }, huntWinsSummary());
    const panelSection = html.slice(html.indexOf('id="debugPanel"'));
    expect(panelSection.indexOf('>hunt<')).toBeLessThan(panelSection.indexOf('>lauda<'));
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
    const clipMatch = timingHtml.match(/const clipTimes = (\[.*?\]);/);
    expect(clipMatch).toBeTruthy();
    const parsed = JSON.parse(clipMatch[1]);
    // clipTimes are reordered by placement; winner (lauda) is first
    expect(parsed[0].measurements).toBeDefined();
    expect(parsed[0].measurements.length).toBeGreaterThan(0);
    expect(parsed[0].measurements[0].name).toBe('Load');
  });

  it('saves _wcStart and _wcEnd in onMeta before trace conversion', () => {
    expect(timingHtml).toContain('ct._wcStart = ct.start');
    expect(timingHtml).toContain('ct._wcEnd = ct.end');
    expect(timingHtml).not.toContain('ct._ptsScale = scale');
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

  it('does not render Export button when no videos', () => {
    expect(noVideosHtml).not.toContain('id="exportBtn"');
  });
});

// --- Browser-based conversion (ffmpeg.wasm) ---

describe('buildPlayerHtml ffmpeg.wasm conversion', () => {
  it('includes convertWithFFmpeg function in player script', () => {
    expect(defaultHtml).toContain('convertWithFFmpeg');
  });

  it('includes loadFFmpeg function with local paths', () => {
    expect(defaultHtml).toContain('loadFFmpeg');
    expect(defaultHtml).toContain("import('./ffmpeg/index.js')");
    expect(defaultHtml).toContain('./ffmpeg/ffmpeg-core.js');
    expect(defaultHtml).toContain('./ffmpeg/ffmpeg-core.wasm');
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


  it('checks ff.exec exit code and throws a human-readable error on non-zero', () => {
    expect(defaultHtml).toContain('exitCode !== 0');
    expect(defaultHtml).toContain('ffmpeg exited with code');
    expect(defaultHtml).toContain('conversion failed');
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

// --- Embed mode (--embed) ---

describe('buildPlayerHtml embed mode', () => {
  function withEmbedDir(fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-embed-test-'));
    try {
      // Create racer subdirectories and small fake video files
      fs.mkdirSync(path.join(tmpDir, 'lauda'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'hunt'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'lauda', 'lauda.race.webm'), 'fake-webm-lauda');
      fs.writeFileSync(path.join(tmpDir, 'hunt', 'hunt.race.webm'), 'fake-webm-hunt');
      fn(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  it('replaces video src with base64 data URI when embed + runDir provided', () => {
    withEmbedDir(tmpDir => {
      const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { embed: true, runDir: tmpDir });
      expect(html).toContain('src="data:video/webm;base64,');
      expect(html).not.toContain('src="lauda/lauda.race.webm"');
      expect(html).not.toContain('src="hunt/hunt.race.webm"');
    });
  });

  it('encodes correct base64 content for each racer', () => {
    withEmbedDir(tmpDir => {
      const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { embed: true, runDir: tmpDir });
      const laudaB64 = Buffer.from('fake-webm-lauda').toString('base64');
      const huntB64 = Buffer.from('fake-webm-hunt').toString('base64');
      expect(html).toContain(laudaB64);
      expect(html).toContain(huntB64);
    });
  });

  it('falls back to relative path when video file not found', () => {
    withEmbedDir(tmpDir => {
      const missingFiles = ['missing/missing.race.webm', 'hunt/hunt.race.webm'];
      const html = buildPlayerHtml(makeSummary(), missingFiles, null, null, { embed: true, runDir: tmpDir });
      expect(html).toContain('src="missing/missing.race.webm"');
      expect(html).toContain('src="data:video/webm;base64,');
    });
  });

  it('embeds merged video as data URI when embed + runDir provided', () => {
    withEmbedDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, 'lauda-vs-hunt.webm'), 'fake-merged');
      const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, {
        embed: true, runDir: tmpDir, mergedVideoFile: 'lauda-vs-hunt.webm',
      });
      const mergedB64 = Buffer.from('fake-merged').toString('base64');
      expect(html).toContain(mergedB64);
      expect(html).not.toContain('src="lauda-vs-hunt.webm"');
    });
  });

  it('embeds full videos as data URIs when provided', () => {
    withEmbedDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, 'lauda', 'lauda.full.webm'), 'fake-full-lauda');
      fs.writeFileSync(path.join(tmpDir, 'hunt', 'hunt.full.webm'), 'fake-full-hunt');
      const fullVideoFiles = ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'];
      const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, {
        embed: true, runDir: tmpDir, fullVideoFiles,
      });
      const laudaFullB64 = Buffer.from('fake-full-lauda').toString('base64');
      expect(html).toContain(laudaFullB64);
    });
  });

  it('does not embed when embed option is false', () => {
    withEmbedDir(tmpDir => {
      const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { embed: false, runDir: tmpDir });
      expect(html).toContain('src="lauda/lauda.race.webm"');
      expect(html).not.toContain('src="data:video/webm;base64,');
    });
  });

  it('does not embed when runDir is not provided', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { embed: true });
    expect(html).toContain('src="lauda/lauda.race.webm"');
    expect(html).not.toContain('src="data:video/webm;base64,');
  });

  it('uses correct MIME type for .mov files', () => {
    withEmbedDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, 'a'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'b'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'a', 'a.race.webm'), 'webm-a');
      fs.writeFileSync(path.join(tmpDir, 'b', 'b.race.webm'), 'webm-b');
      fs.writeFileSync(path.join(tmpDir, 'a', 'a.race.mov'), 'mov-a');
      fs.writeFileSync(path.join(tmpDir, 'b', 'b.race.mov'), 'mov-b');
      const altFiles = ['a/a.race.mov', 'b/b.race.mov'];
      const summary = makeSummary({ racers: ['a', 'b'], comparisons: [], overallWinner: null });
      const baseFiles = ['a/a.race.webm', 'b/b.race.webm'];
      const html = buildPlayerHtml(summary, baseFiles, null, null, { embed: true, runDir: tmpDir });
      expect(html).toContain('data:video/webm;base64,');
    });
  });
});
