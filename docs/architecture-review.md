# Architecture Review

Full-codebase architecture review covering the orchestrator (`race.js`), the Playwright runner subsystem (`runner.cjs` + satellite `.cjs` modules), the `cli/` presentation layer, and the test/packaging shape.

> **Status.** This document describes the codebase **as of the commit it was reviewed at** (`6887065`); the sections below are kept as the point-in-time findings. The follow-up commits on this same branch have since addressed: **P0** (packaging `files` list — including, later, the `races/*/*.html` example fixtures), **P1/P6** (server, race loader, task runner, and the player runtime extracted into tested modules), **P2/P3** (`runner-protocol.cjs` now versioned and owning both stderr line formats), **P4** (`SyncBarrier` timeout), **P5** (shared report model + `cli/paths.js`), **P7** (`race-api.cjs` under real tests), and most of **P8** (temp-dir `try/finally`, gitignored `test-results/`, consolidated docs, media constants out of `colors.js`). Still open: the flag-registry consolidation in `config.js`, per-racer `warnings[]` in the result payload, and hoisting `main()`'s remaining topology/median logic.

## Overall verdict

The core ideas are sound — a clean parent/child process split, a deliberate stdout result protocol, pure-function CLI modules, and a real integration suite that exercises ffmpeg and Chromium for the things unit tests can't reach. But the codebase has two god-files (`race.js` at 1,618 lines, `runner.cjs` at 1,119) whose most logic-dense code is structurally untestable, an implicit and unversioned wire contract spread across three files, and presentation logic triplicated across terminal/Markdown/HTML output. There is also one ship-blocking packaging bug.

Rating by area:

| Area | Verdict |
|---|---|
| Process boundary & result protocol | Strong core, incomplete coverage |
| Module decomposition (`race.js`, `runner.cjs`) | Weak — god-files |
| `cli/` presentation layer | Good boundaries, heavy duplication |
| Satellite `.cjs` modules | Strong — the model to imitate |
| Test architecture | Good where modules are pure; blind where they aren't |
| Packaging | Broken (ship-blocker) |
| Docs (`CLAUDE.md`/`AGENT.md`) | Duplicated and stale |

## What is genuinely well-designed

- **`RESULT_SENTINEL` stdout protocol.** `runner-protocol.cjs` gives both processes one shared constant; `race.js:322-333` scans stdout backwards for the sentinel line, tolerating arbitrary Playwright noise, and the runner deliberately *withholds* the sentinel on signal exit (`runner.cjs:181-184`) so an abort reads as failure, not empty success. Well-thought-out contract.
- **`trace-calibration.cjs` is the standout module.** Pure, deterministic trace-JSON → timing transform, zero Playwright coupling, degrades gracefully at every step, trivially unit-tested. `visual-stability.cjs` follows the same pattern (dependency-injected, bounded, structured return).
- **The `cli/` pure-function boundary.** Large modules like `summary.js` (811 lines) and `videoplayer.js` are fully unit-testable because they take data in and return strings/objects out. `PROFILE_METRICS` (`profile-analysis.js:42-50`) is a proper single source of truth consumed by three modules.
- **Client player as a real file.** `player-runtime.js` is a lintable `.js` file injected via `{{placeholder}}` tokens, and HTML skeletons live in `<template id="build-*">` blocks — far better than inline template-string soup.
- **Mature defensive engineering in spots:** error-path forensics with an independent 5s timeout so a hung renderer can't stall cleanup (`runner.cjs:958-991`), `Promise.allSettled` in parallel mode so one racer's crash never loses the other's result (`runner.cjs:1030`), path-traversal/symlink validation on script overrides (`race.js:881-906`), a correct 206/416 range-request static server with COOP/COEP (`race.js:510-576`), concurrency-safe temp naming, prototype-pollution-safe section keys.
- **Integration suite covers what units can't:** real ffmpeg/ffprobe round-trips (`trim-accuracy`, `calibration`, `clip-alignment`) with Chromium-availability skip gating.

## Top problems, ranked

### P0 — The published package crashes on first use
`package.json` `files` ships `race.js, runner.cjs, sync-barrier.cjs, cli/, …` but `runner.cjs:21-24` requires `./visual-stability.cjs`, `./trace-calibration.cjs`, `./overlay.cjs`, `./runner-protocol.cjs` — none of which are in `files`. An `npm install -g` per the ReadMe yields `Cannot find module './visual-stability.cjs'` on the first race. (Bundled example races also lose their `.html` fixtures since only `*.spec.js`/`settings.json` are globbed.)

