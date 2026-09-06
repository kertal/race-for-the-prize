# 🏆 RaceForThePrize

**Ladies and gentlemen, welcome to race day!**

RaceForThePrize is a command-line showdown that pits browsers against each other in head-to-head performance battles. Pit 2 to 5 racers against each other — write your [Playwright](https://playwright.dev/) scripts, fire the starting gun, and watch them tear down the track side-by-side — complete with live terminal animation, video recordings, and a full race report declaring the champion.

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

```text
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

## ⚛️ React vs Angular (and friends)

The frontend framework cage match — four racers, one winner. React, Angular, Svelte, and htmx all load the same TodoMVC-style benchmark. RaceForThePrize supports up to five racers in a single heat.

```bash
node race.js ./races/react-vs-angular
```

## 🤫 Encrypted cache vs plain cache vs no cache

What does caching cost, and when does it pay back? [HushHushDB](https://kertal.github.io/hush-hush-db/) downloads a dataset and can keep it in IndexedDB — encrypted with a key in `sessionStorage`, stored as plaintext, or not kept at all. Three racers boot the same app into a different cache handling mode, fetch the dataset, then ask for it a second time.

```bash
node race.js ./races/caching-comparison
```

Both halves are timed, because encryption is not free on either side of the cache. **Fetch and store** is the price paid up front — the app renders only once the write finishes. **Reload to data** is the payback, and it separates the two costs cleanly: decrypting is a CPU cost that ignores the network, refetching is a network cost that ignores the CPU.

```text
  ⏱ Reload to data     encrypted   plain   no-cache
  none    · CPU 1x       0.190s   0.133s     0.068s
  slow-3g · CPU 1x       0.189s   0.150s     4.332s   ← same CPU, 25x slower link
  none    · CPU 4x       0.496s   0.306s     0.127s   ← same link, 4x slower CPU
```

Six conditions (three networks x two CPU rates), three runs each, reported as medians — the whole thing takes about nine minutes:

```text
  ⚡ Performance Matrix
  Network  CPU 1x                     CPU 4x
  none     🏆 no-cache        0.171s  🏆 no-cache        0.345s
              plain-cache     0.300s     plain-cache     0.849s
              encrypted-cache 0.393s     encrypted-cache 1.179s

  fast-3g  🏆 plain-cache     2.059s  🏆 plain-cache     2.571s
              encrypted-cache 2.138s     no-cache        2.867s
              no-cache        3.164s     encrypted-cache 2.920s

  slow-3g  🏆 plain-cache     4.583s  🏆 plain-cache     5.062s
              encrypted-cache 4.667s     encrypted-cache 5.404s
              no-cache        8.217s     no-cache        7.917s
```

On a free network the write cost makes caching pure overhead and skipping it wins outright; by slow-3g caching wins by three and a half seconds. Encryption is the smaller effect but a remarkably steady one: on the read it costs 40–60ms at CPU 1x and around 190ms at CPU 4x, in every network condition. Switch the metric picker in `index.html` to **Network Transfer** under *Total Recording* for the blunt version: the cached racers move 380 KB over the whole run, no-cache 594 KB — the extra 214 KB is the dataset, fetched a second time.

Single runs of a live site wobble enough to flip cells, so `settings.json` asks for three. Drop it to `"runs": 1` if you would rather have the answer in three minutes.

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

Every race needs at least two contenders (up to five). RaceForThePrize supports two modes:

### Mode 1: Multi-spec mode

Use this when each racer needs custom logic. Create one `.spec.js` file per racer:

```text
races/my-race/
  contender-a.spec.js   # Racer 1 (filename = racer name)
  contender-b.spec.js   # Racer 2
  contender-c.spec.js   # Racer 3 (optional — up to 5 racers)
  settings.json          # Optional: race conditions
  setup.sh               # Optional: runs before the race (see Setup and Teardown)
  teardown.sh            # Optional: runs after the race
```

### Mode 2: Shared-spec mode

Use this when racers share the same script but differ by variables (URL, commit, feature flags). Keep one `race.spec.js` and define racers in `settings.json`:

```text
races/my-race/
  race.spec.js           # Shared script used by all racers
  settings.json          # Required: defines racers + vars
  race.setup.sh          # Optional: shared per-racer setup in shared-spec mode
  setup.sh               # Optional: global setup
  teardown.sh            # Optional: global teardown
```

```json
{
  "racers": {
    "commit-a": { "vars": { "URL": "https://app.example.com?ref=a" } },
    "commit-b": { "vars": { "URL": "https://app.example.com?ref=b" } }
  }
}
```

In shared-spec mode, racer order follows key declaration order in `racers`. Use non-numeric racer names (integer-like names such as `"0"` are rejected to keep ordering deterministic). Access per-racer values via `race.vars`:

```js
await page.goto(race.vars.URL);
```

Setup scripts are optional in both modes.
If both modes are technically possible, prefer shared-spec mode for faster A/B experiments with less duplicated code.
In shared-spec mode, `race.setup.sh`/`.js` can be used as a shared per-racer setup convention (still overridable per racer in `settings.racers.<name>.setup`).

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
await page.raceRecordingEnd();
```

### The Race API

| Method | What it does |
|---|---|
| `await page.raceStart(name)` | Starts the stopwatch for a named measurement |
| `page.raceEnd(name)` | Stops the stopwatch — time is recorded |
| `await page.raceRecordingStart()` | Manually start the video segment |
| `await page.raceRecordingEnd()` | Manually end the video segment |
| `page.raceMessage(text)` | Send a status message to the CLI terminal |
| `await page.raceWaitForVisualStability(opts?)` | Wait for rendering to settle before measuring |

If you skip `raceRecordingStart`/`End`, the video automatically wraps your first `raceStart` to last `raceEnd`.

## Use Cases: What You Can Race

### A/B testing different versions of your app

Ship a performance regression? Find out before your users do. You can race two builds with either separate scripts (multi-spec mode) or one shared script (shared-spec mode).

#### Multi-spec mode example

```text
races/checkout-v2-vs-v3/
  checkout-v2.spec.js    # Production: https://app.example.com
  checkout-v3.spec.js    # Staging: https://staging.example.com
```

#### Shared-spec mode example (single codebase, commit-to-commit)

Use one script and switch commits per racer in a per-racer setup script:

```text
races/checkout-commits/
  race.spec.js
  checkout-commit.sh
  settings.json
```

`settings.json`:

```json
{
  "racers": {
    "main": {
      "setup": "./checkout-commit.sh",
      "vars": { "COMMIT_SHA": "origin/main", "URL": "http://localhost:5601/app/home" }
    },
    "candidate": {
      "setup": "./checkout-commit.sh",
      "vars": { "COMMIT_SHA": "feature/checkout-fast", "URL": "http://localhost:5601/app/home" }
    }
  }
}
```

`checkout-commit.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
git -C /path/to/your/repo checkout "$RACE_VAR_COMMIT_SHA"
```

`race.spec.js`:

```js
await page.goto(race.vars.URL);
await page.waitForSelector('.product-list');
await page.raceRecordingStart();
await page.waitForTimeout(1500);

await page.raceStart('Add to cart flow');
await page.click('.add-to-cart');
await page.waitForSelector('.cart-badge');
page.raceEnd('Add to cart flow');

await page.waitForTimeout(1500);
await page.raceRecordingEnd();
```

Run it under realistic conditions with throttling to see how it feels on real devices:

```bash
node race.js ./races/checkout-v2-vs-v3 --network=fast-3g --cpu=4 --runs=5
```

### Comparing competing products or frameworks

Which dashboard loads faster — yours or the competition? Which CSS framework renders a complex layout quicker? Set up a head-to-head:

```text
races/react-vs-svelte-todo/
  react-todo.spec.js      # React TodoMVC
  svelte-todo.spec.js     # Svelte TodoMVC
```

### Measuring the impact of a single change

Want to know if lazy-loading images actually helped? Create two racers that hit the same page — one with the feature flag on, one off:

```text
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

Both `--network` and `--cpu` accept a list. Every combination is raced separately, each into its own results subdirectory:

```bash
node race.js ./races/my-race --cpu=1,4              # cpu1x/, cpu4x/
node race.js ./races/my-race --network=slow-3g,4g --cpu=1,4  # slow-3g-cpu1x/, slow-3g-cpu4x/, 4g-cpu1x/, 4g-cpu4x/
```

Afterwards you get a **performance matrix** — network presets down the side, CPU rates across the top, every racer's total time in each cell — printed to the terminal and rendered as the top-level `index.html`, where each cell links to that condition's own results:

```text
  ⚡ Performance Matrix
  Network  CPU 1x            CPU 4x
  none     🏆 lauda  0.900s  🏆 lauda  3.600s
              hunt   1.100s     hunt   4.400s

  slow-3g  🏆 hunt   2.720s  🏆 hunt  10.880s
              lauda  2.880s     lauda 11.520s
  Conditions won: lauda 2 · hunt 2
```

One race per condition tells you who won each; the matrix tells you how the field holds up as conditions get harder — and whether the winner flips somewhere along the way.

The HTML matrix also has a **Compare** picker: switch the whole grid from total time to any performance-profile metric that was captured — network transfer, request count, script execution, layout time, TTFB, FCP, LCP, CLS, DOM timings, JS heap — for the measured section or the total recording. Bars rescale to the chosen metric, and a cell is only called a win when the difference clears that metric's significance threshold; anything smaller shows as a tie.

The `--runs` flag takes the median, smoothing out noise and giving you a number you can trust. In multi-run mode, each racer independently picks the run closest to their own median — so if Racer A performed best in Run 2 and Racer B in Run 4, each gets their own representative video. The results page shows which runs were selected (e.g., "Runs 2, 4").

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
node race.js <dir> --network=slow-3g,4g   # Full season — race each condition separately
node race.js <dir> --cpu=4                # Ballast penalty (CPU throttle)
node race.js <dir> --cpu=1,4              # Race each CPU throttle rate separately
node race.js <dir> --format=mov           # Broadcast-ready replay format (requires --ffmpeg)
node race.js <dir> --format=gif           # Quick highlight reel (requires --ffmpeg)
node race.js <dir> --runs=3               # Best of 3 — median wins
node race.js <dir> --slowmo=2             # Slow-motion replay (2x, 3x, etc.)
node race.js <dir> --overlay=false        # Record videos without overlays
node race.js <dir> --recording=false      # Skip video recording, just measure
node race.js <dir> --ffmpeg               # Enable FFmpeg processing (trim, merge, convert)
node race.js <dir> --har                  # Record network HAR files alongside videos
node race.js <dir> --wasm=false           # Skip copying ffmpeg.wasm files (~25 MB) to results
node race.js <dir> --serve=false          # Don't start local results server or auto-open; print results HTML path
node race.js <dir> --pause                # Pause between racers — run all laps for each racer, then press Enter for the next
node race.js <dir> --height=900           # Set viewport/recording height in pixels (480–4320, default 720)
node race.js <dir> --ignore-https-errors  # Accept invalid/self-signed TLS certificates
node race.js <dir> --skin=light           # Skin the results player (light, neon, or a path to a .css file)
```

CLI flags always override `settings.json`. For boolean flags, you can pass explicit values like `--parallel=false` or `--ffmpeg=true`.

### Network Throttling Presets

| Preset | Download | Upload | Latency |
|---|---|---|---|
| `slow-3g` | 500 Kbps | 500 Kbps | 400 ms |
| `fast-3g` | 1500 Kbps | 750 Kbps | 150 ms |
| `4g` | 4000 Kbps | 3000 Kbps | 50 ms |

### Serial vs Parallel: Accuracy vs Spectacle

By default, races run in **serial** (sequential) mode — one browser at a time. This gives you the most accurate and reliable timing results because each racer gets the full, undivided attention of your machine's CPU and network stack. If you care about the numbers, stick with serial.

**Parallel mode** (`--parallel`) launches all browsers simultaneously and is purely for the show. It's demo day mode — the wizard-of-many-windows spectacle where browsers tear down the track side by side in real time. It looks fantastic in presentations and screen recordings, but since all browsers compete for the same system resources, the timings are less reliable. Use it when you want to impress an audience, not when you need to trust the stopwatch.

## Race Results

After every race, the results land in a timestamped folder:

```text
races/my-race/results-2026-01-31_14-30-00/
  contender-a/
    contender-a.race.webm     # Onboard camera footage
    contender-a.full.webm     # Full session recording (--ffmpeg only)
    contender-a.trace.json    # Performance trace (always generated)
    measurements.json          # Lap times
  contender-b/
    ...
  contender-a-vs-contender-b.webm   # Side-by-side broadcast replay (--ffmpeg only)
  index.html                          # Interactive HTML player with video replay
  summary.json                        # Official race classification
  README.md                           # Race report card
```

By default, the HTML player handles virtual trimming via clip times and uses CDP screencast metadata or canvas-based calibration for frame-accurate playback — no external dependencies needed. When neither calibration source is available, it falls back to linear time-mapping which is less precise. With `--ffmpeg`, videos are physically trimmed, a side-by-side merged video is created, and format conversion (mov/gif) is available.

The player includes segment navigation buttons — **Race Recording** (all measurements combined), individual named segments (one per `raceStart`/`raceEnd` pair), and **Whole Recording** (full unclipped video when available). This lets you scrub directly to any specific measurement.

Disclaimer: Due to the nature of the way the video is transformed, the aim here is not accuracy, it's to showcase, to visualize performance. To compare between different network and browser settings.
Do double check and question the metrics and findings. It should be a helpful tool supporting performance related narratives, but don't assume 100% accuracy. However, this generally applies to many 
browser gained performance metrics. There are many side effects. And screen recording, plus video cutting is another one.

### Skinning the player

The report's stylesheet is built from design tokens — a palette layer, a
semantic layer, and a component layer that contains no literal colours at all.
A skin is therefore just a CSS file that redefines tokens:

```bash
node race.js ./races/lauda-vs-hunt --skin=light       # built-in
node race.js ./races/lauda-vs-hunt --skin=./team.css  # your own
```

Two skins ship with the tool (`light`, `neon`) and live in `cli/skins/`. One
skin themes the whole report set — the results player and, for a multi-condition
race, the performance matrix above it — because both pages inline the same
`cli/tokens.css`. Skins are inlined into the page, so exported HTML and ZIP
bundles keep their theme. See [docs/skinning.md](docs/skinning.md) for the full
token reference.

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
  "headless": false,
  "runs": 1,
  "slowmo": 0,
  "format": "webm",
  "ffmpeg": false,
  "har": false,
  "noOverlay": false,
  "noRecording": false,
  "noWasm": false,
  "noServe": false,
  "pauseBetweenRuns": false,
  "ignoreHTTPSErrors": false,
  "viewportHeight": 720,
  "skin": "light"
}
```

| Field | CLI flag | Values (booleans accept `true`/`false`, `1`/`0`, `yes`/`no`) | Default |
|---|---|---|---|
| `parallel` | `--parallel` | `true` / `false` | `false` |
| `network` | `--network=<preset>[,<preset>…]` | `none`, `slow-3g`, `fast-3g`, `4g` — a comma-separated list (or JSON array) races each condition separately, with results in a subdirectory named after the condition | `none` |
| `cpuThrottle` | `--cpu=<n>[,<n>…]` | `1` (none) to any multiplier — a comma-separated list (or JSON array) races each rate separately, with results in a subdirectory named after the rate | `1` |
| `headless` | `--headless` | `true` / `false` | `false` |
| `runs` | `--runs=<n>` | integer ≥ 1 (median of N runs) | `1` |
| `slowmo` | `--slowmo=<n>` | `0` (off) to `20` (multiplier) | `0` |
| `format` | `--format=<fmt>` | `webm`, `mov`, `gif` | `webm` |
| `ffmpeg` | `--ffmpeg` | `true` / `false` | `false` |
| `har` | `--har` | `true` / `false` | `false` |
| `noOverlay` | `--overlay` | `true` / `false` (inverted: `overlay=false` => `noOverlay=true`) | `false` |
| `noRecording` | `--recording` | `true` / `false` (inverted: `recording=false` => `noRecording=true`) | `false` |
| `noWasm` | `--wasm` | `true` / `false` (inverted: `wasm=false` => `noWasm=true`) | `false` |
| `noServe` | `--serve` | `true` / `false` (inverted: `serve=false` => `noServe=true`) | `false` |
| `pauseBetweenRuns` | `--pause` | `true` / `false` | `false` |
| `ignoreHTTPSErrors` | `--ignore-https-errors` | `true` / `false` | `false` |
| `viewportHeight` | `--height=<px>` | integer, 480–4320 | `720` |
| `skin` | `--skin=<name\|path>` | `light`, `neon`, or a path to a `.css` file — see [Skinning the player](docs/skinning.md) | not set (built-in dark theme) |
| `racers` | — | optional object keyed by racer name | not present by default |

For boolean fields, prefer JSON literals `true` / `false` (not strings). String values like `"false"` are normalized when possible. On the CLI, boolean flags also accept explicit values (`--headless=false`, `--har=true`) and short values (`--serve=0`, `--overlay=1`).

## Setup and Teardown Scripts

Need to start a dev server before racing, or clean up after? Drop setup and teardown scripts into your race directory — they run automatically.

### Convention-based discovery

```text
races/my-race/
  setup.sh              # Global setup — runs before all races
  teardown.sh           # Global teardown — runs after all races (even on failure)
  contender-a.spec.js
  contender-a.setup.sh  # Per-racer setup — runs before this racer
  contender-a.teardown.sh
  contender-b.spec.js
  settings.json
