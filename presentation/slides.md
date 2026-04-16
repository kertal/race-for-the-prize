---
marp: true
theme: default
paginate: true
backgroundColor: "#1a1a1a"
color: "#e8e0d0"
style: |
  section {
    font-family: 'Courier New', monospace;
    background-color: #1a1a1a;
    color: #e8e0d0;
  }
  h1 { font-family: Georgia, serif; color: #d4af37; }
  h2 { font-family: Georgia, serif; color: #d4af37; border-bottom: 2px solid #d4af37; padding-bottom: 8px; }
  h3 { font-family: Georgia, serif; color: #d4af37; }
  code { background: #2a2a2a; color: #e8e0d0; border-radius: 4px; padding: 2px 6px; font-family: 'Courier New', monospace; }
  pre { background: #2a2a2a; border-left: 4px solid #d4af37; border-radius: 6px; }
  pre code { color: #e8e0d0; }
  .hljs-string { color: #d4af37; }
  .hljs-comment { color: #888; }
  .hljs-keyword { color: #e8e0d0; }
  .hljs-number { color: #e8e0d0; }
  .hljs-title { color: #e8e0d0; }
  .hljs-built_in { color: #e8e0d0; }
  strong { color: #d4af37; }
  em { color: #999; font-style: normal; }
  table { width: 100%; border-collapse: collapse; font-family: 'Courier New', monospace; }
  th { background: #2a2a2a; color: #d4af37; padding: 8px 12px; border: 1px solid #333; }
  td { padding: 8px 12px; border: 1px solid #333; background: #1a1a1a; color: #e8e0d0; }
  tr { background: #1a1a1a; }
  tr:nth-child(even) td { background: #222; }
  blockquote { border-left: 4px solid #d4af37; padding-left: 16px; color: #999; font-style: italic; }
  section::after { color: #777; font-family: 'Courier New', monospace; }
---

<!-- Slide 1: Title -->
# 🏆 RaceForThePrize

## *Browser Performance. Head-to-Head. No Judges.*

<br>

**Pit 2 to 5 browsers against each other. Measure everything. Declare a winner.**

<br>

*A Playwright-powered CLI performance benchmarking tool*

---

<!-- Slide 2: Positioning -->
## Numbers Tell You *What*. Racing Shows You *Why*.

*Traditional benchmarks and RaceForThePrize are complementary.*

<br>

| Traditional Benchmarking | RaceForThePrize |
|---|---|
| Lighthouse score: **72 → 81** | Side-by-side video of both loading |
| LCP: 3.2s → 2.1s | Watch the faster page paint first |
| CI metric regressed by 8% | Replay exactly what changed |

<br>

> Traditional tools give you the **numbers**. RaceForThePrize gives you the **comparison**.

---

<!-- Slide 3: How It Works -->
## How It Works

*Write scripts. Launch browsers. One winner.*

<br>

- Write **2 to 5 Playwright `.spec.js` scripts** — or scaffold with `--init`
- Add **race API calls** to define start, stop, and recording boundaries
- Run the CLI — get results, video, and a full report

<br>

```bash
npm install && npx playwright install chromium
node race.js --init my-race          # scaffold a starter race
node race.js ./races/lauda-vs-hunt   # run a built-in race
```

---

<!-- Slide 4: The Race API -->
## The Race API

*Wrap any Playwright script with a few calls.*

<br>

```javascript
await page.raceRecordingStart();          // 📹 Start recording
await page.raceStart('Scroll to Bottom'); // ⏱ Start timer

// ... your Playwright interactions here ...
page.raceMessage('halfway there');        // 💬 Status update in terminal

page.raceEnd('Scroll to Bottom');         // ⏱ Stop timer
await page.raceRecordingEnd();            // 📹 Stop recording
```

<br>

Also available: `raceWaitForVisualStability()` — wait for rendering to settle before measuring.

> Any existing Playwright script can become a racer in minutes.

---

<!-- Slide 5: Demo -->
## Live Race — Lauda vs Hunt

*Two Wikipedia pages. Two scroll strategies. Cold, hard milliseconds.*

<br>

![Lauda vs Hunt side-by-side race replay w:800](../assets/race-for-the-prize-hunt-vs-lauda.gif)

---

<!-- Slide 6: Use Cases -->
## What Can You Race?

*If you can script it in Playwright, you can race it.*

<br>

**A/B test your own app** — point two racers at production vs staging, measure checkout flow, login, search

**Compare frameworks** — React vs Svelte vs Angular vs htmx loading the same TodoMVC benchmark (up to 5 racers)

**Measure a single change** — lazy loading on vs off, with vs without a feature flag

**Quantify third-party cost** — race a page with and without analytics, chat widgets, or ad scripts

**Monitor over time** — run the same race weekly in CI, fail the build if performance regresses

---

<!-- Slide 7: What You Get -->

## What You Get

*Every race produces a full set of results.*

<br>

| Output | Description |
|---|---|
| `index.html` | Interactive video player with segment navigation |
| `README.md` | Medal table, timings, percentage diffs, machine info |
| `summary.json` | CI-ready structured results |
| `*.race.webm` | Trimmed, frame-accurate recordings |
| `*.trace.json` | Chrome performance traces (open in `chrome://tracing`) |
| `*.har` | Network traffic logs (with `--har`) |

<br>

> Add `--runs=5 --network=slow-3g --cpu=4` to simulate real-world conditions.

---

<!-- Slide 8: Advanced Features -->
## Advanced Features

*Simulate the real world. Automate the results.*

<br>

| Feature | Flag | What it does |
|---|---|---|
| Multiple runs | `--runs=5` | Median wins — smooths out noise |
| Network throttling | `--network=slow-3g` | Simulate 3G/4G conditions via CDP |
| CPU throttling | `--cpu=4` | Slow down the CPU by 4x |
| Parallel mode | `--parallel` | Side-by-side spectacle for demos |
| Setup/teardown | `setup.sh` | Start servers, seed databases automatically |
| Slow-motion | `--slowmo=2` | Replay at 2x slower for presentations |
| HAR recording | `--har` | Capture full network traffic logs |

<br>

> CLI flags always override `settings.json`. The stewards have spoken.

---

<!-- Slide 9: CI Integration -->
## CI Integration

*Performance as a pass/fail criterion — just like your unit tests.*

<br>

```bash
node race.js ./races/my-race --headless --no-serve --runs=3
```

<br>

- `--headless` — no visible browsers needed on CI runners
- `--no-serve` — skip auto-opening the results page
- `--runs=3` — median of 3 runs for stable results
- **`summary.json`** — machine-readable output for CI pipelines
- Exit code reflects race success — integrate with any CI system

<br>

> Drop the `README.md` report straight into a PR description.

---

<!-- Slide 10: Get Started -->
## Get Started

*Three steps to your first race.*

<br>

**1. Install**  `git clone` + `npm install` + `npx playwright install chromium`

**2. Race**  `node race.js ./races/lauda-vs-hunt`

**3. Explore**  `lauda-vs-hunt` · `lebron-vs-curry` · `react-vs-angular`

<br>

Or install globally: `npm install -g race-for-the-prize` and run from anywhere.

> "May the fastest browser win."
