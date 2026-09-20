import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  planSiteBundle,
  writeSiteBundle,
  tryWriteSiteBundle,
  BUNDLE_SUFFIX,
  PUBLISHING_FILE,
} from '../cli/site-bundle.js';

let tmpDir;
let resultsDir;

/** A stand-in for what a two-condition race leaves behind. */
function buildResultsTree(dir) {
  const write = (rel, content) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('index.html', '<html>matrix</html>');
  write('config.json', '{"cpu":[1,4]}');
  for (const condition of ['cpu1x', 'cpu4x']) {
    // Shaped like a real player's Files section, which links every artefact it
    // recorded — HAR included, which the bundle leaves out.
    write(`${condition}/index.html`, [
      `<html><body><div class="file-links">`,
      `<a href="alpha/alpha.race.webm" >alpha (race)</a>`,
      `<a href="alpha/alpha.trace.json" title="Open in chrome://tracing">alpha (profile)</a>`,
      `<a href="alpha/alpha.har" download title="HTTP Archive">alpha (HAR)</a>`,
      `<a href="bravo/bravo.har" download title="HTTP Archive">bravo (HAR)</a>`,
      `<a href="race.spec.js" title="Race script">race.spec.js (script)</a>`,
      `</div></body></html>`,
    ].join('\n'));
    write(`${condition}/summary.json`, '{"racers":["alpha","bravo"]}');
    write(`${condition}/README.md`, '# results');
    for (const racer of ['alpha', 'bravo']) {
      write(`${condition}/${racer}/${racer}.race.webm`, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3]));
      write(`${condition}/${racer}/${racer}.trace.json`, JSON.stringify({ traceEvents: Array(50).fill({ ph: 'X' }) }));
      write(`${condition}/${racer}/measurements.json`, '[]');
    }
    // Left out of the bundle: the in-page converter and the network capture.
    write(`${condition}/ffmpeg/ffmpeg-core.wasm`, Buffer.alloc(64, 7));
    write(`${condition}/ffmpeg/index.js`, 'export default 1;');
    write(`${condition}/alpha/alpha.har`, '{"log":{"entries":[]}}');
  }
}

/** Read the finished archive back with python's zipfile — a real implementation. */
function inspectZip(zipPath) {
  const json = execFileSync('python3', ['-c', `
import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, 'corrupt entry'
print(json.dumps({
    'names': sorted(z.namelist()),
    'methods': {i.filename: i.compress_type for i in z.infolist()},
    'sizes': {i.filename: [i.compress_size, i.file_size] for i in z.infolist()},
    'index': z.read([n for n in z.namelist() if n.endswith('/index.html') and n.count('/') == 1][0]).decode(),
}))
`, zipPath], { encoding: 'utf-8' });
  return JSON.parse(json);
}