```

Supported extensions: `.sh` (shell, requires bash) and `.js` (Node.js). When both exist, `.sh` takes priority. Note: `.js` files run according to Node's module resolution rules (ESM or CommonJS depends on the nearest `package.json` with `"type": "module"`).

Scripts receive the `RACE_DIR` environment variable pointing to the race directory. Per-racer setup and teardown scripts also receive each entry from that racer's `vars` (in `settings.json`) as `RACE_VAR_<KEY>` — useful for sharing one script across racers that only differ by a commit hash, branch name, etc.

### Settings-based configuration

For more control, configure scripts in `settings.json` with timeouts and service readiness polling:

```json
{
  "setup": {
    "command": "./start-server.sh",
    "timeout": 120000,
    "waitFor": {
      "url": "http://localhost:3000/health",
      "timeout": 30000,
      "interval": 1000
    }
  },
  "teardown": "./stop-server.sh",
  "racers": {
    "contender-a": {
      "setup": "./seed-db.sh",
      "teardown": "./cleanup-db.sh"
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `setup` / `teardown` | `string` or `object` | Script path (relative to race dir) or config object |
| `command` | `string` | Script path when using object form |
| `timeout` | `number` | Max execution time in ms (default: 300000) |
| `waitFor.url` | `string` | Poll this URL after script completes |
| `waitFor.timeout` | `number` | Max polling time in ms (default: 30000) |
| `waitFor.interval` | `number` | Polling interval in ms (default: 1000) |

### Execution order

1. Global setup
2. For each racer, in order:
   - Per-racer setup (e.g., `contender-a.setup.sh`)
   - All runs of that racer
3. Per-racer teardown (for each racer, even on failure)
4. Global teardown (even on failure)

When per-racer setup scripts exist, racers run one at a time (split mode) so each setup can prepare the environment before its racer's runs. Without per-racer setups, all racers run together in each run.

Set `setup` or `teardown` to `false` or `""` in settings to explicitly disable a discovered script.

## Prerequisites

- **Node.js** 18+ (required)
- **FFmpeg** (optional — only needed with `--ffmpeg` for physical video trimming, side-by-side merging, and format conversion)

FFmpeg is **not required** for normal use. The HTML player handles virtual trimming with frame-accurate canvas-based calibration and includes a client-side Export button for creating side-by-side videos directly in the browser.

See the **[Installation Guide](INSTALLATION.md)** for detailed setup instructions on every platform.

## Project Structure

```text
RaceForThePrize/
├── race.js                 # 🏁 Main entry point — the race director
├── runner.cjs              # Playwright automation engine
├── sync-barrier.cjs        # Parallel mode checkpoint synchronization
├── visual-stability.cjs    # Wait-for-visual-stability detection logic
├── trace-calibration.cjs   # Derive timing from Chrome performance traces
├── cli/
│   ├── animation.js        # Live terminal racing animation
│   ├── colors.js           # ANSI color palette
│   ├── config.js           # Argument parsing & racer discovery
│   ├── profile-analysis.js # CDP performance metrics collection & analysis
│   ├── player.html         # HTML player markup + build-time templates
│   ├── tokens.css          # Design tokens shared by every generated report
│   ├── player.css          # HTML player component styles
│   ├── player-runtime/     # HTML player client-side runtime (playback, calibration, export)
│   ├── player-sections.js  # HTML player template sections
│   ├── race-utils.js       # Shared race utility helpers
│   ├── results.js          # File management & video conversion
│   ├── condition-matrix.js # Cross-condition performance matrix (terminal + HTML)
│   ├── skins.js            # Skin resolution for --skin
│   ├── skins/              # Built-in player skins (light, neon)
│   ├── summary.js          # Results formatting & markdown reports
│   ├── sidebyside.js       # FFmpeg video composition (--ffmpeg)
│   └── videoplayer.js      # Interactive HTML player with clip-based trimming
├── races/
│   ├── lauda-vs-hunt/        # 🏆 Example: the greatest rivalry in racing
│   ├── lebron-vs-curry/      # 🏀 Example: the GOAT debate, dribble-style
│   └── react-vs-angular/     # ⚛️  Example: frontend framework showdown (4 racers)
├── docs/
│   └── skinning.md         # Design tokens & how to write a player skin
├── presentation/
│   ├── slides.md           # Marp slide deck
│   └── script.md           # Speaker notes (7 slides, ~7 min)
├── tests/                  # Unit tests (vitest)
├── integration/            # Integration tests (vitest)
└── package.json
```

## Presenting RaceForThePrize

The `presentation/` folder contains a ready-to-use slide deck and speaker script for introducing the tool to an audience.

- **`slides.md`** — 7-slide [Marp](https://marp.app/) deck covering positioning, the race API, live demo, and results
- **`script.md`** — Speaker notes with timing guidance, audience adaptation tips, and key phrases to land

Generate slides with Marp:

```bash
npx @marp-team/marp-cli presentation/slides.md --html -o presentation/slides.html
```

## Running Tests

```bash
npm test                                          # Unit tests (vitest)
npm run test:integration                          # Integration tests (calibration, trimming)
npx vitest run tests/summary.test.js              # Run a single test file
```

## Standing on the Shoulders of Giants

- Built by [@kertal](https://github.com/kertal) and his agents [The Flaming Bits](https://claude.com/product/claude-code). More humans with or without agents are welcome!
- Built on top of the mighty [Playwright](https://playwright.dev/) — the browser automation framework that makes all of this possible.
- Built with support of the great "[Race for the Prize](https://www.youtube.com/watch?v=bs56ygZplQA)" song by [The Flaming Lips](https://www.flaminglips.com/). 

## License

MIT
