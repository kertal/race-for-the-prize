/**
 * Integration test: verify the player stylesheet resolves to the right computed
 * colours in a real browser.
 *
 * These are cascade properties — specificity, source order and custom-property
 * fallbacks — that no string assertion on the CSS can check. A rule added later
 * in the file can silently override an earlier one of equal specificity, which
 * is exactly how the active run-nav button once lost its inverted label.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlayerHtml } from '../cli/videoplayer.js';
import { buildConditionIndexHtml } from '../cli/condition-matrix.js';
import { RACER_CSS_COLORS } from '../cli/player-sections.js';
import { hasChromiumInstalled } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const summary = {
  racers: ['lauda', 'hunt'],
  comparisons: [
    { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', rankings: ['lauda', 'hunt'] },
  ],
  overallWinner: 'lauda',
  timestamp: new Date().toISOString(),
  settings: {},
  errors: [],
  wins: { lauda: 1, hunt: 0 },
  videos: {},
};
const videoFiles = ['lauda/lauda.race.webm', 'hunt/hunt.race.webm'];
// Run 1 won by lauda, run 2 by hunt, so both run buttons carry a winner tint.
const runSummaries = [summary, { ...summary, overallWinner: 'hunt' }];

const rgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

// Tokens the assertions below pin to, read straight from the stylesheet so a
// deliberate palette change updates the expectations instead of breaking them.
// They name the SEMANTIC role, never the palette entry behind it — repointing
// --accent at a different colour is a restyle, not a regression, and these
// assertions are about the cascade resolving the role, not about its value.
const TOKENS_CSS = fs.readFileSync(path.join(__dirname, '..', 'cli', 'tokens.css'), 'utf-8');
const token = (name) => {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(TOKENS_CSS);
  if (!m) throw new Error(`token ${name} not found in tokens.css`);
  return m[1].trim();
};
/** A token's literal value, following any var(--…) hops down to the palette. */
const resolve = (name, seen = new Set()) => {
  if (seen.has(name)) throw new Error(`token cycle at ${name}`);
  const value = token(name);
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
  return ref ? resolve(ref[1], seen.add(name)) : value;
};
const ACCENT = resolve('--accent');
const ACCENT_CONTRAST = resolve('--accent-contrast');
const TEXT_DIM = resolve('--text-dim');
const TEXT_BRIGHT = resolve('--text-bright');

let browser, page, tmpDir;

const canRun = hasChromiumInstalled(path.resolve(__dirname, '..'));
const describeMaybe = canRun ? describe : describe.skip;

/** Render a player page (optionally skinned) and return its file:// URL. */
function writePlayer(name, options, racers = summary.racers) {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const files = racers.map(r => `${r}/${r}.race.webm`);
  for (const vf of files) fs.mkdirSync(path.join(dir, path.dirname(vf)), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    buildPlayerHtml({ ...summary, racers }, files, null, null, options)
  );
  return `file://${path.join(dir, 'index.html')}`;
}

// Five racers whose names are long enough that no viewport fits the title.
const LONG_RACERS = [
  'chromium-cold-cache-baseline', 'chromium-warm-cache-baseline',
  'chromium-service-worker-precache', 'chromium-http2-push-variant',
  'chromium-brotli-only-variant',
];

