import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MAX_RACERS } from '../cli/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const indexHtml = read('docs', 'index.html');
const creditsHtml = read('docs', 'credits.html');
const creditsMd = read('docs', 'credits.md');
const siteCss = read('docs', 'site.css');
const tokensCss = read('cli', 'tokens.css');
const readme = read('ReadMe.md');

/** Every page GitHub Pages serves from `docs/`, by filename. */
const sitePages = { 'index.html': indexHtml, 'credits.html': creditsHtml };

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
    for (const [name, html] of Object.entries(sitePages)) {
      expect(html, name).toContain('<header class="race-header">');
      expect(html, name).toContain('<div class="checkered-bar"></div>');
    }
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
    for (const [name, html] of Object.entries(sitePages)) {
      expect(html, name).not.toMatch(/<script/i);
      // Read every <link> tag whole: rel and href arrive in either order, and a
      // remote stylesheet added after the local one has to fail this.
      const stylesheets = [...html.matchAll(/<link\b[^>]*>/g)]
        .map(([tag]) => tag)
        .filter(tag => /\brel\s*=\s*"stylesheet"/i.test(tag))
        .map(tag => tag.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1]);
      expect(stylesheets, name).toEqual(['site.css']);
    }
  });

  it('links only to files that exist, or to absolute URLs', () => {
    for (const [name, html] of Object.entries(sitePages)) {
      const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
      const local = hrefs.filter(h => !/^(https?:|data:|#|mailto:)/.test(h));
      expect(local.length, name).toBeGreaterThan(0);
      for (const href of local) {
        expect(fs.existsSync(path.join(ROOT, 'docs', href)), `${name} → ${href}`).toBe(true);
      }
    }
  });

  it('sends readers to the credits from the front page', () => {
    expect(indexHtml).toContain('href="credits.html"');
  });

  it('ships .nojekyll so GitHub Pages serves the folder as written', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', '.nojekyll'))).toBe(true);
  });
});

describe('credits', () => {
  // The two pages point at each other, which is navigation rather than a
  // credit — everything else they link to has to match.
  const isNavigation = url =>
    url.startsWith('https://kertal.github.io/race-for-the-prize/') ||
    url.startsWith('https://github.com/kertal/race-for-the-prize/blob/');

  const credited = urls => [...new Set(urls.filter(u => /^https?:/.test(u) && !isNavigation(u)))].sort();

  /** The rendered body, so the shared header's repo link stays out of it. */
  const creditsBody = creditsHtml.match(/<main>([\s\S]*)<\/main>/)[1];

  it('is served as HTML too, because .nojekyll leaves Markdown unrendered', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'credits.html'))).toBe(true);
    expect(creditsMd.startsWith('# Credits')).toBe(true);
    expect(creditsHtml).toContain('<title>Credits — RaceForThePrize</title>');
  });

  it('credits the same names in the Markdown and on the site', () => {
    const fromMd = credited([...creditsMd.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]));
    const fromHtml = credited([...creditsBody.matchAll(/href="([^"]+)"/g)].map(m => m[1]));
    // Guard against the mirror quietly emptying out.
    expect(fromMd.length).toBeGreaterThan(10);
    expect(fromHtml).toEqual(fromMd);
  });

  it('names the crew, the dependencies and the song', () => {
    for (const needle of ['Playwright', 'FFmpeg', 'Vitest', 'The Flaming Lips', '@kertal', 'MIT']) {
      expect(creditsMd, needle).toContain(needle);
    }
  });

  it('is reachable from the ReadMe and the landing page', () => {
    expect(readme).toContain('docs/credits.md');
    expect(indexHtml).toContain('credits.html');
  });

  it('ships with the npm package, like the rest of the handbook', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.files).toContain('docs/credits.md');
  });
});

describe('ReadMe', () => {
  const DOCS = ['demos', 'writing-races', 'use-cases', 'cli', 'results', 'development', 'skinning', 'credits'];

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
    'credits.md': ['playwright.dev', 'ffmpeg.org', 'flaminglips.com', 'credits.html'],
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
