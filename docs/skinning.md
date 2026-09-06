# Skinning the results player

The HTML reports RaceForThePrize writes — the results player at
`results-*/index.html`, and the cross-condition overview that a multi-condition
race puts above it — are styled from one shared set of design tokens,
[`cli/tokens.css`](../cli/tokens.css), inlined into each page at build time
ahead of that page's component rules:

| File | Role |
|---|---|
| [`cli/tokens.css`](../cli/tokens.css) | Layers 1–2: the palette and semantic roles. Both pages inline it, so they cannot drift apart. |
| [`cli/player.css`](../cli/player.css) | Layer 3 for the results player. |
| `INDEX_CSS` in [`cli/condition-matrix.js`](../cli/condition-matrix.js) | Layer 3 for the condition overview. |

Together they form three layers, so a report can be re-themed without touching a
single component rule:

| Layer | What lives there | Example |
|---|---|---|
| **1. Palette** | Raw colours and type faces | `--color-gold: #d4af37` |
| **2. Semantic roles** | What a colour *means* | `--accent: var(--color-gold)` |
| **3. Components** | The widgets themselves | `.play-btn { background: var(--accent) }` |

Both component layers contain **no literal colours, fonts, radii, or durations**,
and never reach past the semantic roles into the raw palette — every value comes
from a semantic token. Tests enforce both rules on both stylesheets. A skin is
therefore just a CSS file that redefines tokens: there is no build step, no
preprocessor, and no need to keep a fork of the stylesheet in sync.

Because both pages read the same tokens, one `--skin` themes the whole report
set — the overview and every per-condition player it links to.

## Using a skin

```bash
node race.js ./races/lauda-vs-hunt --skin=light      # built-in skin
node race.js ./races/lauda-vs-hunt --skin=neon       # built-in skin
node race.js ./races/lauda-vs-hunt --skin=./team.css # your own file
```

or in the race directory's `settings.json`:

```json
{ "skin": "light" }
```

Built-in skins live in [`cli/skins/`](../cli/skins). A path ending in `.css` is
resolved relative to the race directory first, then to the current working
directory. An unknown name or missing file fails immediately, before the race
runs.

The skin is inlined into the exported HTML, so it survives **Export Zip** and
**Export HTML** — a shared report keeps its theme.

## Writing a skin

Create a CSS file that redefines tokens under
`:root[data-theme="<name>"]`, where `<name>` is the file's basename. The player
stamps that name onto `<html data-theme="…">`, so several skins can coexist in
one document.

```css
/* team.css — used as --skin=./team.css, so the selector is [data-theme="team"] */
:root[data-theme="team"] {
  color-scheme: dark;

  --bg: #101418;
  --surface: #1a2028;
  --surface-raised: #232b36;

  --text: #dfe6ee;
  --text-dim: #8d9aab;

  --accent: #00d1b2;
  --accent-bright: #2ee6c8;
  --accent-contrast: #06231f;

  --border: #2b3542;
  --border-strong: #3a4756;
}
```

That is usually enough. Roughly a dozen tokens carry the whole look; everything
else derives from them.

### The tokens

Colour — surfaces and text:

| Token | Role |
|---|---|
| `--bg` | Page background |
| `--surface` | Buttons, selects, panels, inputs, overview cards |
| `--surface-raised` | Hover state for the above |
| `--surface-inset` | Recessed panel behind nested metrics |
| `--scrim` | Modal backdrop, fullscreen control gradient |
| `--text` | Primary text |
| `--text-bright` | Highest-contrast text (winner-tinted run buttons) |
| `--text-muted` → `--text-ghost` | Five steps of de-emphasis, brightest first |

Colour — accent and lines:

| Token | Role |
|---|---|
| `--accent` | Headings, active controls, focus rings, the chequered flag |
| `--accent-bright` | Accent hover |
| `--accent-shadow` | Border of the highlighted "total" metric card |
| `--accent-contrast` | Text drawn *on* an accent fill |
| `--accent-wash` | Gradient behind the "total" metric card |
| `--border`, `--border-strong`, `--border-subtle` | Three line weights |
| `--danger` | Racer error messages |
| `--tool-accent`, `--tool-surface`, `--tool-contrast` | The calibration panel, which keeps its own accent so it reads as a tool rather than page chrome |

Type, shape, motion and layout:

| Token | Role |
|---|---|
| `--font-ui`, `--font-display` | Body/monospace face and heading face |
| `--font-size-xs` … `--font-size-4xl` | Nine-step type scale (plus `--font-size-marker` for disclosure triangles) |
| `--tracking-tight` … `--tracking-widest` | Letter-spacing steps |
| `--leading`, `--leading-loose` | Line heights |
| `--radius-sm`, `--radius`, `--radius-md`, `--radius-lg` | Corner radii |
| `--border-width`, `--border-width-thick` | Line weights |
| `--shadow-popover`, `--focus-ring` | Menu shadow, focus outline |
| `--duration-fast`, `--duration`, `--duration-slow` | Transition speeds |
| `--page-max`, `--content-max`, `--gutter` | Page width, report column width, horizontal padding |
| `--control-size`, `--play-btn-width` | Transport button geometry |

Ornament and media:

| Token | Role |
|---|---|
| `--checker-size`, `--checker-color-a`, `--checker-color-b` | The chequered bars |
| `--select-arrow` | Dropdown arrow, as a full `url()` — the fill colour is baked into the data URI, so replace the whole image |
| `--video-bg`, `--video-border-width`, `--video-border-color` | The video frames |

A skin that only redefines `--bg`, `--surface` and `--text` still themes both
pages correctly, because every component reads through those roles rather than
inventing its own. Avoid introducing a component-specific colour token: a skin
that does not know about it will leave that one element on the default theme.

### Per-racer colours

Racer tints are not part of the skin: each racer gets a colour from
`RACER_CSS_COLORS` in `cli/player-sections.js`, delivered to the page as an
inline `--racer-color` custom property on the element that needs it. Rules read
it with a neutral fallback, e.g.

```css
.racer-label { color: var(--racer-color, var(--text)); }
```

so a skin can restyle anything racer-tinted by overriding the rule's fallback,
and unset racer colours degrade to the skin's own text colour. The condition
overview uses the same property for its cards' racer rows, bars and verdicts.

### Light skins

Set `color-scheme: light` inside your `:root[data-theme="…"]` block — the CSS
declaration wins over the document default, which is what makes native controls
(scrollbars, the range input) switch. See
[`cli/skins/light.css`](../cli/skins/light.css) for a complete example.

The browser's `theme-color` meta tag is derived from the skin's `--bg` when that
token is a literal colour, so mobile browser chrome matches the page.

## Constraints

- The skin file is inlined into a `<style>` block, so it may not contain a
  literal `</style>` sequence; the build rejects a skin that does.
- Skin names must be filename-safe (`[A-Za-z0-9._-]`) because the name becomes
  both a filename and the `data-theme` attribute value.
