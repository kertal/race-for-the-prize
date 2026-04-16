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

## *Browser Performance. Head-to-Head.*

<br>

**Pit browsers against each other. Measure everything. Declare a winner.**

<br>

*A Playwright-powered CLI benchmarking tool*

---

<!-- Slide 2: The Problem -->
## You Have Metrics. But Do You Have *Proof*?

<br>

- Lighthouse score: **72 → 81** — *which change did it?*
- LCP improved by 34% — *can you actually see that?*
- CI is red — *what exactly regressed?*

<br>

> RaceForThePrize makes performance **visible**. Side by side. In milliseconds.

---

<!-- Slide 3: How It Works -->
## How It Works

*Write scripts. Launch browsers. One winner.*

<br>

- Write **Playwright `.spec.js` scripts** — one per contender
- Add **3 race API calls** to define start, stop, recording
- Run the CLI — get video, timings, and a full report

<br>

```bash
node race.js ./races/lauda-vs-hunt
```

---

<!-- Slide 4: The Race API -->
## The Race API

*Wrap any Playwright script with a few calls.*

<br>

```javascript
await page.raceRecordingStart();
await page.raceStart('Page Load');

// ... your Playwright interactions ...

page.raceEnd('Page Load');
await page.raceRecordingEnd();
```

<br>

> Any existing Playwright script becomes a racer in minutes.

---

<!-- Slide 5: Demo -->
## Live Race — Lauda vs Hunt

*Two Wikipedia pages. Two scroll strategies. Cold, hard milliseconds.*

<br>

![Lauda vs Hunt side-by-side race replay w:800](../assets/race-for-the-prize-hunt-vs-lauda.gif)

---

<!-- Slide 6: Race Anything -->
## Race Anything

*If you can script it in Playwright, you can race it.*

<br>

- **Production vs. Staging** — checkout flow, login, search
- **React vs. Svelte vs. Angular** — same app, real numbers
- **Feature flag on vs. off** — lazy loading, third-party scripts
- **Weekly in CI** — fail the build if performance regresses

---

<!-- Slide 7: What You Get -->
## Every Race Ships With

<br>

- **Interactive HTML player** — video with segment navigation
- **Markdown report** — medal table, timings, diffs, machine info
- **`summary.json`** — structured results for CI pipelines
- **Chrome traces + HAR** — deep-dive when you need it

<br>

> Drop the report straight into a PR description.

---

<!-- Slide 8: Real-World Conditions -->
## Simulate the Real World

<br>

- `--runs=5` — median wins, noise smoothed out
- `--network=slow-3g` — throttle via CDP
- `--cpu=4` — 4× slower for budget devices
- `--headless` — runs on any CI system

<br>

> CLI flags always override `settings.json`. The stewards have spoken.

---

<!-- Slide 9: Get Started -->
## Get Started

<br>

**1.** `npm install && npx playwright install chromium`

**2.** `node race.js ./races/lauda-vs-hunt`

**3.** Pick a winner.

<br>

Built-in races: `lauda-vs-hunt` · `lebron-vs-curry` · `react-vs-angular`

<br>

> *"May the fastest browser win."*