### P1 — ~60% of `race.js` is untestable by construction
Lines 643–1618 live inside `if (isMainModule)` and are never exported: `main()`'s three execution topologies (single-run / multi-run median / split per-racer), `loadRaceDir`'s mode arbitration **and its security validation**, `runScript`'s subprocess lifecycle with timeout escalation and HTTP `waitFor` poller, median selection, and the HTML-patching functions. The security-critical path checks (`race.js:890-906`, `1129-1135`) are reachable only through full Chromium-gated subprocess runs. Even exported seams (`spawnRunner`, `runSingleRace`, `buildRaceContext`) have zero tests. `race.js` is not a thin orchestrator — it embeds an HTTP static server, a generic task runner, a scaffolder with code templates, an LLM integration, and a regex HTML post-processor.

### P2 — The runner wire contract is implicit, unversioned, and spread across three files
`runner-protocol.cjs` names itself the protocol but exports only the sentinel string. The real contract is much larger and unshared:
- Config shape: authored in `buildRaceContext` (`race.js:460-483`), destructured blind in `runner.cjs:1061`.
- Result shape (`recordingSegments`, `calibratedStart`, `traceCalibration`, …): emitted in `runner.cjs:1087-1104`, re-read in `race.js:195-211` and again in `cli/results.js:15-59` — triplicated field-name knowledge with `?? null` fallbacks, so a rename fails silently as "no data".
- A second, undocumented **stderr protocol**: `[name] __raceMessage__[ts]:msg` (`runner.cjs:605` ↔ `race.js:258-261`) and the literal `[name] Context closed` completion marker (`runner.cjs:904` ↔ `race.js:278`) driving the terminal animation. Pure string-literal coupling; no version field anywhere.

### P3 — Two parallel timing systems; the visual-cue layer is dead weight that perturbs the measurement
Wall-clock markers computed throughout `runMarkerMode` are silently overridden by trace-derived timing whenever a trace exists (`runner.cjs:896-898`) — the normal case. Meanwhile `flashCue` (`overlay.cjs:24-40`) injects a forced reflow (`void el.offsetHeight`) plus a 200ms animated DOM element **at the exact raceStart/raceEnd boundaries** — instrumentation that perturbs the CPU/layout/paint metrics being measured — yet no production consumer reads the cues: the HTML player calibrates exclusively from `traceCalibration.firstFrameTs`, and even `--ffmpeg` trimming uses trace `ptsSegments`. Only integration tests consume cues via ffprobe. CLAUDE.md still describes a Canvas cue-detection path that no longer exists in `cli/`.

### P4 — SyncBarrier has no timeout; a non-throwing hang deadlocks the runner
The barrier's only liveness escape is `sharedState.hasError`, set in a `catch` block. A racer that hangs *without* throwing (e.g. `await new Promise(() => {})`, unbounded by Playwright's page timeout) wedges the other racer at a barrier forever, and `spawnRunner` in the parent waits on child `close` with no overall deadline. Secondary: barriers are created once and reused across cycles; asymmetric explicit `raceRecordingStart/End` counts across racers desync `waiting` vs `count` (the API explicitly supports multi-segment recording).

### P5 — Presentation logic triplicated across terminal / Markdown / HTML
The same comparison/ranking/median/delta algorithms exist three times: `summary.js buildRunComparisonSection` ↔ `player-sections.js buildRunComparisonHtml` (structurally identical loops), `buildResultsTable` ↔ `buildResultsHtml`, `profile-analysis.js buildScopeMarkdown`/`printProfileSection` ↔ `player-sections.js buildProfileHtml`. `sortComparisonsForDisplay` and the synthetic-total predicates are independently defined in both files. Any semantics change must be made in 3–6 places. Related duplication: the GIF palette filter string is assembled in `results.js:156`, `sidebyside.js:27`, and `player-runtime.js:1234`; the N-video layout exists as ffmpeg filters *and* canvas coordinates.

### P6 — `player-runtime.js` (1,899 lines) is tested only by string-matching its own source
`tests/videoplayer.test.js` asserts `expect(html).toContain('function seekAllWithVerify(')` — verifying source text was emitted, not that seeking/calibration/ZIP-export work. The file is one giant IIFE with ~10 shared mutable module-scope state variables and six distinct jobs (playback, calibration, debug panel, canvas export, ffmpeg.wasm conversion, hand-rolled ZIP/CRC32). Its pure functions (`traceTsToClipPts`, `getSegmentClipTimes`, `getExportLayout`, `crc32`) are not importable, though jsdom is already used elsewhere in the suite.

