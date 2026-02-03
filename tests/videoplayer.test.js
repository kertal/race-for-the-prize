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
});