describeMaybe('player theming integration', () => {
  beforeAll(async () => {
    tmpDir = path.join(__dirname, '..', 'test-results', 'player-theming-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('run navigation buttons', () => {
    /** Computed colours for every run-nav button on a page. */
    async function runNavStyles(url) {
      await page.goto(url);
      return page.evaluate(() =>
        [...document.querySelectorAll('.run-nav-btn')].map(el => {
          const cs = getComputedStyle(el);
          return {
            label: el.textContent.trim(),
            active: el.classList.contains('active'),
            hasWinner: el.classList.contains('has-winner'),
            color: cs.color,
            borderColor: cs.borderTopColor,
            background: cs.backgroundColor,
          };
        })
      );
    }

    it('keeps the inverted label on an active button that also has a winner tint', async () => {
      // Regression: .run-nav-btn.has-winner has the same specificity as
      // .run-nav-btn.active and comes later, so an unscoped `color` there
      // painted white-on-gold instead of the intended black-on-gold.
      const url = writePlayer('run-1-active', {
        runNavigation: { currentRun: 1, totalRuns: 2, pathPrefix: '../' },
        runSummaries,
      });
      const buttons = await runNavStyles(url);
      const active = buttons.find(b => b.active && b.hasWinner);

      expect(active).toBeTruthy();
      expect(active.label).toBe('Run 1');
      expect(active.color).toBe(rgb(ACCENT_CONTRAST));
      expect(active.background).toBe(rgb(ACCENT));
      // …while still showing that run's winner colour on the border.
      expect(active.borderColor).toBe(rgb(RACER_CSS_COLORS[0]));
    });

    it('brightens the label only on non-active winner buttons', async () => {
      const url = writePlayer('median-active', {
        runNavigation: { currentRun: 'median', totalRuns: 2, pathPrefix: '' },
        runSummaries,
      });
      const buttons = await runNavStyles(url);
      const [run1, run2] = buttons.filter(b => b.hasWinner);

      expect(run1.color).toBe(rgb(TEXT_BRIGHT));
      expect(run1.borderColor).toBe(rgb(RACER_CSS_COLORS[0]));
      expect(run2.color).toBe(rgb(TEXT_BRIGHT));
      expect(run2.borderColor).toBe(rgb(RACER_CSS_COLORS[1]));

      // The active "Median" button carries no winner tint and stays inverted.
      const median = buttons.find(b => b.active);
      expect(median.hasWinner).toBe(false);
      expect(median.color).toBe(rgb(ACCENT_CONTRAST));
    });

    it('leaves a tie-run button on the neutral resting colours', async () => {
      const url = writePlayer('tie-run', {
        runNavigation: { currentRun: 'median', totalRuns: 1, pathPrefix: '' },
        runSummaries: [{ ...summary, overallWinner: 'tie' }],
      });
      const buttons = await runNavStyles(url);
      const run1 = buttons.find(b => b.label === 'Run 1');

      expect(run1.hasWinner).toBe(false);
      expect(run1.color).toBe(rgb(TEXT_DIM));
    });
  });

  describe('--racer-color custom property', () => {
    it('tints racer elements from the inline property', async () => {
      await page.goto(writePlayer('racer-colors', {}));
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('.racer-label')].map(el => getComputedStyle(el).color)
      );
      // Placement order puts the winner (lauda, colour index 0) first.
      expect(labels).toEqual([rgb(RACER_CSS_COLORS[0]), rgb(RACER_CSS_COLORS[1])]);
    });

    it('falls back to the neutral token where no racer colour is set', async () => {
      await page.goto(writePlayer('racer-fallback', {}));
      const fallback = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.className = 'racer-name';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      // --racer-color is unset, so .racer-name must resolve to --text.
      expect(fallback).toBe(rgb(resolve('--text')));
    });
  });

  describe('condition overview', () => {
    /** The cross-condition comparison page, which shares the player's tokens. */
    function writeMatrix(name, options, raceTitle = 'lauda vs hunt') {
      const dir = path.join(tmpDir, name);
      fs.mkdirSync(dir, { recursive: true });
      const entries = [
        { label: 'none-cpu1', network: 'none', cpu: 1, summary },
        { label: 'slow-3g-cpu1', network: 'slow-3g', cpu: 1, summary: { ...summary, overallWinner: 'hunt' } },
      ];
      fs.writeFileSync(path.join(dir, 'index.html'), buildConditionIndexHtml(raceTitle, entries, options));
      return `file://${path.join(dir, 'index.html')}`;
    }

    /** Card background, winner label colour and page ground, as rendered. */
    const readCard = () => page.evaluate(() => {
      const card = document.querySelector('td a');
      const win = document.querySelector('.r.win');
      return {
        page: getComputedStyle(document.body).backgroundColor,
        card: getComputedStyle(card).backgroundColor,
        winner: getComputedStyle(win).color,
        verdict: getComputedStyle(document.querySelector('.verdict')).color,
      };
    });

    it('renders on the same palette as the player', async () => {
      await page.goto(writeMatrix('matrix-default', {}));
      const seen = await readCard();
      expect(seen.page).toBe(rgb(resolve('--bg')));
      expect(seen.card).toBe(rgb(resolve('--surface')));
      expect(seen.winner).toBe(rgb(resolve('--text')));
      // The verdict is tinted with the winning racer's own colour.
      expect(seen.verdict).toBe(rgb(RACER_CSS_COLORS[0]));
    });

    it('is framed exactly like the player it links to', async () => {
      // "Dressed like the player" measured rather than inferred from shared
      // tokens: a reader clicking a cell moves between these two pages, so the
      // frame around the content — both bands and the column they bracket —
      // has to be the same object, not merely a similar-looking one.
      const readFrame = () => page.evaluate(() => {
        const band = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const style = getComputedStyle(el);
          const texture = getComputedStyle(el, '::before');
          return {
            height: Math.round(el.getBoundingClientRect().height),
            position: style.position,
            background: style.backgroundColor,
            borders: `${style.borderTopWidth} ${style.borderBottomWidth} ${style.borderBottomColor}`,
            texture: texture.backgroundImage,
            tile: texture.backgroundSize,
            mask: texture.maskImage,
          };
        };
        const title = getComputedStyle(document.querySelector('h1'));
        // .wrap on the overview, .controls on the player: each page's own
        // content column, which should come out the same width.
        const column = document.querySelector('.wrap, .controls');
        return {
          head: band('.race-header'),
          foot: band('.checkered-bar'),
          columnWidth: getComputedStyle(column).maxWidth,
          footGutter: getComputedStyle(document.body).paddingBottom,
          titleFont: `${title.fontFamily}|${title.fontWeight}|${title.fontStyle}`,
          titleColor: title.color,
          titleText: document.querySelector('h1').textContent.trim(),
        };
      });

      await page.goto(writePlayer('frame-player', {}));
      const player = await readFrame();
      await page.goto(writeMatrix('frame-matrix', {}));
      const matrix = await readFrame();

      expect(matrix).toEqual(player);
      // Same words, too — the product, then the race, on both pages.
      expect(matrix.titleText).toBe('\u{1F3C1} Race for the Prize: lauda vs hunt');
      // Both ends are flagged, and the head rides along as the page scrolls.
      expect(matrix.head.position).toBe('sticky');
      expect(matrix.foot.position).toBe('fixed');
      expect(matrix.head.mask).not.toBe('none');
      expect(matrix.foot.mask).not.toBe('none');
      // The foot is fixed, so the page has to reserve its height.
      expect(matrix.footGutter).toBe(`${matrix.foot.height}px`);
    });

    it('cuts a title too long to fit short, without growing the band', async () => {
      // Five long racer names used to wrap to four lines and push the overview's
      // band from 36px to 156px. The h1 is a flex item, so it needs min-width:0
      // before text-overflow can do anything.
      const read = () => page.evaluate(() => {
        const title = document.querySelector('h1');
        return {
          bandHeight: Math.round(document.querySelector('.race-header').getBoundingClientRect().height),
          truncated: title.scrollWidth > title.clientWidth + 1,
          ellipsis: getComputedStyle(title).textOverflow,
          wraps: getComputedStyle(title).whiteSpace !== 'nowrap',
          // Cut short on screen, still readable in full on hover.
          tooltip: title.getAttribute('title'),
        };
      });

      for (const width of [1400, 600, 360]) {
        await page.setViewportSize({ width, height: 400 });

        await page.goto(writePlayer(`long-player-${width}`, {}, LONG_RACERS));
        const player = await read();
        await page.goto(writeMatrix(`long-matrix-${width}`, {}, LONG_RACERS.join(' vs ')));
        const matrix = await read();

        for (const [name, band] of [['player', player], ['overview', matrix]]) {
          expect.soft(band.bandHeight, `${name} @${width}px band height`).toBe(36);
          expect.soft(band.truncated, `${name} @${width}px truncated`).toBe(true);
          expect.soft(band.ellipsis, `${name} @${width}px`).toBe('ellipsis');
          expect.soft(band.wraps, `${name} @${width}px wraps`).toBe(false);
          expect.soft(band.tooltip, `${name} @${width}px tooltip`).toContain('chromium-brotli-only-variant');
        }
        // The two pages cut it short the same way, at every width.
        expect.soft(matrix, `@${width}px`).toEqual(player);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    });

    it('follows a skin, so the whole report set themes together', async () => {
      await page.goto(writeMatrix('matrix-light', { skin: 'light' }));
      const seen = await readCard();

      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
      expect(seen.page).toBe(rgb('#f6f3ec'));
      // Regression: the card once kept a dark-theme background under a light
      // skin, because it read a palette ink no skin remaps. It must track the
      // skin's own surface, and the winner's label must stay legible on it.
      expect(seen.card).toBe(rgb('#ffffff'));
      expect(seen.winner).toBe(rgb('#23201a'));
      // Cards must never end up darker than the page they sit on.
      const luma = (c) => c.match(/\d+/g).slice(0, 3).reduce((a, v) => a + Number(v), 0);
      expect(luma(seen.card)).toBeGreaterThan(luma(seen.page));
    });

    it('keeps racer tints independent of the skin', async () => {
      await page.goto(writeMatrix('matrix-neon', { skin: 'neon' }));
      // Every metric is rendered up front with one block visible, so scope to
      // the first card's visible block rather than sweeping the whole page.
      const names = await page.evaluate(() =>
        [...document.querySelector('td a').querySelectorAll('.m:not([hidden]) .r .n')]
          .map(el => getComputedStyle(el).color)
      );
      expect(names).toEqual([rgb(RACER_CSS_COLORS[0]), rgb(RACER_CSS_COLORS[1])]);
    });
  });

  describe('skins', () => {
    it('repaints the page from token overrides alone', async () => {
      const read = () => page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        background: getComputedStyle(document.body).backgroundColor,
        heading: getComputedStyle(document.querySelector('h1')).color,
        band: getComputedStyle(document.querySelector('.race-header'), '::before').backgroundImage,
      }));

      await page.goto(writePlayer('skin-none', {}));
      const dark = await read();

      await page.goto(writePlayer('skin-light', { skin: 'light' }));
      const light = await read();

      expect(light.theme).toBe('light');
      // The skin's own --bg and --text-muted, not the default dark ones.
      expect(light.background).not.toBe(dark.background);
      expect(light.background).toBe(rgb('#f6f3ec'));
      expect(light.heading).not.toBe(dark.heading);
      expect(light.heading).toBe(rgb('#3d382e'));
      // Right down to the wash in the title band, which would otherwise be a
      // white texture laid over a cream ground.
      expect(light.band).not.toBe(dark.band);
    });

    it('keeps racer tints independent of the skin', async () => {
      await page.goto(writePlayer('skin-racer', { skin: 'neon' }));
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('.racer-label')].map(el => getComputedStyle(el).color)
      );
      expect(labels).toEqual([rgb(RACER_CSS_COLORS[0]), rgb(RACER_CSS_COLORS[1])]);
    });
  });
});
