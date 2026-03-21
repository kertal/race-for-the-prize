# Code Readability & Structure Improvement Plan

## Phase 1: Dead Code Removal (low risk, quick wins)

| What | Where | Why |
|------|-------|-----|
| Remove `winnerBanner` / `videoSourceNote` placeholders | `cli/videoplayer.js:76,150` + `cli/player.html` | Always empty strings, render nothing |
| Simplify `wasConverted` variable | `cli/player-runtime.js:183-197` | Always false — guard on line 180 already skips converted entries |
| Remove unreachable racer count warning | `race.js:541-543` | `discoverRacers()` already slices to 5; this check never triggers |
| Remove empty `module.exports = {}` | `runner.cjs:1149` | Exports nothing; dead code |
| Remove unused `sortByValue` export | `cli/player-sections.js:35` | Only used internally, never imported elsewhere |

## Phase 2: Extract & Deduplicate (high impact, moderate effort)

### 2a. Split `race.js` into CLI + library

Currently 860+ lines mixing reusable functions with CLI-only logic nested inside `if (isMainModule)`.

```
race.js (860 lines)
  ├── Exported/reusable: spawnRunner, runSingleRace, buildRaceContext,
  │   createStaticHandler, serveResults, formatTimestamp, buildResultsPaths,
  │   waitForEnter
  └── CLI-only (inside isMainModule): loadRaceDir, runRacerAlone,
      buildRunOutput, buildMedianOutput, main
```

**Target:**
- `cli/race-runner.js` — reusable exports (spawnRunner, runSingleRace, buildRaceContext, etc.)
- `race.js` — thin CLI entry point importing from above

### 2b. Deduplicate `runSingleRace` / `buildRunOutput`

These share near-identical logic for:
- Building `clipTimes` from `recordingSegments`
- Copying race scripts and settings.json
- Building player HTML options and writing index.html

**Target:** Extract shared `buildRunDir(runDir, racerNames, results, settings, ctx)` helper.

## Phase 3: Named Constants (medium impact, low risk)

| Current | Proposed Name | Files |
|---------|--------------|-------|
| `0.04` | `FRAME_DURATION_25FPS` | `cli/player-runtime.js` (2 places) |
| `5` | `MAX_RACERS` | `cli/config.js:50`, `race.js:541` |
| `54` | `TERMINAL_WIDTH` | `cli/summary.js:174`, `cli/profile-analysis.js:271` |
| `100` | `MAX_RUNS` | `cli/config.js:95` |
| `480`, `4320` | `MIN_VIEWPORT_HEIGHT`, `MAX_VIEWPORT_HEIGHT` | `cli/config.js:103` |
| `120`, `50` | `META_POLL_MAX_ATTEMPTS`, `META_POLL_INTERVAL_MS` | `cli/player-runtime.js:1007` |
| `640`, `480`, `30` | `EXPORT_WIDTH_2TO3`, `EXPORT_WIDTH_4TO5`, `EXPORT_LABEL_HEIGHT` | `cli/player-runtime.js:1017-1018` |
| `'#00FF00'`, `'#FF0000'` | `CUE_COLOR_START`, `CUE_COLOR_END` | `runner.cjs:469-472` |

Best home for shared constants: `cli/colors.js` (already has `VIDEO_DEFAULTS`, `CUE_DETECTION`).

## Phase 4: Split Large Functions & Files (high effort)

### 4a. `runMarkerMode` in `runner.cjs` (325 lines, 15+ inner closures)

Extract into composable pieces:
- **Race API injector** (`race-api.cjs`): `startRecording`, `stopRecording`, `startMeasure`, `endMeasure`, `raceWaitForVisualStability`
- **Overlay manager** (inline module or separate): `injectOverlay`, `showRecordingIndicator`, `hideRecordingIndicator`, `showFinishTime`, `showMedal`, `flashCue`

### 4b. `player-runtime.js` (1569 lines)

Natural split points (can be concatenated at build time):
- **Calibration & playback** (~400 lines): `onMeta`, `applyCalibrationToClip`, `seekAll`, `seekAllWithVerify`, playback handlers
- **Debug panel** (~250 lines): `adjustDebugOffset`, `getAdjustedClipTimes`, debug display
- **Segment navigation** (~100 lines): `buildSegmentNav`, `getSegmentClipTimes`
- **Canvas export** (~300 lines): `getExportLayout`, `drawExportFrame`, `startExport`
- **FFmpeg conversion** (~120 lines): `loadFFmpeg`, `toBlobURL`, `convertWithFFmpeg`
- **ZIP builder** (~100 lines): `createZipBuilder`, `crc32`, CRC table

## Phase 5: Documentation & Consistency (ongoing)

### Key functions needing JSDoc

| Function | File | Why |
|----------|------|-----|
| `onMeta` | `player-runtime.js:151` | Most complex calibration logic, no docs |
| `runRacerAlone` | `race.js:653` | Complex pause-mode orchestration |
| `buildRunOutput` | `race.js:674` | Post-processing pipeline |
| `startProfiling` | `runner.cjs:852` | CDP tracing setup |
| `collectProfilingResults` | `runner.cjs:858` | Trace collection + metrics |
| `trimVideoWithFfmpeg` | `runner.cjs:875` | FFmpeg segment extraction |
| `calculateWindowLayout` | `runner.cjs:817` | Has block comment but no @param/@returns |

### Error handling consistency

| Pattern | Used in | Recommendation |
|---------|---------|----------------|
| `console.error` + ANSI colors | race.js, results.js, sidebyside.js | Keep — user-facing |
| `console.error` plain `[id]` prefix | runner.cjs | Keep — subprocess output |
| Silent `catch {}` | runner.cjs (6 places), results.js (1) | Add `console.warn` or comment explaining why silent |

---

## Implementation Order

```
Phase 1 ──→ Phase 3 ──→ Phase 5
  (dead code)  (constants)  (docs)
      │
      └──→ Phase 2 ──→ Phase 4
           (extract)    (split large fns)
```

- Phases 1 and 3 are safe to do together (no structural changes)
- Phase 2 should precede Phase 4 (splitting race.js makes runner.cjs refactoring easier to review)
- Phase 5 can happen continuously alongside any phase
- Each phase is independently shippable and testable
