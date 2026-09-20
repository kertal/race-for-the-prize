# Reading the Results

Every race leaves a paper trail: a timestamped results folder, an interactive
HTML player, a Markdown report card, and the configuration it all ran with.


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
  config.json                         # The command and the settings this race ran with
  README.md                           # Race report card
```

Every results folder keeps its own `config.json`: the exact command line, the
race mode and scripts, and every effective setting alongside where it came from
(a CLI flag, `settings.json`, or the built-in default). The HTML player shows
the same thing under **Command & Configuration**, so a report read a month later
says how to reproduce the race, not just who won.

By default, the HTML player handles virtual trimming via clip times and uses CDP screencast metadata or canvas-based calibration for frame-accurate playback — no external dependencies needed. When neither calibration source is available, it falls back to linear time-mapping which is less precise. With `--ffmpeg`, videos are physically trimmed, a side-by-side merged video is created, and format conversion (mov/gif) is available.

The player includes segment navigation buttons — **Race Recording** (all measurements combined), individual named segments (one per `raceStart`/`raceEnd` pair), and **Whole Recording** (full unclipped video when available). This lets you scrub directly to any specific measurement.

The videos are laid out in finishing order — winner first, then 2nd, 3rd — ranked by total time across all sections, the same way the overall winner is decided. (When two totals are within a frame of each other, the per-section rankings break the tie.)

The moment a racer's own finish frame plays, a placement badge appears under its video — `🥈 2nd · 3.000s total` — computed from the final results rather than from recording order, so it matches the summary (including joint places). With `--runs`, that total is the summary's median while the video is one representative run, so the badge can read a little off from the frames it sits over; it is the race result, not a stopwatch on that clip. The in-browser side-by-side export draws the same label. `--ffmpeg` output (trimmed videos, the merged side-by-side file, MOV/GIF) carries no placement; the results table is the record there.

Disclaimer: Due to the nature of the way the video is transformed, the aim here is not accuracy, it's to showcase, to visualize performance. To compare between different network and browser settings.
Do double check and question the metrics and findings. It should be a helpful tool supporting performance related narratives, but don't assume 100% accuracy. However, this generally applies to many 
browser gained performance metrics. There are many side effects. And screen recording, plus video cutting is another one.

## Skinning the player

The report's stylesheet is built from design tokens — a palette layer, a
semantic layer, and a component layer that contains no literal colours at all.
A skin is therefore just a CSS file that redefines tokens:

```bash
race-for-the-prize ./races/lauda-vs-hunt --skin=light       # built-in
race-for-the-prize ./races/lauda-vs-hunt --skin=./team.css  # your own
```

Two skins ship with the tool (`light`, `neon`) and live in `cli/skins/`. One
skin themes the whole report set — the results player and, for a multi-condition
race, the performance matrix above it — because both pages inline the same
`cli/tokens.css`. Skins are inlined into the page, so exported HTML and ZIP
bundles keep their theme. See [skinning.md](skinning.md) for the full
token reference.

## The Podium Ceremony

The terminal delivers the verdict in style:

- 🏎️ Live racing animation while browsers compete
- 📊 Bar chart comparison of every timed measurement
- 🥇🥈 Medal assignments per measurement
- 🏆 **Overall winner declared**
- 📹 Side-by-side video replay (in-browser export, or physical file via `--ffmpeg`)
- 📈 Chrome performance traces (open in `chrome://tracing`)


---

Next: [skin the player](skinning.md) · [race flags](cli.md) · [what you can race](use-cases.md)
