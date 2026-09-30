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

`--recording=false` is the exception to all of this: it keeps the measurements,
the traces, `summary.json` and the Markdown report card, and writes no videos
and no `index.html` at all. Nothing is served and nothing opens — the numbers
are the whole output.

By default, the HTML player handles virtual trimming via clip times and uses CDP screencast metadata or canvas-based calibration for frame-accurate playback — no external dependencies needed. When neither calibration source is available, it falls back to linear time-mapping which is less precise. With `--ffmpeg`, videos are physically trimmed, a side-by-side merged video is created, and format conversion (mov/gif) is available.

The player includes segment navigation buttons — **Race Recording** (all measurements combined), individual named segments (one per `raceStart`/`raceEnd` pair), and **Whole Recording** (full unclipped video when available). This lets you scrub directly to any specific measurement.

The videos are laid out in finishing order — winner first, then 2nd, 3rd — ranked by total time across all sections, the same way the overall winner is decided. (When two totals are within a frame of each other, the per-section rankings break the tie.)

With `--fps`, the profile grows a **Smoothness** category — median, 95th
percentile and worst frame time, plus dropped frames — for the whole race and for
each measured section. Those come from the same trace, counting the frames the
compositor actually drew, so they cost the page nothing; see
[Measuring Frame Rate](cli.md#measuring-frame-rate) for how to read them and what
a scripted scroll does to the dropped-frame count.

Every comparison — the results table, the performance profile, the run-by-run tables and the condition matrix — shows each losing value next to its gap to the winner, both absolute and relative: `2.500s (+1.500s, +150%)` reads "a second and a half behind, which is 150% slower than the winner". Profile metrics get the same treatment (`+299.7 KB, +46%` means 46% more bytes than the leanest racer). The percentage is left out when the winner's value is zero, since there is nothing to be a percentage of.

The winner carries the other side of that gap: `1.000s (🏆 60% ahead)` means it needed 60% less than the runner-up did. The two percentages describe one gap from opposite ends — 150% counted up from the winner is the same distance as 60% counted down from the loser — so the winner's number is always measured against the *next-fastest* racer, not the slowest. A shared fastest value is nobody's lead, and shows none.

The moment a racer's own finish frame plays, a placement badge appears under its video — `🥈 2nd · 3.000s total` — computed from the final results rather than from recording order, so it matches the summary (including joint places). With `--runs`, that total is the summary's median while the video is one representative run, so the badge can read a little off from the frames it sits over; it is the race result, not a stopwatch on that clip. The in-browser side-by-side export draws the same label. `--ffmpeg` output (trimmed videos, the merged side-by-side file, MOV/GIF) carries no placement; the results table is the record there.

## Taking the Numbers to a Spreadsheet

Every report carries a collapsed **Spreadsheet Export** section — in the results
player and, for a multi-condition race, in the performance matrix above it —
that hands the numbers over the way a spreadsheet wants them: plain values, the
unit in its own column, one column per racer, one row per measurement. Each
racer column is headed by the name behind its colour dot (`🔴 lauda`, `🔵 hunt`),
the colour it wears on the page, and every row ends with three verdict columns:
**Winner** (the racer with the lowest value in that row, or `🤝 Tie`),
**Delta to 2nd** (the winner's lead over the runner-up, in the row's unit) and
**Delta %** (that lead as a percentage of the runner-up — the same "60% ahead"
the report prints beside a winner). A row with fewer than two values has nobody
to beat and leaves all three empty.

Tick the tables you want — or, for a finer cut, use the checkbox on each row of
the preview to include or leave out single measurements; a table's checkbox
shows a mixed state while only some of its rows are in, and a row that is left
out stays in the preview, struck through, so it can be brought back. Then
either **Copy for spreadsheet** (tab-separated
text — click a cell in Excel, Google Sheets or Numbers and paste),
**Download CSV**, or **Copy as Markdown** (a GitHub-flavored table, ready to
paste into an issue, a pull request or a README, with the racer columns
right-aligned). The tables on offer follow what the race produced:

| Page | Tables |
|---|---|
| Single race | **Race Results** (every timed section plus the total, in seconds) · **Performance: Race** and **Performance: Total Recording** (the CDP metrics, in bytes, requests, ms or score) · one **Performance: Section …** table per timed section when there are several |
| `--runs=N` median page | The same, with the results marked as the median, plus one **Run-by-Run** table per measurement and per profile metric: every run, then the median and the average |
| Multi-condition matrix | One table per metric — total time and every captured profile metric — with a row per throttling condition and its network preset and CPU rate as columns of their own, so a sheet can pivot on either |

Values are the raw numbers behind the formatted ones (`12345` bytes rather than
`12.1 KB`), rounded to six decimals; a racer that recorded nothing leaves an
empty cell, never a dash or a zero. A label that starts like a formula (`=`,
`+`, `-`, `@`) is prefixed with an apostrophe, which spreadsheets read as
"plain text" and hide, so a section name can never run as one. Tick **Decimal comma** if your spreadsheet
speaks a comma-decimal locale — the copy switches `1.234` to `1,234` and the CSV
to semicolons, so nothing lands as text or a date. The preview table under the
controls shows exactly what will be copied, minus the struck-through rows;
without JavaScript it still shows every table, and selecting it and copying by
hand pastes into a sheet as cells too. Exported HTML and ZIP bundles keep the section, working, since the data
travels inside the page.

The **Run-by-Run Comparison** section on a `--runs=N` median page has copy
buttons of its own: above each table, **Copy for spreadsheet** and **Copy as
Markdown** take just that table, and the bar on top of the section takes all of
them. The spreadsheet copy is the same tab-separated numbers the export panel
gives for that table; the Markdown copy is the table as the page shows it —
trophies, gaps, the median and average rows in bold — under a bold title, so it
reads the same in a GitHub pull request as it does in the report.

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
- 📊 Bar chart comparison of every timed measurement, each loser tagged with its gap to the winner (`+1.500s, +150%`) and the winner with its lead over the runner-up (`60% ahead`)
- 🥇🥈 Medal assignments per measurement
- 🏆 **Overall winner declared**
- 📹 Side-by-side video replay (in-browser export, or physical file via `--ffmpeg`)
- 📈 Chrome performance traces (open in `chrome://tracing`)


---

Next: [skin the player](skinning.md) · [race flags](cli.md) · [what you can race](use-cases.md)