/** One entry's text, straight from python's zipfile (which verifies its CRC). */
function readZipEntry(zipPath, entryName) {
  return execFileSync('python3', ['-c', `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
sys.stdout.write(z.read(sys.argv[2]).decode())
`, zipPath, entryName], { encoding: 'utf-8' });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-bundle-'));
  resultsDir = path.join(tmpDir, 'results-2026-01-02_03-04-05-abc123');
  fs.mkdirSync(resultsDir);
  buildResultsTree(resultsDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('planSiteBundle', () => {
  it('lists every result file as a sorted, relative, posix path', () => {
    const files = planSiteBundle(resultsDir);
    expect(files).toContain('index.html');
    expect(files).toContain('cpu1x/alpha/alpha.race.webm');
    expect(files).toEqual([...files].sort());
    expect(files.every(f => !f.startsWith('/') && !f.includes('\\'))).toBe(true);
  });

  it('leaves out the ffmpeg.wasm converter — tooling, not results', () => {
    expect(planSiteBundle(resultsDir).filter(f => f.includes('ffmpeg'))).toEqual([]);
  });

  it('leaves out HAR captures, which carry request and response headers', () => {
    expect(planSiteBundle(resultsDir).filter(f => f.endsWith('.har'))).toEqual([]);
  });

  it('keeps the traces the per-condition players link to', () => {
    expect(planSiteBundle(resultsDir).filter(f => f.endsWith('.trace.json'))).toHaveLength(4);
  });

  it('never packs a bundle into the next one', () => {
    fs.writeFileSync(path.join(resultsDir, `old${BUNDLE_SUFFIX}`), 'PK');
    expect(planSiteBundle(resultsDir).filter(f => f.endsWith('.zip'))).toEqual([]);
  });
});

describe('writeSiteBundle', () => {
  it('writes an archive a real unzip implementation reads without complaint', () => {
    const bundle = writeSiteBundle(resultsDir);
    expect(bundle.name).toBe(`${path.basename(resultsDir)}${BUNDLE_SUFFIX}`);
    expect(bundle.path).toBe(path.join(resultsDir, bundle.name));
    expect(fs.statSync(bundle.path).size).toBe(bundle.bytes);
    // testzip() inside inspectZip verifies every entry's CRC against its data,
    // which is what proves the deflated entries were written correctly.
    expect(inspectZip(bundle.path).names.length).toBe(bundle.files);
  });

  it('puts everything under one folder, so unzipping lands a single directory', () => {
    const root = path.basename(resultsDir);
    const { names } = inspectZip((writeSiteBundle(resultsDir)).path);
    expect(names.every(n => n.startsWith(`${root}/`))).toBe(true);
    expect(names).toContain(`${root}/index.html`);
    expect(names).toContain(`${root}/cpu4x/bravo/bravo.race.webm`);
  });

  it('adds the two files a published copy needs and the race never wrote', () => {
    const root = path.basename(resultsDir);
    const { names } = inspectZip((writeSiteBundle(resultsDir)).path);
    // .nojekyll is what stops GitHub Pages running the tree through Jekyll.
    expect(names).toContain(`${root}/.nojekyll`);
    expect(names).toContain(`${root}/${PUBLISHING_FILE}`);
  });

  it('carries the page through byte for byte', () => {
    const { index } = inspectZip((writeSiteBundle(resultsDir)).path);
    expect(index).toBe(fs.readFileSync(path.join(resultsDir, 'index.html'), 'utf-8'));
  });

  it('deflates text but stores video, which deflate cannot improve', () => {
    const root = path.basename(resultsDir);
    const { methods, sizes } = inspectZip((writeSiteBundle(resultsDir)).path);
    const trace = `${root}/cpu1x/alpha/alpha.trace.json`;
    expect(methods[trace]).toBe(8); // deflated
    expect(sizes[trace][0]).toBeLessThan(sizes[trace][1]);
    expect(methods[`${root}/cpu1x/alpha/alpha.race.webm`]).toBe(0); // stored
  });

  it('drops the links to files it left out, so no anchor 404s once published', () => {
    const root = path.basename(resultsDir);
    const page = readZipEntry(writeSiteBundle(resultsDir).path, `${root}/cpu1x/index.html`);
    // The HAR files are not in the bundle; their links must not be either.
    expect(page).not.toContain('.har');
    expect(page).not.toContain('(HAR)');
    // Everything the bundle does carry keeps its link.
    expect(page).toContain('alpha/alpha.race.webm');
    expect(page).toContain('alpha/alpha.trace.json');
    expect(page).toContain('race.spec.js');
  });

  it('leaves a page alone when it links nothing the bundle skipped', () => {
    const root = path.basename(resultsDir);
    const onDisk = fs.readFileSync(path.join(resultsDir, 'index.html'), 'utf-8');
    expect(readZipEntry(writeSiteBundle(resultsDir).path, `${root}/index.html`)).toBe(onDisk);
  });

  it('removes a half-written archive rather than leaving a broken download', () => {
    const root = path.basename(resultsDir);
    const doomed = path.join(resultsDir, 'gone.json');
    fs.writeFileSync(doomed, '{}');
    // Vanishes between the walk and the read, the way a concurrent cleanup would.
    const realRead = fs.readFileSync;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...rest) => {
      if (String(p) === doomed) throw new Error('ENOENT: vanished');
      return realRead(p, ...rest);
    });
    try {
      expect(() => writeSiteBundle(resultsDir)).toThrow(/vanished/);
      expect(fs.existsSync(path.join(resultsDir, `${root}${BUNDLE_SUFFIX}`))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('excludes its own predecessor when a directory is bundled twice', () => {
    const first = writeSiteBundle(resultsDir);
    const second = writeSiteBundle(resultsDir);
    expect(second.files).toBe(first.files);
    expect(inspectZip(second.path).names.filter(n => n.endsWith('.zip'))).toEqual([]);
  });

  it('reports a size the page can print beside the link', () => {
    const bundle = writeSiteBundle(resultsDir);
    expect(bundle.size).toMatch(/^[\d.]+ (B|KB|MB|GB)$/);
  });
});

describe('tryWriteSiteBundle', () => {
  it('warns and returns null rather than costing the race its results', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bundle = tryWriteSiteBundle(path.join(tmpDir, 'no-such-race'));
      expect(bundle).toBeNull();
      expect(warn.mock.calls.flat().join(' ')).toContain('Could not bundle results');
    } finally {
      warn.mockRestore();
    }
  });
});
