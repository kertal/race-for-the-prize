---
marp: true
theme: default
paginate: true
backgroundColor: "#0d0d0d"
color: "#f0f0f0"
style: |
  section {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background-color: #0d0d0d;
    color: #f0f0f0;
  }
  h1 { color: #f5c518; }
  h2 { color: #e8a020; border-bottom: 2px solid #e8a020; padding-bottom: 8px; }
  h3 { color: #f5c518; }
  code { background: #1e1e1e; color: #ce9178; border-radius: 4px; padding: 2px 6px; }
  pre { background: #1e1e1e; border-left: 4px solid #f5c518; border-radius: 6px; }
  pre code { color: #d4d4d4; }
  .flag { font-size: 2em; }
  strong { color: #f5c518; }
  em { color: #9cdcfe; font-style: normal; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e1e1e; color: #f5c518; padding: 8px 12px; }
  td { padding: 8px 12px; border-bottom: 1px solid #333; }
  blockquote { border-left: 4px solid #f5c518; padding-left: 16px; color: #aaa; font-style: italic; }
---

<!-- Slide 1: Title -->
# 🏆 RaceForThePrize

## *Browser Performance. Head-to-Head. No Judges.*

<br>

> "Ladies and gentlemen, welcome to race day."

<br>

**Pit two browsers against each other. Measure everything. Declare a winner.**

<br>
<br>

*A Playwright-powered CLI performance benchmarking tool*

---

<!-- Slide 2: The Problem -->
## The Problem with Browser Performance Testing

<br>

"Is the new version **actually faster**?"

<br>

Traditional benchmarks answer this badly:

| Approach | Problem |
|---|---|
| Lighthouse scores | Single snapshot, no comparison |
| Manual stopwatch | Human error, not reproducible |
| Synthetic metrics | Disconnected from real user flows |
| A/B analytics | Requires production traffic |

<br>

**You need a head-to-head race. You need a finish line.**

---

<!-- Slide 3: What Is It -->
## What Is RaceForThePrize?

<br>

A **CLI tool** that runs two Playwright scripts side-by-side and declares a winner.

<br>

```text
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Racer A ──► Browser 1 ──► 🏁 Finish              │
│                              ↑                      │
│                         WHO'S FASTER?               │
│                              ↓                      │
│   Racer B ──► Browser 2 ──► 🏁 Finish              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

<br>

- Write **two Playwright `.spec.js` scripts**
- Define **checkpoints** with the race API
- Get **millisecond-precise results**, video recordings, and a full report

---

<!-- Slide 4: Quick Start -->
## From Zero to Race in 60 Seconds

<br>

```bash
# Install
npm install -g race-for-the-prize

# Scaffold a starter race
race-for-the-prize --init my-race

# Fire the starting gun
race-for-the-prize my-race
```

<br>

Or try a built-in race immediately:

```bash
npm install && npx playwright install chromium
node race.js ./races/lauda-vs-hunt
```

<br>

**That's it.** Two browsers launch, race runs, winner declared. 🏆

---

<!-- Slide 5: The Race API -->
## The Race API — Minimal & Expressive

<br>

A script is just **Playwright + five injected methods**:

```javascript
// lauda.spec.js — Niki Lauda's Wikipedia scroll race
await page.goto('https://en.wikipedia.org/wiki/Niki_Lauda');

await page.raceRecordingStart();     // 📹 Start recording
await page.raceStart('Scroll to Bottom');  // ⏱ Start timer

while (!atBottom) {
  await page.mouse.wheel(0, 150);
  await page.waitForTimeout(45);
  atBottom = await page.evaluate(() => /* check scroll */);
}

page.raceEnd('Scroll to Bottom');    // ⏱ Stop timer
page.raceMessage('Precision beats chaos.');
await page.raceRecordingEnd();       // 📹 Stop recording
```

<br>

*Any existing Playwright script can become a racer in minutes.*

---

<!-- Slide 6: Demo GIF -->
## Live Race — Lauda vs Hunt

**The Classic Rivalry: The Computer vs The Shunt**

<br>

Two Wikipedia pages. Two scroll strategies. Cold, hard milliseconds.

<br>

![Lauda vs Hunt side-by-side race replay w:800](../assets/race-for-the-prize-hunt-vs-lauda.gif)

---

<!-- Slide 7: What You Get -->
## What You Get After Every Race

<br>

```text
races/lauda-vs-hunt/results-2026-03-15_14-32-00/
├── README.md              # 📄 Full race report (markdown)
├── summary.json           # 📊 Structured results + timings
├── index.html             # 🎬 Interactive HTML player
├── lauda/
│   ├── lauda.race.webm    # 📹 Trimmed race video
│   ├── lauda.full.webm    # 📹 Full uncut recording
│   └── lauda.trace.json   # 🔍 Chrome DevTools trace
└── hunt/
    ├── hunt.race.webm
    ├── hunt.full.webm
    └── hunt.trace.json
```

<br>

| Output | Description |
|---|---|
| `README.md` | Medal table, timings, machine info |
| `index.html` | Video player with calibrated timestamps |
| `summary.json` | Pipe into CI, dashboards, or scripts |
| Chrome trace | Deep performance profiling |

---

<!-- Slide 8: Race Report Sample -->
## Sample Race Report

<br>

```markdown
## 🏆 Results — Lauda vs Hunt

| Place | Racer | Scroll to Bottom | vs Winner |
|-------|-------|-----------------|-----------|
| 🥇 1st | lauda | 4,823 ms        | —         |
| 🥈 2nd | hunt  | 5,107 ms        | +5.9%     |

**Winner: lauda** · 284ms faster · 5.9% lead

### Machine
- Platform: linux · Node 22.11.0
- Network: none · CPU throttle: 1×
```

<br>

Reports are **reproducible**, **shareable**, and **CI-friendly**.

---

<!-- Slide 9: Race Conditions -->
## Simulate Real-World Conditions

<br>

Not all users have fiber and a MacBook Pro. Test how your app behaves *under pressure*.

<br>

```bash
# Slow network + CPU-throttled device
node race.js ./races/react-vs-angular \
  --network=slow-3g \
  --cpu=4 \
  --runs=5

# Side-by-side GIF for your team Slack
node race.js ./races/grafana-vs-kibana \
  --parallel \
  --format=gif \
  --ffmpeg
```

<br>

| Flag | Options |
|---|---|
| `--network` | `none`, `slow-3g`, `fast-3g`, `4g` |
| `--cpu` | `1` (normal) to `10` (heavily throttled) |
| `--runs` | Multiple runs → median reported |
| `--parallel` | Both browsers race simultaneously |

---

<!-- Slide 10: Architecture -->
## Architecture — Built for Accuracy

<br>

```text
race.js  (ESM)                runner.cjs  (CommonJS)
   │                                │
   ├─ Parse CLI args                ├─ Launch 2× Chromium
   ├─ Discover .spec.js files       ├─ Inject race API
   ├─ Spawn runner.cjs ───────────► ├─ Record video (WebM)
   ├─ Drive terminal animation      ├─ CDP throttling
   ├─ Parse JSON results ◄───────── ├─ Visual cue calibration
   └─ Generate report               └─ Output JSON → stdout
```

<br>

**Key design decisions:**

- **Sequential by default** — eliminates resource contention, maximizes accuracy
- **Subprocess isolation** — runner crashes can't corrupt the CLI
- **Frame-accurate video** — colored pixel cues detected via Canvas API
- **ESM + CJS split** — Playwright's subprocess model requires CommonJS

---

<!-- Slide 11: Use Cases -->
## What Can You Race?

<br>

**Framework comparisons**
```bash
races/react-vs-angular/     # Which framework boots faster?
races/grafana-vs-kibana/    # Which dashboard loads first?
```

**Feature impact measurement**
```javascript
// before.spec.js — app without lazy loading
// after.spec.js  — app with lazy loading
// → Quantify the gain
```

**Regression detection in CI**
```javascript
// main.spec.js    — current production
// branch.spec.js  — your feature branch
// → Catch slowdowns before merge
```

**Third-party script cost**
```javascript
// with-analytics.spec.js   — page with analytics
// without-analytics.spec.js — clean page
// → Show the real cost
```

---

<!-- Slide 12: Built-in Races -->
## Built-in Races — Ready to Run

<br>

```text
races/
├── lauda-vs-hunt/           # 🏎  F1 scroll race — Wikipedia
├── lebron-vs-curry/         # 🏀  Basketball physics + scroll
├── react-vs-angular/        # ⚛️  Framework boot time
├── grafana-vs-kibana/       # 📊  Dashboard load race
└── kibana-discover-evolution/  # 📈  Same app, two versions
```

<br>

**LeBron vs Curry** goes deeper — browser physics:

```javascript
// Synchronized basketball dribble (gravity simulation)
// LeBron: ease-in-out scroll   vs   Curry: cubic ease-out
// Same physics. Different browser rendering. Who wins?
```

*Every built-in race tells a story. Yours will too.*

---

<!-- Slide 13: Parallel Mode -->
## Parallel Mode — For the Visual Drama

<br>

Run both browsers **simultaneously** and watch them race in real time.

<br>

```text
    🔴 LAUDA      🔵 HUNT
    ─────────     ──────────
    ████░░░░░     ██████░░░░
    Scrolling...  Scrolling...
    1,204ms       1,089ms ←
    2,891ms       2,744ms ←
    4,823ms ←     5,107ms
```

<br>

```bash
node race.js ./races/lauda-vs-hunt --parallel
```

<br>

A `SyncBarrier` coordinates both browsers at checkpoints so they start together — **fair start, dramatic finish**.

---

<!-- Slide 14: Video Output -->
## Video Output — Share the Drama

<br>

```bash
# WebM (default, instant — no FFmpeg)
node race.js my-race

# Convert to GIF — shareable in GitHub/Slack
node race.js my-race --format=gif --ffmpeg

# Side-by-side composition
node race.js my-race --parallel --ffmpeg

# Slow-motion replay
node race.js my-race --slowmo=3
```

<br>

**Frame-accurate trimming** via visual cues:
- Colored pixels injected into the page at race start/end
- Canvas API detects exact frame boundaries client-side
- FFmpeg physically cuts the segment when `--ffmpeg` is set

*No guesswork. The video shows exactly what was measured.*

---

<!-- Slide 15: CI Integration -->
## CI/CD Integration

<br>

Every race outputs `summary.json` — machine-readable, pipeline-ready:

```json
{
  "overallWinner": "lauda",
  "wins": { "lauda": 1, "hunt": 0 },
  "comparisons": [
    {
      "name": "Scroll to Bottom",
      "winner": "lauda",
      "rankings": ["lauda", "hunt"],
      "racers": [
        { "name": "lauda", "time": 4823 },
        { "name": "hunt",  "time": 5107 }
      ]
    }
  ],
  "runs": 3
}
```

<br>

```bash
# In your CI pipeline:
node race.js ./races/main-vs-branch --runs=3 --headless
node -e "
  const fs = require('node:fs');
  const r = JSON.parse(fs.readFileSync('results/summary.json'));
  if (r.overallWinner !== 'main') process.exit(1); // fail if branch regressed
"
```

---

<!-- Slide 16: Getting Started -->
## Get Started Today

<br>

```bash
# Option 1: Global install
npm install -g race-for-the-prize
race-for-the-prize --init my-first-race
race-for-the-prize my-first-race

# Option 2: npx (no install)
npx race-for-the-prize --init my-first-race
npx race-for-the-prize my-first-race

# Option 3: Clone and run built-in races
git clone https://github.com/kertal/race-for-the-prize
cd race-for-the-prize
npm install && npx playwright install chromium
node race.js ./races/lauda-vs-hunt
```

<br>

**Requirements:** Node.js 18+ · Chromium (auto-installed) · FFmpeg (optional)

---

<!-- Slide 17: Summary -->
## Why RaceForThePrize?

<br>

| Feature | Benefit |
|---|---|
| **Playwright-native** | Works with any web app — no instrumentation needed |
| **Minimal race API** | Any Playwright script becomes a racer |
| **Frame-accurate video** | See exactly what was measured |
| **Real-world throttling** | Test slow networks and weak devices |
| **CI-ready JSON output** | Catch regressions before they ship |
| **Zero config to start** | `--init` scaffolds everything |

<br>

> "No judges, no bias — just cold, hard milliseconds on the clock."

<br>

**🏁 Start your engines. The browser that's faster wins.**

---

<!-- Slide 18: Thank You -->
# 🏁 Thank You

<br>

## RaceForThePrize

*Browser Performance. Head-to-Head. No Judges.*

<br>

```bash
npx race-for-the-prize --init my-race && npx race-for-the-prize my-race
```

<br>

**GitHub:** `race-for-the-prize`
**Install:** `npm install -g race-for-the-prize`

<br>

*May the fastest browser win.* 🏆
