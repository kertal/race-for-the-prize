import { describe, it, expect } from 'vitest';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildProfileComparison } from '../cli/profile-analysis.js';

const makeSummary = (overrides = {}) => ({
  racers: ['lauda', 'hunt'],
  comparisons: [
    { name: 'Load', racers: [{ duration: 1.0 }, { duration: 2.0 }], winner: 'lauda', diff: 1.0, diffPercent: 100.0, rankings: ['lauda', 'hunt'] },
  ],
  overallWinner: 'lauda',
  ...overrides,
});

const videoFiles = ['lauda/lauda.race.webm', 'hunt/hunt.race.webm'];

describe('buildPlayerHtml', () => {
  it('returns a complete HTML document', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('embeds racer names and video sources', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('lauda');
    expect(html).toContain('hunt');
    expect(html).toContain('src="lauda/lauda.race.webm"');
    expect(html).toContain('src="hunt/hunt.race.webm"');
  });

  it('includes results with measurement data and deltas', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('1.000s');
    expect(html).toContain('2.000s');
    expect(html).toContain('(+1.000s)');
    expect(html).toContain('profile-bar-fill');
  });

  it('shows winner banner', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('LAUDA wins!');
  });

  it('shows tie banner when tied', () => {
    const html = buildPlayerHtml(makeSummary({ overallWinner: 'tie' }), videoFiles);
    expect(html).toContain("It's a Tie!");
  });

  it('includes playback controls', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('id="playBtn"');
    expect(html).toContain('id="scrubber"');
    expect(html).toContain('id="speedSelect"');
  });

  it('includes frame navigation buttons', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('id="prevFrame"');
    expect(html).toContain('id="nextFrame"');
  });

  it('includes keyboard frame-step logic', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('ArrowLeft');
    expect(html).toContain('ArrowRight');
    expect(html).toContain('stepFrame');
  });

  it('omits download links when no alt format', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null);
    expect(html).not.toContain('Downloads');
  });

  it('includes download links when alt format provided', () => {
    const altFiles = ['lauda/lauda.race.gif', 'hunt/hunt.race.gif'];
    const html = buildPlayerHtml(makeSummary(), videoFiles, 'gif', altFiles);
    expect(html).toContain('Downloads');
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
    const summary = {
      racers: ['alpha', 'beta', 'gamma'],
      comparisons: [
        { name: 'Load', racers: [{ duration: 1.0 }, { duration: 1.5 }, { duration: 2.0 }], winner: 'alpha', diff: 1.0, diffPercent: 100.0 },
      ],
      overallWinner: 'alpha',
    };
    const videos = ['alpha/alpha.race.webm', 'beta/beta.race.webm', 'gamma/gamma.race.webm'];
    const html = buildPlayerHtml(summary, videos);
    expect(html).toContain('src="alpha/alpha.race.webm"');
    expect(html).toContain('src="beta/beta.race.webm"');
    expect(html).toContain('src="gamma/gamma.race.webm"');
    expect(html).toContain('>alpha<');
    expect(html).toContain('>beta<');
    expect(html).toContain('>gamma<');
    expect(html).toContain('const raceVideos = [v0, v1, v2]');
  });

  it('supports 4 racers', () => {
    const summary = {
      racers: ['a', 'b', 'c', 'd'],
      comparisons: [],
      overallWinner: null,
    };
    const videos = ['a/a.race.webm', 'b/b.race.webm', 'c/c.race.webm', 'd/d.race.webm'];
    const html = buildPlayerHtml(summary, videos);
    expect(html).toContain('id="v0"');
    expect(html).toContain('id="v1"');
    expect(html).toContain('id="v2"');
    expect(html).toContain('id="v3"');
    expect(html).toContain('const raceVideos = [v0, v1, v2, v3]');
  });

  it('supports 5 racers with download links', () => {
    const summary = {
      racers: ['r1', 'r2', 'r3', 'r4', 'r5'],
      comparisons: [],
      overallWinner: 'r1',
    };
    const videos = ['r1/r1.webm', 'r2/r2.webm', 'r3/r3.webm', 'r4/r4.webm', 'r5/r5.webm'];
    const altFiles = ['r1/r1.gif', 'r2/r2.gif', 'r3/r3.gif', 'r4/r4.gif', 'r5/r5.gif'];
    const html = buildPlayerHtml(summary, videos, 'gif', altFiles);
    expect(html).toContain('id="v4"');
    expect(html).toContain('r1 (.gif)');
    expect(html).toContain('r5 (.gif)');
    expect(html).toContain('const raceVideos = [v0, v1, v2, v3, v4]');
  });

  it('assigns correct colors to racer labels', () => {
    const summary = {
      racers: ['red', 'blue', 'green'],
      comparisons: [],
      overallWinner: null,
    };
    const videos = ['r/r.webm', 'b/b.webm', 'g/g.webm'];
    const html = buildPlayerHtml(summary, videos);
    expect(html).toContain('style="color: #e74c3c"');
    expect(html).toContain('style="color: #3498db"');
    expect(html).toContain('style="color: #27ae60"');
  });

  it('displays time with milliseconds', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('0:00.000 / 0:00.000');
    expect(html).toContain('id="timeDisplay"');
  });

  it('displays frame number', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('Frame: 0');
    expect(html).toContain('id="frameDisplay"');
    expect(html).toContain('getFrame');
  });

  it('shows mode toggle when full videos provided', () => {
    const fullVideos = ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'];
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { fullVideoFiles: fullVideos });
    expect(html).toContain('id="modeRace"');
    expect(html).toContain('id="modeFull"');
    expect(html).toContain('class="mode-btn active"');
    expect(html).toContain('switchToFull');
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
    const options = { fullVideoFiles: fullVideos, mergedVideoFile: 'merged.webm' };
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, options);
    expect(html).toContain('id="modeRace"');
    expect(html).toContain('id="modeFull"');
    expect(html).toContain('id="modeMerged"');
  });

  it('hides mode toggle when no additional videos', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null);
    expect(html).not.toContain('id="modeFull"');
    expect(html).not.toContain('id="modeMerged"');
  });

  it('includes full video paths in JavaScript', () => {
    const fullVideos = ['lauda/lauda.full.webm', 'hunt/hunt.full.webm'];
    const html = buildPlayerHtml(makeSummary(), videoFiles, null, null, { fullVideoFiles: fullVideos });
    expect(html).toContain('"lauda/lauda.full.webm"');
    expect(html).toContain('"hunt/hunt.full.webm"');
  });

  it('omits profile section when no profileComparison', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).not.toContain('Performance Profile');
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

    // Within the profile section (after "Total Session"), hunt (1000) should appear before lauda (2000)
    const profileStart = html.indexOf('Total Session');
    const profileSection = html.slice(profileStart);
    const huntPos = profileSection.indexOf('>hunt<');
    const laudaPos = profileSection.indexOf('>lauda<');
    expect(huntPos).toBeLessThan(laudaPos);

    // lauda should show a delta in the profile section
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
    const summary = { racers, comparisons: [], overallWinner: null, profileComparison };
    const videos = ['a/a.webm', 'h/h.webm', 'r/r.webm'];
    const html = buildPlayerHtml(summary, videos);

    expect(html).toContain('angular');
    expect(html).toContain('htmx');
    expect(html).toContain('react');
    expect(html).toContain('profile-bar-fill');
    expect(html).toContain('profile-bar-fill');
  });

  it('shows winner video first when hunt wins', () => {
    const summary = makeSummary({
      overallWinner: 'hunt',
      comparisons: [
        { name: 'Load', racers: [{ duration: 2.0 }, { duration: 1.0 }], winner: 'hunt', rankings: ['hunt', 'lauda'] },
      ],
    });
    const html = buildPlayerHtml(summary, videoFiles);
    const laudaPos = html.indexOf('src="lauda/lauda.race.webm"');
    const huntPos = html.indexOf('src="hunt/hunt.race.webm"');
    expect(huntPos).toBeLessThan(laudaPos);
  });

  it('shows winner video first with original colors preserved', () => {
    const summary = makeSummary({
      overallWinner: 'hunt',
      comparisons: [
        { name: 'Load', racers: [{ duration: 2.0 }, { duration: 1.0 }], winner: 'hunt', rankings: ['hunt', 'lauda'] },
      ],
    });
    const html = buildPlayerHtml(summary, videoFiles);
    // hunt (index 1) should appear first but keep its blue color (#3498db)
    const huntLabelMatch = html.match(/color: (#[0-9a-f]+)">hunt/);
    expect(huntLabelMatch[1]).toBe('#3498db');
  });

  it('omits script tag when no videos provided', () => {
    const summary = makeSummary();
    const html = buildPlayerHtml(summary, [], null, null, {
      runNavigation: { currentRun: 'median', totalRuns: 3, pathPrefix: '' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('Results');
  });

  it('shows median page with videos and source note', () => {
    const summary = makeSummary();
    const medianVideos = ['2/lauda/lauda.race.webm', '2/hunt/hunt.race.webm'];
    const html = buildPlayerHtml(summary, medianVideos, null, null, {
      runNavigation: { currentRun: 'median', totalRuns: 3, pathPrefix: '' },
      medianRunLabel: 'Run 2',
    });
    expect(html).toContain('<script>');
    expect(html).toContain('src="2/lauda/lauda.race.webm"');
    expect(html).toContain('Videos from Run 2 (closest to median)');
  });

  it('shows run navigation bar', () => {
    const summary = makeSummary();
    const html = buildPlayerHtml(summary, videoFiles, null, null, {
      runNavigation: { currentRun: 1, totalRuns: 3, pathPrefix: '../' },
    });
    expect(html).toContain('Run 1');
    expect(html).toContain('Run 2');
    expect(html).toContain('Run 3');
    expect(html).toContain('Median');
    expect(html).toContain('run-nav-btn active');
  });
});