### P7 — A test that validates a copy of production code
`tests/race-api.test.js` cannot import the injected race API (it's built inline in `runner.cjs`), so it hand-replicates the entire state machine — 279 lines with an explicit "Replicate the page.race* attachment" comment. If the real API drifts, this test stays green.

### P8 — Repo/infra hygiene
- `test-results/.last-run.json` (transient Vitest state) is git-tracked and not gitignored; three integration tests write scratch fixtures into that same tracked directory (others correctly use `os.tmpdir()`).
- Temp-dir leak on failure paths: `runSingleRace` and `runRacerAlone` only `rmSync` the recordings dir on success — a crashing/aborted runner accumulates `tmp-*` dirs (no `try/finally`).
- `CLAUDE.md` and `AGENT.md` are near-identical duplicates, both stale: they omit `player-runtime.js` (the largest file in the repo), `player-sections.js`, `profile-analysis.js`, `gemini-summary.js`, `race-utils.js`, and all satellite `.cjs` modules; they misattribute winner logic (it lives in `race-utils.js`, not `summary.js`); they reference a nonexistent `runner/` directory.
- `FORMAT_EXTENSIONS`/`VIDEO_DEFAULTS`/`codecArgs` live in `cli/colors.js` — media constants in the ANSI-colors module.
- Injected race API has silent-swallow semantics (`raceEnd('typo')` → `0`, no error) and a duplicate injection surface (`page.race*` methods vs positional `__startMeasure` args with *different* metrics behavior).
- Degraded-data failures (CDP session fails, ffmpeg missing/corrupt output) log to stderr the parent never parses — they surface only as mysteriously-null report fields.

## Recommended roadmap

**Immediate (ship-blockers / one-liners)**
1. Add the four missing `.cjs` files to `package.json` `files`; verify with `npm pack --dry-run`; consider a packed-tarball smoke test.
2. Gitignore `test-results/`, `git rm --cached` the tracked file, move the three offending integration tests to `os.tmpdir()`.
3. Wrap spawn+move in `try/finally` in `runSingleRace`/`runRacerAlone` so temp recording dirs are cleaned on every exit path.

**High value (correctness & safety)**
4. Give `SyncBarrier.wait()` a deadline that sets `sharedState.hasError`, and add an overall child-process deadline in `spawnRunner`. Make barrier reuse cycle-aware (or allocate per cycle).
5. Make `runner-protocol.cjs` the actual protocol: move the `__raceMessage__` grammar and `Context closed` marker there as shared helpers, add a `PROTOCOL_VERSION` stamped into config and result, and define the config/result shapes once (JSDoc typedef + tiny normalizer) consumed by `buildRaceContext`, `runner.cjs`, `buildClipTimes`, and `results.js`. On mixed versions: parent and runner ship in the same npm package and are never upgraded independently, so a version mismatch only ever means a broken or partially-cached install — strict rejection with a clear "same install" error *is* the compatibility plan, and adjacent-version negotiation is deliberately out of scope until the runner is ever distributed separately.
6. Remove `flashCue` from the measurement hot path — put cues behind an explicit flag used only by integration tests (or retire them for trace `ptsSegments` assertions), and fix the stale CLAUDE.md description.
7. Extract the injected race API from `runner.cjs` into an exported `race-api.cjs` so `tests/race-api.test.js` tests the real thing; drop the duplicate `__startMeasure` injection surface.

**Structural (decomposition)**
8. Hoist `main()`'s logic out of `if (isMainModule)` into exported modules (`orchestrator`, `race-loader`, `task-runner`, `serve`); reduce the block to arg parsing + dispatch. This makes the security validation unit-testable — the code you most want covered.
9. Split `runner.cjs` along its existing seams: `metrics-collector.cjs` (265 lines), `video-ffmpeg.cjs`, `throttling.cjs`, `window-layout.cjs` (pure math), thin CLI entry.
10. Unify the triplicated renderers behind a shared view-model (pure row-building in one module; thin ANSI/Markdown/HTML emitters). Same for the GIF filter string and layout tables.
11. Split `player-runtime.js` into concern-scoped files concatenated at build time; export the pure functions and test them under jsdom instead of source-substring assertions.

**Hygiene**
12. Consolidate `CLAUDE.md`/`AGENT.md` into one file and refresh the module inventory. Move media constants out of `colors.js`. Introduce one `cli/paths.js` owning the `{name}.race.{ext}` / `.full` / `.trace.json` naming convention currently rebuilt in four places. Route degraded-data warnings into a per-racer `warnings[]` in the result JSON so the report can say "profile metrics unavailable for X".
