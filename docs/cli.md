# Race Flags and Settings

Everything you can hand the starter: the command-line flags, the track
conditions they simulate, and the `settings.json` file that makes them stick.


```bash
race-for-the-prize demo                         # List the demo races shipped with the CLI
race-for-the-prize demo:<name>                  # Run a demo race (asks before copying it to ./races/<name>/)
race-for-the-prize demo:<name> --yes            # Copy the demo race without being asked (CI)
race-for-the-prize <url> <url> [url...]         # Quick race — page load times of 2–5 URLs, no spec needed
race-for-the-prize --init [dir]                 # Scaffold a starter race (default dir: my-race)
race-for-the-prize <dir>                        # Green light — run the race
race-for-the-prize <dir> --results              # Check the scoreboard
race-for-the-prize <dir> --parallel             # Side by side — pure spectacle, wizard-of-many-windows mode
race-for-the-prize <dir> --headless             # Lights out — no visible browsers
race-for-the-prize <dir> --network=slow-3g      # Wet track conditions
race-for-the-prize <dir> --network=fast-3g      # Damp track
race-for-the-prize <dir> --network=4g           # Dry track
race-for-the-prize <dir> --network=slow-3g,4g   # Full season — race each condition separately
race-for-the-prize <dir> --cpu=4                # Ballast penalty (CPU throttle)
race-for-the-prize <dir> --cpu=1,4              # Race each CPU throttle rate separately
race-for-the-prize <dir> --format=mov           # Broadcast-ready replay format (requires --ffmpeg)
race-for-the-prize <dir> --format=gif           # Quick highlight reel (requires --ffmpeg)
race-for-the-prize <dir> --runs=3               # Best of 3 — median wins
race-for-the-prize <dir> --slowmo=2             # Slow-motion replay (2x, 3x, etc.)
race-for-the-prize <dir> --overlay=false        # Record videos without overlays
race-for-the-prize <dir> --recording=false      # Skip video recording, just measure
race-for-the-prize <dir> --ffmpeg               # Enable FFmpeg processing (trim, merge, convert)
race-for-the-prize <dir> --har                  # Record network HAR files alongside videos
race-for-the-prize <dir> --wasm=false           # Skip copying ffmpeg.wasm files (~25 MB) to results
race-for-the-prize <dir> --serve=false          # Don't start local results server or auto-open; print results HTML path
race-for-the-prize <dir> --pause                # Pause between racers — run all laps for each racer, then press Enter for the next
race-for-the-prize <dir> --height=900           # Set viewport/recording height in pixels (480–4320, default 720)
race-for-the-prize <dir> --ignore-https-errors  # Accept invalid/self-signed TLS certificates
race-for-the-prize <dir> --wall-clock           # Burn a ticking wall clock into the recording
race-for-the-prize <dir> --skin=light           # Skin the results player (light, neon, or a path to a .css file)
```

CLI flags always override `settings.json`. For boolean flags, you can pass explicit values like `--parallel=false` or `--ffmpeg=true`.

## The Recorded Wall Clock

`--wall-clock` burns a ticking `M:SS.T` readout into the top-left corner of every recording, next to the red recording dot. It counts wall-clock time from the moment recording starts — the same origin the segment and measurement times use, so the digits track the reported numbers closely (the results themselves are calibrated from the Playwright trace afterwards, which can shift them by a tenth or so). In `--parallel` mode, where all racers leave the line together, the same frame reads the same time for everyone. It runs for the whole recording — a spec that measures several sections keeps one clock across all of them, ticking through the untimed waits in between, because that time passes in the video too. When the recording ends the clock freezes on that moment instead of disappearing, so the last frames show how long the lap took.

It's off by default because it isn't free: repainting the digits ten times a second adds style recalculations and paints to the very metrics you're measuring, and the constant activity keeps `page.raceWaitForVisualStability()` from ever seeing the page settle. Turn it on for a video you want to show people, not for a run whose numbers you want to trust. It follows the other overlays, so `--overlay=false` and `--recording=false` switch it off too.

## Network Throttling Presets

| Preset | Download | Upload | Latency |
|---|---|---|---|
| `slow-3g` | 500 Kbps | 500 Kbps | 400 ms |
| `fast-3g` | 1500 Kbps | 750 Kbps | 150 ms |
| `4g` | 4000 Kbps | 3000 Kbps | 50 ms |

## Serial vs Parallel: Accuracy vs Spectacle

By default, races run in **serial** (sequential) mode — one browser at a time. This gives you the most accurate and reliable timing results because each racer gets the full, undivided attention of your machine's CPU and network stack. If you care about the numbers, stick with serial.

**Parallel mode** (`--parallel`) launches all browsers simultaneously and is purely for the show. It's demo day mode — the wizard-of-many-windows spectacle where browsers tear down the track side by side in real time. It looks fantastic in presentations and screen recordings, but since all browsers compete for the same system resources, the timings are less reliable. Use it when you want to impress an audience, not when you need to trust the stopwatch.


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
  "wallClock": false,
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
| `wallClock` | `--wall-clock` | `true` / `false` | `false` |
| `viewportHeight` | `--height=<px>` | integer, 480–4320 (also accepted as `height` in settings.json) | `720` |
| `skin` | `--skin=<name\|path>` | `light`, `neon`, or a path to a `.css` file — see [Skinning the player](skinning.md) | not set (built-in dark theme) |
| `racers` | — | optional object keyed by racer name | not present by default |

For boolean fields, prefer JSON literals `true` / `false` (not strings). String values like `"false"` are normalized when possible. On the CLI, boolean flags also accept explicit values (`--headless=false`, `--har=true`) and short values (`--serve=0`, `--overlay=1`).


---

Next: [reading the results](results.md) · [write your own race](writing-races.md)
