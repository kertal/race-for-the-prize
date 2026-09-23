import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MAX_RACERS } from '../cli/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const indexHtml = read('docs', 'index.html');
const siteCss = read('docs', 'site.css');
const tokensCss = read('cli', 'tokens.css');
const readme = read('ReadMe.md');

/** Every `--token: value;` declaration in a stylesheet, last one wins. */
function declaredTokens(css) {
  const tokens = {};
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

describe('landing page', () => {
  it('is flagged at both ends, the way a race report is', () => {
    expect(indexHtml).toContain('<header class="race-header">');
    expect(indexHtml).toContain('<div class="checkered-bar"></div>');
    for (const band of ['.race-header::before', '.checkered-bar::before']) {
      expect(siteCss).toContain(band);
    }
    expect(siteCss).toContain('repeating-conic-gradient(var(--checker-wash) 0% 25%, transparent 0% 50%)');
  });

  it('runs the same black track and white type as the player', () => {
    const site = declaredTokens(siteCss);
    expect(site['--bg']).toBe('var(--color-ink-900)');
    expect(site['--text']).toBe('var(--color-white)');
    expect(siteCss).toContain('background: var(--bg);');
  });

  it('keeps every mirrored token at the value cli/tokens.css gives it', () => {
    const site = declaredTokens(siteCss);
    const tokens = declaredTokens(tokensCss);
    const shared = Object.keys(site).filter(name => name in tokens);
    // Guard against the mirror quietly emptying out.
    expect(shared.length).toBeGreaterThan(20);
    for (const name of shared) {
      expect(`${name}: ${site[name]}`).toBe(`${name}: ${tokens[name]}`);
    }
  });

  it('loads no third-party scripts or stylesheets', () => {
    expect(indexHtml).not.toMatch(/<script/i);
    // Read every <link> tag whole: rel and href arrive in either order, and a
    // remote stylesheet added after the local one has to fail this.
    const stylesheets = [...indexHtml.matchAll(/<link\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter(tag => /\brel\s*=\s*"stylesheet"/i.test(tag))
      .map(tag => tag.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1]);
    expect(stylesheets).toEqual(['site.css']);
  });

  it('links only to files that exist, or to absolute URLs', () => {
    const hrefs = [...indexHtml.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
    const local = hrefs.filter(h => !/^(https?:|data:|#|mailto:)/.test(h));
    expect(local.length).toBeGreaterThan(0);
    for (const href of local) {
      expect(fs.existsSync(path.join(ROOT, 'docs', href))).toBe(true);
    }
  });

  it('ships .nojekyll so GitHub Pages serves the folder as written', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', '.nojekyll'))).toBe(true);
  });
});

describe('ReadMe', () => {
  const DOCS = ['demos', 'writing-races', 'use-cases', 'cli', 'results', 'development', 'skinning'];

  it('stays a summary rather than the whole handbook', () => {
    expect(readme.split('\n').length).toBeLessThan(120);
  });

  it('points at every doc in the handbook', () => {
    for (const doc of DOCS) {
      expect(readme).toContain(`docs/${doc}.md`);
    }
  });

  it('only links to files that exist', () => {
    const links = [...readme.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
    const local = links.filter(h => !/^(https?:|#|mailto:)/.test(h));
    for (const link of local) {
      expect(fs.existsSync(path.join(ROOT, link.split('#')[0]))).toBe(true);
    }
  });
});

describe('the documented racer cap', () => {
  // The landing page said "2&nbsp;to&nbsp;5" long after the CLI stopped
  // allowing five, and a plain-text search never found it because of the
  // entities. Every page that quotes a capacity is checked here, entities
  // folded away first, so the next change to MAX_RACERS cannot leave one
  // behind.
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const PAGES = ['index.html', 'cli.md', 'demos.md', 'writing-races.md', 'use-cases.md', 'results.md', 'development.md', 'skinning.md']
    .map(name => [`docs/${name}`, read('docs', name)]);
  PAGES.push(['ReadMe.md', readme]);

  const plain = (text) => text.replace(/&nbsp;|&#160;/g, ' ');

  for (const [name, body] of PAGES) {
    it(`${name} quotes the real cap`, () => {
      const text = plain(body);
      for (const [claim, digits] of text.matchAll(/\b2\s*(?:to|[-\u2013\u2014])\s*(\d+)\b/g)) {
        expect(Number(digits), `"${claim}" in ${name}`).toBe(MAX_RACERS);
      }
      for (const [claim, word] of text.matchAll(/\btwo to (\w+)\b/gi)) {
        expect(word.toLowerCase(), `"${claim}" in ${name}`).toBe(NUMBER_WORDS[MAX_RACERS]);
      }
    });
  }
});

describe('the split handbook', () => {
  // Identifiers, never prose: a page may be rewritten freely, but the API,
  // flags and filenames that moved out of the ReadMe have to still be here.
  const pages = {
    'demos.md': ['demo:lauda-vs-hunt', 'demo:caching-comparison'],
    'writing-races.md': ['race.spec.js', 'raceWaitForVisualStability', 'RACE_VAR_', 'teardown.sh'],
    'use-cases.md': ['race.vars.URL', '--cpu=1,4'],
    'cli.md': ['--network=slow-3g', '--cue-markers', 'cpuThrottle', 'fast-3g'],
    'results.md': ['summary.json', 'config.json', 'measurements.json'],
    'development.md': ['npm run test:integration', 'npm link', 'videoplayer.js', 'runner-protocol.cjs'],
  };

  for (const [page, needles] of Object.entries(pages)) {
    it(`${page} carries the sections that left the ReadMe`, () => {
      const body = read('docs', page);
      expect(body.startsWith('# ')).toBe(true);
      for (const needle of needles) expect(body).toContain(needle);
    });
  }

  it('links between pages resolve inside docs/', () => {
    for (const page of Object.keys(pages)) {
      const body = read('docs', page);
      const links = [...body.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
      for (const link of links.filter(h => !/^(https?:|#|mailto:)/.test(h))) {
        expect(fs.existsSync(path.join(ROOT, 'docs', link.split('#')[0]))).toBe(true);
      }
    }
  });
});
