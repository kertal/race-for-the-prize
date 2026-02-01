# AGENT.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

RaceForThePrize is a CLI tool that pits two browsers against each other in head-to-head performance battles using Playwright. It runs two `.spec.js` scripts (racers), measures execution times, records video, and declares a winner.

## Commands

```bash
npm install && npx playwright install chromium   # Setup
npm test                                          # Run all tests (vitest)
npx vitest run tests/summary.test.js              # Run a single test file
node race.js ./races/lauda-vs-hunt                # Run a race
```

## Architecture

**Entry point:** `race.js` (ESM) — parses CLI args, discovers racers, spawns `runner.cjs` as a child process, drives animation, and generates results.

**Playwright engine:** `runner.cjs` (CommonJS) — launched as a subprocess by `race.js`. Runs two Chromium instances (parallel via `SyncBarrier` or sequential), injects the race API into pages, records video, handles network/CPU throttling via CDP, and outputs JSON results on stdout.

**CLI modules (`cli/`):**
- `config.js` — arg parsing, `.spec.js` file discovery, settings override logic
- `animation.js` — live terminal race animation
- `summary.js` — winner computation, terminal output, JSON/Markdown report generation
- `results.js` — moves recordings from temp dirs, video format conversion (WebM→MOV/GIF)
- `sidebyside.js` — FFmpeg side-by-side video composition
- `colors.js` — ANSI color codes

**Race definitions (`races/`):** Each race is a directory containing two `.spec.js` files and an optional `settings.json`. The spec files use the injected race API: `page.raceStart(name)`, `page.raceEnd(name)`, `page.raceRecordingStart()`, `page.raceRecordingEnd()`.

## Key Design Details

- `race.js` uses ESM; `runner.cjs` uses CommonJS (Playwright subprocess requirement).
- Parallel mode uses a `SyncBarrier` class to synchronize two browser instances at checkpoints (ready, recordingStart, stop).
- Video trimming uses visual cue detection (colored pixels injected into the page) for frame-accurate segment extraction via FFmpeg.
- CLI flags override `settings.json` values (CLI takes priority). See `config.js` `applyOverrides()`.
- Tests exclude `races/` and `runner/` directories (configured in `vitest.config.js`).
