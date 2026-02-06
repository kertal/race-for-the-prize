# RaceForThePrize

**Head-to-head browser performance battles, powered by Playwright.**

RaceForThePrize launches two (or more) browsers side by side, runs your Playwright scripts simultaneously, measures who finishes first, records video of the whole thing, and declares a winner. Think of it as a drag strip for web pages.

## Why This Exists

Benchmarking browser performance usually means staring at numbers in a spreadsheet and pretending you understand what "time to first contentful paint" means for your actual users. RaceForThePrize turns performance testing into something you can *see*: two browsers, same task, synchronized start, video proof of who won.

This makes it genuinely useful for:

- **Framework comparisons** — Load React vs Angular vs Svelte vs HTMX and watch them race to interactive. The side-by-side video makes the difference visceral, not abstract.
- **Performance regression detection** — Run the same task against two builds and see if your "small refactor" just cost you 300ms.
- **A/B testing UI interactions** — Compare two approaches to the same user flow (scroll strategies, loading patterns, click sequences) under identical conditions.
- **Simulating real-world conditions** — Throttle CPU and network to see how your app behaves on a 2019 phone over 3G. The answer is usually "badly."
- **Making performance reviews less boring** — A GIF of two browsers racing is worth a thousand Lighthouse reports.

## Quick Start

```bash
npm install && npx playwright install chromium
node race.js ./races/lauda-vs-hunt
```

That's it. Two browsers will open, race to scroll through Wikipedia pages, and you'll get a winner, video recordings, and a results report.

## Creating a Race

A race is a directory with two or more `.spec.js` files and an optional `settings.json`:

```
races/my-race/
  contender-a.spec.js    # Racer 1 (name = filename minus .spec.js)
  contender-b.spec.js    # Racer 2
  settings.json           # Optional configuration
```

Each script gets a Playwright `page` object with a few extra methods:

```js
// Navigate somewhere
await page.goto('https://example.com', { waitUntil: 'load' });

// Optional: control when video recording starts
await page.raceRecordingStart();

// Start the clock
await page.raceStart('My Measurement');

// Do the thing you're measuring
await page.click('.button');
await page.waitForSelector('.result');

// Stop the clock (sync — no await needed)
page.raceEnd('My Measurement');

// Send a message to the terminal
page.raceMessage('Nailed it.');

// Optional: stop video recording
await page.raceRecordingEnd();
```

`raceStart` is async because in parallel mode it synchronizes both browsers at the starting line — nobody gets a head start. `raceEnd` is sync because each browser stops its own clock independently.

If you skip `raceRecordingStart`/`raceRecordingEnd`, recording automatically covers from the first `raceStart` to the last `raceEnd`.

## Example Races

The `races/` directory includes a few to get you started:

| Race | What It Does |
|------|-------------|
| `lauda-vs-hunt` | Scroll to the bottom of Wikipedia pages. Niki Lauda's precision vs James Hunt's raw speed. |
| `lebron-vs-curry` | Dribble animation + scroll-to-top race with different easing curves. |
| `react-vs-angular` | Load framework documentation sites and measure time to interactive. Supports up to 5 racers (React, Angular, HTMX, Svelte). |

## CLI Options

```
node race.js <dir>                       Run a race
node race.js <dir> --results             View recent results
node race.js <dir> --sequential          Run browsers one after the other
node race.js <dir> --headless            Hide browser windows
node race.js <dir> --network=slow-3g     Throttle network (none, slow-3g, fast-3g, 4g)
node race.js <dir> --cpu=4               Throttle CPU (1 = none, higher = slower)
node race.js <dir> --format=mov          Video format: webm (default), mov, gif
node race.js <dir> --runs=3              Run multiple times, report median
node race.js <dir> --slowmo=2            Slow-motion side-by-side replay
node race.js <dir> --profile             Capture Chrome performance traces
node race.js <dir> --no-overlay          Record without timer overlays
```

CLI flags override `settings.json` values.

### settings.json

```json
{
  "parallel": true,
  "network": "none",
  "cpuThrottle": 1,
  "headless": false
}
```

## What You Get

After a race finishes, you get a timestamped results directory:

```
results-2026-02-06_14-30-00/
  summary.json              # Machine-readable results
  README.md                 # Markdown report with winner, times, diffs
  index.html                # Interactive video player
  lauda/
    lauda.race.webm         # Trimmed video (just the measured segment)
    lauda.full.webm         # Full recording
  hunt/
    hunt.race.webm
    hunt.full.webm
  lauda-vs-hunt.webm        # Side-by-side composition
```

- **Video trimming** is frame-accurate — it uses injected visual cues and FFmpeg to cut exactly at measurement boundaries.
- **Side-by-side videos** are generated automatically when FFmpeg is available. Supports layouts for 2-5 racers (horizontal, grid, or asymmetric).
- **Multiple runs** (`--runs=3`) compute the median across iterations to reduce noise.
- **Performance profiling** (`--profile`) captures Chrome DevTools traces, heap usage, script duration, layout costs, and network transfer sizes.

## How It Works

1. `race.js` parses your CLI args, finds the `.spec.js` files, and spawns `runner.cjs` as a subprocess.
2. `runner.cjs` launches Chromium instances via Playwright — one per racer, in parallel by default.
3. A `SyncBarrier` ensures all browsers hit `raceStart()` at the same moment. Fair starts only.
4. Each browser executes its script, records video, and reports timing data.
5. Videos are trimmed using visual cue detection (colored pixels injected into pages, detected by FFmpeg).
6. Results are compiled into JSON, Markdown, an HTML video player, and a side-by-side video.
7. The terminal prints who won and by how much.

## Tests

```bash
npm test                              # Run all tests
npx vitest run tests/summary.test.js  # Run a single test file
```

## License

MIT
