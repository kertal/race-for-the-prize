# 🏆 RaceForThePrize

**Ladies and gentlemen, welcome to race day!**

RaceForThePrize is a command-line showdown that pits two browsers against each other in a head-to-head performance battle. Write your [Playwright](https://playwright.dev/) scripts, fire the starting gun, and watch them tear down the track side-by-side — complete with live terminal animation, video recordings, and a full race report declaring the champion.

No judges, no bias — just cold, hard milliseconds on the clock.

## The Starting Grid

```bash
npm install && npx playwright install chromium
```

New to Node.js or need help with your platform? See the full **[Installation Guide](INSTALLATION.md)** for step-by-step instructions on macOS, Linux, and Windows.

## 🏁 Race Day: Lauda vs Hunt

The classic rivalry. Niki Lauda — "The Computer" — against James Hunt — "The Shunt". Precision vs raw speed. Let's settle it once and for all.

```bash
node race.js ./races/lauda-vs-hunt
```

Two browsers launch. Two Wikipedia pages load. Then they scroll — human-like, pixel by pixel — to the bottom. Who reaches the finish line first?

![Lauda vs Hunt — side-by-side race replay](assets/race-for-the-prize-hunt-vs-lauda.gif)

### What's in the race folder

```
races/lauda-vs-hunt/
  lauda.spec.js      # 🔴 Racer 1: Niki Lauda's Wikipedia page
  hunt.spec.js       # 🔵 Racer 2: James Hunt's Wikipedia page
  settings.json      # Race conditions (parallel, throttle, etc.)
```

## 🏀 LeBron vs Curry

The GOAT debate, settled by browser performance. LeBron James — "The King" — against Stephen Curry — "The Chef". Both start at a fixed scroll position on their Wikipedia pages and dribble — basketball physics style, with gravity acceleration down and deceleration up — three times before racing back to the top.

```bash
node race.js ./races/lebron-vs-curry
```

The dribbles are perfectly synced. The difference? The scroll back to the top: LeBron uses a smooth ease-in-out, Curry snaps up with a cubic ease-out. Pure browser performance decides the winner.

## Global Install

Install once, race anywhere:

```bash
npm install -g race-for-the-prize
```

Chromium is installed automatically via the `postinstall` script. Then scaffold and run a race from any directory:

```bash
race-for-the-prize --init my-race   # scaffold starter race into my-race/
race-for-the-prize my-race          # run it
```

Use `npx` if you prefer not to install globally:

```bash
npx race-for-the-prize --init my-race
npx race-for-the-prize my-race
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
// Navigate and wait for the page to be ready
await page.goto('https://example.com', { waitUntil: 'load' });
await page.waitForSelector('.action-button');

// Start recording early — gives viewers context before the action
await page.raceRecordingStart();
await page.waitForTimeout(1500);

// Drop the flag — start the clock
await page.raceStart('Full Page Load');

// Do whatever you're measuring
await page.click('.action-button');
await page.waitForSelector('.result-loaded');

// Checkered flag — stop the clock
page.raceEnd('Full Page Load');

// Hold the frame so the video doesn't cut abruptly
await page.waitForTimeout(1500);
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

## Use Cases: What You Can Race

### A/B testing different versions of your app

Ship a performance regression? Find out before your users do. Point two racers at the same workflow — one against your current release, one against the candidate build:

```
races/checkout-v2-vs-v3/
  checkout-v2.spec.js    # Production: https://app.example.com
  checkout-v3.spec.js    # Staging: https://staging.example.com
```

```js
// checkout-v3.spec.js
await page.goto('https://staging.example.com/products');
await page.waitForSelector('.product-list');

// Start recording with a brief pause so viewers see the initial state
await page.raceRecordingStart();
await page.waitForTimeout(1500);

await page.raceStart('Add to cart flow');
await page.click('.add-to-cart');
await page.waitForSelector('.cart-badge');
page.raceEnd('Add to cart flow');

await page.raceStart('Checkout render');
await page.click('.checkout-button');
await page.waitForSelector('.payment-form');
page.raceEnd('Checkout render');

// Let the final state linger in the recording
await page.waitForTimeout(1500);
page.raceRecordingEnd();
```

Run it under realistic conditions with throttling to see how it feels on real devices:

```bash
node race.js ./races/checkout-v2-vs-v3 --network=fast-3g --cpu=4 --runs=5
```

### Comparing competing products or frameworks

Which dashboard loads faster — yours or the competition? Which CSS framework renders a complex layout quicker? Set up a head-to-head:

```
races/react-vs-svelte-todo/
  react-todo.spec.js      # React TodoMVC
  svelte-todo.spec.js     # Svelte TodoMVC
```

### Measuring the impact of a single change

Want to know if lazy-loading images actually helped? Create two racers that hit the same page — one with the feature flag on, one off:

```
races/lazy-loading-impact/
  with-lazy.spec.js       # ?feature=lazy-images
  without-lazy.spec.js    # ?feature=eager-images
```

### Monitoring third-party script cost

Quantify the performance tax of analytics, chat widgets, or ad scripts by racing a page with and without them.

### Simulating real-world conditions

Combine network throttling and CPU slowdown to approximate mobile users on spotty connections:

```bash
node race.js ./races/my-race --network=slow-3g --cpu=6 --runs=3
```

The `--runs` flag takes the median, smoothing out noise and giving you a number you can trust.

## Race Flags (CLI Options)

```bash
node race.js --init [dir]                 # Scaffold a starter race (default dir: my-race)
node race.js <dir>                        # Green light — run the race
node race.js <dir> --results              # Check the scoreboard
node race.js <dir> --parallel             # Side by side — pure spectacle, wizard-of-many-windows mode
node race.js <dir> --headless             # Lights out — no visible browsers
node race.js <dir> --network=slow-3g      # Wet track conditions
node race.js <dir> --network=fast-3g      # Damp track
node race.js <dir> --network=4g           # Dry track
node race.js <dir> --cpu=4                # Ballast penalty (CPU throttle)
node race.js <dir> --format=mov           # Broadcast-ready replay format (requires --ffmpeg)
node race.js <dir> --format=gif           # Quick highlight reel (requires --ffmpeg)
node race.js <dir> --runs=3               # Best of 3 — median wins
node race.js <dir> --slowmo=2            # Slow-motion replay (2x, 3x, etc.)
node race.js <dir> --ffmpeg              # Enable FFmpeg processing (trim, merge, convert)
```

CLI flags always override `settings.json`. The stewards have spoken.

### Serial vs Parallel: Accuracy vs Spectacle

By default, races run in **serial** (sequential) mode — one browser at a time. This gives you the most accurate and reliable timing results because each racer gets the full, undivided attention of your machine's CPU and network stack. If you care about the numbers, stick with serial.

**Parallel mode** (`--parallel`) launches both browsers simultaneously and is purely for the show. It's demo day mode — the wizard-of-many-windows spectacle where two browsers tear down the track side by side in real time. It looks fantastic in presentations and screen recordings, but since both browsers compete for the same system resources, the timings are less reliable. Use it when you want to impress an audience, not when you need to trust the stopwatch.

## Race Results

After every race, the results land in a timestamped folder:

```
races/my-race/results-2026-01-31_14-30-00/
  contender-a/
    contender-a.race.webm     # Onboard camera footage
    contender-a.full.webm     # Full session recording (--ffmpeg only)
    contender-a.trace.json    # Performance trace (--profile)
    measurements.json          # Lap times
    clicks.json                # Driver inputs
  contender-b/
    ...
  contender-a-vs-contender-b.webm   # Side-by-side broadcast replay (--ffmpeg only)
  index.html                          # Interactive HTML player with video replay
  summary.json                        # Official race classification
  README.md                           # Race report card
```

By default, the HTML player handles virtual trimming via clip times and uses CDP screencast metadata or canvas-based calibration for frame-accurate playback — no external dependencies needed. When neither calibration source is available, it falls back to linear time-mapping which is less precise. With `--ffmpeg`, videos are physically trimmed, a side-by-side merged video is created, and format conversion (mov/gif) is available.

Disclaimer: Due to the nature of the way the video is transformed, the aim here is not accuracy, it's to showcase, to visualize performance. To compare between different network and browser settings.
Do double check and question the metrics and findings. It should be a helpful tool supporting performance related narratives, but don't assume 100% accuracy. However, this generally applies to many 
browser gained performance metrics. There are many side effects. And screen recording, plus video cutting is another one.

## The Podium Ceremony

The terminal delivers the verdict in style:

- 🏎️ Live racing animation while browsers compete
- 📊 Bar chart comparison of every timed measurement
- 🥇🥈 Medal assignments per measurement
- 🏆 **Overall winner declared**
- 📹 Side-by-side video replay (in-browser export, or physical file via `--ffmpeg`)
- 📈 Chrome performance traces (open in `chrome://tracing`)

## `settings.json` Reference

```json
{
  "parallel": false,
  "network": "none",
  "cpuThrottle": 1,
  "headless": false
}
```

| Field | Values | Default |
|---|---|---|
| `parallel` | `true` / `false` | `false` |
| `network` | `none`, `slow-3g`, `fast-3g`, `4g` | `none` |
| `cpuThrottle` | `1` (none) to any multiplier | `1` |
| `headless` | `true` / `false` | `false` |

## Prerequisites

- **Node.js** 18+ (required)
- **FFmpeg** (optional — only needed with `--ffmpeg` for physical video trimming, side-by-side merging, and format conversion)

FFmpeg is **not required** for normal use. The HTML player handles virtual trimming with frame-accurate canvas-based calibration and includes a client-side Export button for creating side-by-side videos directly in the browser.

See the **[Installation Guide](INSTALLATION.md)** for detailed setup instructions on every platform.

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
│   ├── sidebyside.js    # FFmpeg video composition (--ffmpeg)
│   └── videoplayer.js   # Interactive HTML player with clip-based trimming
├── races/
│   ├── lauda-vs-hunt/   # 🏆 Example: the greatest rivalry in racing
│   └── lebron-vs-curry/ # 🏀 Example: the GOAT debate, dribble-style
├── tests/               # Test suite
└── package.json
```

## Standing on the Shoulders of Giants

- Built by [@kertal](https://github.com/kertal) and his agents [The Flaming Bits](https://claude.com/product/claude-code). More humans with or without agents are welcome!
- Built on top of the mighty [Playwright](https://playwright.dev/) — the browser automation framework that makes all of this possible.
- Built with support of the great "[Race for the Prize](https://www.youtube.com/watch?v=bs56ygZplQA)" song by [The Flaming Lips](https://www.flaminglips.com/). 

## License

MIT
