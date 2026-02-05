import { describe, it, expect } from 'vitest';
import { buildPlayerHtml } from '../cli/videoplayer.js';

const makeSummary = (overrides = {}) => ({
  racers: ['lauda', 'hunt'],
  comparisons: [
    { name: 'Load', racers: [{ duration: 1.0 }, { duration: 2.0 }], winner: 'lauda', diff: 1.0, diffPercent: 100.0 },
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

  it('includes results table with measurement data', () => {
    const html = buildPlayerHtml(makeSummary(), videoFiles);
    expect(html).toContain('1.000s');
    expect(html).toContain('2.000s');
    expect(html).toContain('100.0%');
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
    expect(html).toContain('<tbody>');
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
    expect(html).toContain('<th>alpha</th>');
    expect(html).toContain('<th>beta</th>');
    expect(html).toContain('<th>gamma</th>');
    expect(html).toContain('const videos = [v0, v1, v2]');
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
    expect(html).toContain('const videos = [v0, v1, v2, v3]');
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
    expect(html).toContain('const videos = [v0, v1, v2, v3, v4]');
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
});
