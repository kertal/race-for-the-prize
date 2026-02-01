# 🏆 RaceForThePrize

**Ladies and gentlemen, welcome to race day!**

RaceForThePrize is a command-line showdown that pits two browsers against each other in a head-to-head performance battle. Write your [Playwright](https://playwright.dev/) scripts, fire the starting gun, and watch them tear down the track side-by-side — complete with live terminal animation, video recordings, and a full race report declaring the champion.

No judges, no bias — just cold, hard milliseconds on the clock.

## The Starting Grid

```bash
# Install dependencies (including Playwright)
npm install

# Install the Chromium browser engine
npx playwright install chromium
```

## 🏁 Race Day: Lauda vs Hunt

The classic rivalry. Niki Lauda — "The Computer" — against James Hunt — "The Shunt". Precision vs raw speed. Let's settle it once and for all.

```bash
node race.js ./races/lauda-vs-hunt
```

Two browsers launch. Two Wikipedia pages load. Then they scroll — human-like, pixel by pixel — to the bottom. Who reaches the finish line first?

![Lauda vs Hunt — side-by-side race replay](assets/lauda-vs-hunt.gif)

> **Generate it yourself:** `node race.js ./races/lauda-vs-hunt --format=gif` then copy the resulting `.gif` from the results folder to `assets/`.

### What's in the race folder

```
races/lauda-vs-hunt/
  lauda.spec.js      # 🔴 Racer 1: Niki Lauda's Wikipedia page
  hunt.spec.js       # 🔵 Racer 2: James Hunt's Wikipedia page
  settings.json      # Race conditions (parallel, throttle, etc.)
```

## Building Your Own Grand Prix

Every race needs two contenders. Create a folder with two `.spec.js` scripts:

```
races/my-race/
  contender-a.spec.js   # Racer 1 (filename = racer name)
  contender-b.spec.js   # Racer 2
  settings.json          # Optional: race conditions
```

Each script gets a Playwright `page` object with race timing built in:

```js
// Navigate to the starting line
await page.goto('https://example.com', { waitUntil: 'load' });

// Drop the flag — start the clock
await page.raceStart('Full Page Load');

// Do whatever you're measuring
await page.click('.action-button');
await page.waitForSelector('.result-loaded');

// Checkered flag — stop the clock
page.raceEnd('Full Page Load');
page.raceRecordingEnd();
```

### The Race API

| Method | What it does |
|---|---|
| `await page.raceStart(name)` | Starts the stopwatch for a named measurement |
| `page.raceEnd(name)` | Stops the stopwatch — time is recorded |
| `await page.raceRecordingStart()` | Manually start the video segment |
| `page.raceRecordingEnd()` | Manually end the video segment |

If you skip `raceRecordingStart`/`End`, the video automatically wraps your first `raceStart` to last `raceEnd`.

## Race Flags (CLI Options)

```bash
node race.js <dir>                        # Green light — run the race
node race.js <dir> --results              # Check the scoreboard
node race.js <dir> --sequential           # One at a time, no drafting
node race.js <dir> --headless             # Lights out — no visible browsers
node race.js <dir> --network=slow-3g      # Wet track conditions
node race.js <dir> --network=fast-3g      # Damp track
node race.js <dir> --network=4g           # Dry track
node race.js <dir> --cpu=4                # Ballast penalty (CPU throttle)
node race.js <dir> --format=mov           # Broadcast-ready replay format
node race.js <dir> --format=gif           # Quick highlight reel
node race.js <dir> --runs=3               # Best of 3 — median wins
node race.js <dir> --slowmo=2            # Slow-motion replay (2x, 3x, etc.)
node race.js <dir> --profile             # Capture Chrome performance traces
```

CLI flags always override `settings.json`. The stewards have spoken.

## Race Results

After every race, the results land in a timestamped folder:

```
races/my-race/results-2026-01-31_14-30-00/
  contender-a/
    contender-a.race.webm     # Onboard camera footage
    contender-a.full.webm     # Full session recording
    contender-a.trace.json    # Performance trace (--profile)
    measurements.json          # Lap times
    clicks.json                # Driver inputs
  contender-b/
    ...
  contender-a-vs-contender-b.webm   # Side-by-side broadcast replay
  summary.json                        # Official race classification
  README.md                           # Race report card
```

Disclaimer: Due to the nature of the way the video is transformed, the aim here is not accuracy, it's to showcase, to visualize performance. To compare between different network and browser settings.
Do double check and question the metrics and findigs. It should be a helpful tool supporting performance related narratives, but don't assume 100% accuracy. However, this generally applys to many 
browser gained performance metrics. There are many side effects. And screen recording, plus video cutting is another one.

## The Podium Ceremony

The terminal delivers the verdict in style:

- 🏎️ Live racing animation while browsers compete
- 📊 Bar chart comparison of every timed measurement
- 🥇🥈 Medal assignments per measurement
- 🏆 **Overall winner declared**
- 📹 Side-by-side video replay (via FFmpeg)
- 📈 Chrome performance traces (`--profile`, open in `chrome://tracing`)

## `settings.json` Reference

```json
{
  "parallel": true,
  "network": "none",
  "cpuThrottle": 1,
  "headless": false,
  "profile": false
}
```

| Field | Values | Default |
|---|---|---|
| `parallel` | `true` / `false` | `true` |
| `network` | `none`, `slow-3g`, `fast-3g`, `4g` | `none` |
| `cpuThrottle` | `1` (none) to any multiplier | `1` |
| `headless` | `true` / `false` | `false` |
| `profile` | `true` / `false` | `false` |

## Prerequisites

- **Node.js** 18+
- **FFmpeg** (optional — for side-by-side video replays)

## Project Structure

```
RaceForThePrize/
├── race.js              # 🏁 Main entry point — the race director
├── runner.cjs           # Playwright automation engine
├── cli/
│   ├── animation.js     # Live terminal racing animation
│   ├── colors.js        # ANSI color palette
│   ├── config.js        # Argument parsing & racer discovery
│   ├── results.js       # File management & video conversion
│   ├── summary.js       # Results formatting & markdown reports
│   └── sidebyside.js    # FFmpeg video composition
├── races/
│   └── lauda-vs-hunt/   # 🏆 Example: the greatest rivalry in racing
├── tests/               # Test suite
└── package.json
```

## Standing on the Shoulders of Giants

Built by [@kertal](https://github.com/kertal) and his agents the called [The Flaming Bits](https://claude.com/product/claude-code). More humans with or without agents are welcome!
Built on top of the mighty [Playwright](https://playwright.dev/) — the browser automation framework that makes all of this possible.
Built on top of ideas while working on [Kibana](https://www.elastic.co/kibana)
Built with support of the great "[Race for the Prize](https://www.youtube.com/watch?v=bs56ygZplQA)" song by [The Flaming Lips](https://www.flaminglips.com/) 

## License

MIT
