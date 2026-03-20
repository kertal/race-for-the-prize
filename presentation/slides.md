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

**Pit two browsers against each other. Measure everything. Declare a winner.**

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

*Two scripts. Two browsers. One winner.*

<br>

- Write **two Playwright `.spec.js` scripts**
- Add **four race API calls** to define start, stop, and recording
- Run the CLI — get results, video, and a full report

<br>

```bash
npm install && npx playwright install chromium
node race.js ./races/lauda-vs-hunt
```

---

<!-- Slide 4: The Race API -->
## The Race API

*Wrap any Playwright script with four calls.*

<br>

```javascript
await page.raceRecordingStart();          // 📹 Start recording
await page.raceStart('Scroll to Bottom'); // ⏱ Start timer

// ... your Playwright interactions here ...

page.raceEnd('Scroll to Bottom');         // ⏱ Stop timer
await page.raceRecordingEnd();            // 📹 Stop recording
```

<br>

> Any existing Playwright script can become a racer in minutes.

---

<!-- Slide 5: Demo -->
## Live Race — Lauda vs Hunt

*Two Wikipedia pages. Two scroll strategies. Cold, hard milliseconds.*

<br>

![Lauda vs Hunt side-by-side race replay w:800](../assets/race-for-the-prize-hunt-vs-lauda.gif)

---

<!-- Slide 6: What You Get -->
## What You Get

*Every race produces a full set of results.*

<br>

| Output | Description |
|---|---|
| `index.html` | Interactive video player — watch both racers |
| `README.md` | Medal table, timings, machine info |
| `summary.json` | CI-ready structured results |
| `*.race.webm` | Trimmed, frame-accurate recordings |

<br>

> Add `--runs=5 --network=slow-3g --cpu=4` to simulate real-world conditions.

---

<!-- Slide 7: Get Started -->
## Get Started

*Three steps to your first race.*

<br>

**1. Install**  `git clone` + `npm install` + `npx playwright install chromium`

**2. Race**  `node race.js ./races/lauda-vs-hunt`

**3. Explore**  `lauda-vs-hunt` · `lebron-vs-curry` · `react-vs-angular`

<br>

> "May the fastest browser win."
