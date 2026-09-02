# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other AI coding agents when working with code in this repository. (`AGENT.md` points here.)

## Project Overview

RaceForThePrize is a CLI tool that pits browsers against each other in head-to-head performance battles using Playwright. It runs `.spec.js` scripts (racers), measures execution times, records video, and declares a winner.

## Commands

```bash
npm install && npx playwright install chromium   # Setup
npm test                                          # Unit tests (vitest, tests/)
npm run test:integration                          # Integration tests (integration/, needs Chromium; some need ffmpeg/ffprobe)
npx vitest run tests/summary.test.js              # Run a single test file
node race.js ./races/lauda-vs-hunt                # Run a race
```

## Architecture

**Entry point:** `race.js` (ESM) — parses CLI args, loads the race directory (multi-spec, shared-spec, or URL mode), spawns `runner.cjs` as a child process, drives the terminal animation, and generates results (summary, Markdown report, HTML player). Also contains the local results HTTP server, `--init` scaffolding, per-racer setup/teardown execution, and optional Gemini commentary.

**Playwright engine:** `runner.cjs` (CommonJS) — launched as a subprocess by `race.js`. Owns the browser lifecycle: launches 2–5 Chromium instances (parallel or sequential), attaches the race API to pages, records video, collects traces, and prints one JSON result line on stdout. Its supporting modules:

- `runner-protocol.cjs` — the versioned parent ↔ runner contract: `PROTOCOL_VERSION` (both sides reject a mismatch), the `RESULT_SENTINEL` stdout prefix, and builders/parsers for the machine-read stderr line formats (`__raceMessage__`, context-closed marker).
- `race-api.cjs` — the `page.race*` state machine (segments, measurements, auto-recording). Pure and unit-tested; runner-specific side effects (trace marks, overlays, cues, metrics, barriers) are injected as hooks by `runner.cjs`.
- `runner-metrics.cjs` — CDP metrics collector (network totals, Performance API deltas, web vitals, per-section metrics) and the tracing lifecycle.
- `runner-video.cjs` — recording lookup, ffmpeg segment extraction/concatenation, stale-video cleanup.
- `runner-throttling.cjs` — network presets and CPU throttling via CDP.
- `runner-layout.cjs` — pure window-geometry math for 2–5 parallel browser windows.
- `sync-barrier.cjs` — synchronization barrier for parallel mode, with a timeout so a hung racer can't deadlock the run.
- `overlay.cjs` — in-page status overlays, medals, and the opt-in cue flashes.
- `trace-calibration.cjs` — pure transform from Playwright trace JSON to recording segments, measurements, and video calibration data.
- `visual-stability.cjs` — `raceWaitForVisualStability` polling logic (dependency-injected, Playwright-free).

**CLI modules (`cli/`):**
- `config.js` — arg parsing, racer/`.spec.js` discovery, settings defaults/validation/override logic
- `animation.js` — live terminal race animation
- `summary.js` — summary data model, terminal output, JSON/Markdown report generation
- `race-utils.js` — overall-winner computation and `TIE_THRESHOLD_PERCENT`
- `profile-analysis.js` — CDP metric definitions (`PROFILE_METRICS`), comparison, terminal/Markdown rendering
- `results.js` — moves recordings from temp dirs, video format conversion (WebM→MOV/GIF), ffmpeg.wasm asset copying
- `sidebyside.js` — FFmpeg side-by-side video composition
- `videoplayer.js` — assembles the HTML player from `player.html`/`player.css`/`player-runtime/`
- `player-sections.js` — build-time HTML section builders (results table, comparisons, profile tables)
- `player-runtime/` — browser-side player runtime split into concern-scoped files (playback, calibration, debug panel, export, ZIP) concatenated by `videoplayer.js` into one IIFE; the pure `.cjs` cores (calibration, export layout, ZIP/CRC32) are also requirable from Node for tests
- `gemini-summary.js` — optional Gemini CLI integration (post-race commentary, spec generation)
- `colors.js` — ANSI color codes (media constants re-exported for compatibility; import them from `media-config.js`)
- `media-config.js` — shared media/video constants (`FORMAT_EXTENSIONS`, `VIDEO_DEFAULTS`, `SCREEN`, `codecArgs`, `CUE_DETECTION`)
- `paths.js` — output filename convention builders (`<name>.race<ext>`, `.full<ext>`, `.trace.json`, `.har`)

**Race definitions (`races/`):** Each race is a directory containing 2–5 `.spec.js` files (or a single shared `race.spec.js` plus `settings.racers`) and an optional `settings.json`. The spec files use the injected race API: `page.raceStart(name)`, `page.raceEnd(name)`, `page.raceRecordingStart()`, `page.raceRecordingEnd()`, `page.raceMessage(text)`, `page.raceWaitForVisualStability()`.

## Key Design Details

- `race.js` uses ESM; `runner.cjs` and its satellite modules use CommonJS (Playwright subprocess requirement). Everything both processes must agree on lives in `runner-protocol.cjs`.
- Parallel mode uses `SyncBarrier` to synchronize browsers at checkpoints (ready, recordingStart, stop). Every barrier carries a generous deadlock backstop (default 300s) so a hung or out-of-sync racer fails the race instead of wedging the runner forever.
- Timing and video calibration come from the Playwright trace (`trace-calibration.cjs`): the HTML player virtually trims via `traceCalibration`/clip times, and `--ffmpeg` physically trims using trace-derived PTS segments. The colored cue flashes are opt-in (`--cue-markers`) and exist only as ground truth for the ffprobe integration tests — they perturb metrics, so they're off by default.
- CLI flags override `settings.json` values (CLI takes priority). See `config.js` `applyOverrides()`.
- Per-racer setup scripts (e.g. `racer-a.setup.sh`) trigger split execution: each racer's setup runs right before that racer's runs, not all upfront. Without per-racer setups, all racers run together per run.
- Unit tests live in `tests/` (`vitest.config.js` excludes `races/`, `my-races/`, `integration/`). Integration tests live in `integration/` (`vitest.integration.config.js`) and skip themselves when Chromium or ffprobe is unavailable.

## Guidelines

- **Keep dependencies minimal.** Don't add npm packages unless truly necessary. Prefer built-in Node.js APIs and simple custom code over pulling in a library. Every dependency is a maintenance burden — justify it before adding it.
- **Cover changes with tests.** New functionality needs tests. Bug fixes need a regression test. Run `npm test` before considering any change complete. If existing tests break, fix them — don't skip or delete them.
- **Keep it fun and approachable.** This is a playful utility — browser races! The code should be easy to read, easy to hack on, and enjoyable to contribute to. Favor clarity over cleverness. Short functions, obvious names, minimal indirection.
- **Small, focused changes.** Do one thing per commit. Don't bundle unrelated refactors with feature work. Keep pull requests easy to review.
- **Respect the existing style.** Match the conventions already in the codebase — ESM in `race.js` and CLI modules, CommonJS in the runner modules, vitest for tests. Don't introduce new patterns without good reason.
