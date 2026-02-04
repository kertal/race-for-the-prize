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

## Guidelines

- **Keep dependencies minimal.** Don't add npm packages unless truly necessary. Prefer built-in Node.js APIs and simple custom code over pulling in a library. Every dependency is a maintenance burden — justify it before adding it.
- **Cover changes with tests.** New functionality needs tests. Bug fixes need a regression test. Run `npm test` before considering any change complete. If existing tests break, fix them — don't skip or delete them.
- **Keep it fun and approachable.** This is a playful utility — browser races! The code should be easy to read, easy to hack on, and enjoyable to contribute to. Favor clarity over cleverness. Short functions, obvious names, minimal indirection.
- **Small, focused changes.** Do one thing per commit. Don't bundle unrelated refactors with feature work. Keep pull requests easy to review.
- **Respect the existing style.** Match the conventions already in the codebase — ESM in `race.js` and CLI modules, CommonJS in `runner.cjs`, vitest for tests. Don't introduce new patterns without good reason.
