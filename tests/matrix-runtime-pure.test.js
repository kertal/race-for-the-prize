/**
 * Behavioral tests for the pure logic of the condition overview's browser
 * runtime (cli/matrix-runtime/*.cjs). These files are concatenated into the
 * generated page's IIFE for the browser, and expose a guarded module.exports
 * so Node can require() them directly.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isBundleablePath,
  bundleablePaths,
  dirName,
  joinPath,
  zipEntryName,
  assetPathsFrom,
  formatSize,
} = require('../cli/matrix-runtime/bundle-paths.cjs');

describe('isBundleablePath', () => {
  it('accepts the relative paths a results page links', () => {
    expect(isBundleablePath('index.html')).toBe(true);
    expect(isBundleablePath('slow-3g-cpu4x/index.html')).toBe(true);
    expect(isBundleablePath('lauda.race.webm')).toBe(true);
  });

  it('rejects anything that is not ours to fetch', () => {
    expect(isBundleablePath('data:video/webm;base64,AAA')).toBe(false);
    expect(isBundleablePath('https://example.com/x.webm')).toBe(false);
    expect(isBundleablePath('blob:null/1234')).toBe(false);
    expect(isBundleablePath('#section')).toBe(false);
  });

  it('rejects paths that would land outside the results directory', () => {
    // The ZIP mirrors the results folder, so an entry above its root — or one
    // anchored at the server root — has nowhere to go inside the archive.
    expect(isBundleablePath('../secrets.json')).toBe(false);
    expect(isBundleablePath('a/../../etc/passwd')).toBe(false);
    expect(isBundleablePath('/etc/passwd')).toBe(false);
  });

  it('rejects empty and non-string values', () => {
    expect(isBundleablePath('')).toBe(false);
    expect(isBundleablePath(null)).toBe(false);
    expect(isBundleablePath(undefined)).toBe(false);
  });

  it('keeps a name that merely contains dots', () => {
    expect(isBundleablePath('lauda..webm')).toBe(true);
    expect(isBundleablePath('./lauda.webm')).toBe(true);
  });
});

describe('bundleablePaths', () => {
  it('drops duplicates in first-seen order', () => {
    expect(bundleablePaths(['a.webm', 'b.webm', 'a.webm'])).toEqual(['a.webm', 'b.webm']);
  });

  it('filters out what does not belong in the archive', () => {
    expect(bundleablePaths(['a.webm', 'data:x', '', '/abs'])).toEqual(['a.webm']);
  });
});

describe('dirName and joinPath', () => {
  it('resolves a page link against the page that carries it', () => {
    expect(dirName('slow-3g-cpu4x/index.html')).toBe('slow-3g-cpu4x');
    expect(joinPath('slow-3g-cpu4x', 'lauda.race.webm')).toBe('slow-3g-cpu4x/lauda.race.webm');
  });

  it('leaves the links of a page at the root where they are', () => {
    expect(dirName('index.html')).toBe('');
    expect(joinPath('', 'lauda.race.webm')).toBe('lauda.race.webm');
  });
});

describe('zipEntryName', () => {
  it('names an entry by its path in the results directory', () => {
    expect(zipEntryName('slow-3g-cpu4x/index.html')).toBe('slow-3g-cpu4x/index.html');
  });

  it('decodes the escaping the link needed, so the folder unzips under its real name', () => {
    expect(zipEntryName('cache%20on-cpu4x/index.html')).toBe('cache on-cpu4x/index.html');
  });

  it('drops a query or hash rather than baking it into a filename', () => {
    expect(zipEntryName('x/index.html?v=2#top')).toBe('x/index.html');
  });

  it('leaves a lone percent alone instead of throwing', () => {
    expect(zipEntryName('100%/index.html')).toBe('100%/index.html');
  });
});

describe('assetPathsFrom', () => {
  it('collects the Files section, the video sources and the race config', () => {
    const paths = assetPathsFrom({
      links: ['lauda.race.webm', 'lauda.trace.json', 'settings.json'],
      videos: ['lauda.race.webm'],
      configJson: JSON.stringify({ raceVideoPaths: ['lauda.race.webm'], fullVideoPaths: ['lauda.full.webm'] }),
    });

    // Every distinct file exactly once, links first.
    expect(paths).toEqual(['lauda.race.webm', 'lauda.trace.json', 'settings.json', 'lauda.full.webm']);
  });

  it('skips videos already embedded in the page', () => {
    const paths = assetPathsFrom({
      videos: ['data:video/webm;base64,AAAA'],
      configJson: JSON.stringify({ raceVideoPaths: ['data:video/webm;base64,AAAA', 'hunt.race.webm'] }),
    });

    expect(paths).toEqual(['hunt.race.webm']);
  });

  it('still bundles the links when the race config is unreadable', () => {
    expect(assetPathsFrom({ links: ['lauda.race.webm'], configJson: '{ not json' }))
      .toEqual(['lauda.race.webm']);
  });

  it('survives a page with nothing to bundle', () => {
    expect(assetPathsFrom({})).toEqual([]);
    expect(assetPathsFrom({ links: [], videos: [], configJson: null })).toEqual([]);
  });

  it('ignores config entries that are not lists of paths', () => {
    expect(assetPathsFrom({ configJson: JSON.stringify({ raceVideoPaths: 'nope', fullVideoPaths: [null, ''] }) }))
      .toEqual([]);
  });
});

describe('formatSize', () => {
  it('scales to the unit that reads shortest', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('starts at zero bytes', () => {
    expect(formatSize(0)).toBe('0 B');
  });
});
