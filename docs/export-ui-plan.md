# Export UI Streamlining Plan

## Current State

The export overlay has these UX friction points:

1. **Flat action buttons** — Download, Convert GIF, Convert MOV, and Close all look the same; no visual hierarchy
2. **Destructive conversion flow** — clicking "Convert to GIF" wipes the WebM download link
3. **Progress bar resets to 0%** when conversion starts (disorienting after reaching 100%)
4. **Static title** — always says "Exporting Side-by-Side" regardless of state
5. **No keyboard support** — can't press Escape to close

---

## Proposed Design

### State 1: Recording

```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║              ✦  RECORDING SIDE-BY-SIDE  ✦            ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │                                              │    ║
║  │   ┌──────────────┐  ┌──────────────┐        │    ║
║  │   │   Racer A     │  │   Racer B     │        │    ║
║  │   │              │  │              │        │    ║
║  │   │  [video]     │  │  [video]     │        │    ║
║  │   │              │  │              │        │    ║
║  │   └──────────────┘  └──────────────┘        │    ║
║  │            00:00:02.340                      │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  ████████████████░░░░░░░░░░░░░░░░░░░░  42%          ║
║                                                      ║
║  Recording (1x)... 42%                               ║
║                                                      ║
║                  [ Cancel ]                          ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

### State 2: Export Ready (after recording completes)

```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║                ✦  EXPORT READY  ✦                    ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │              [canvas preview]                │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  ████████████████████████████████████████  100%       ║
║                                                      ║
║  Export complete!                                     ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │                                              │    ║
║  │     ┌━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓          │    ║
║  │     ┃  ↓ DOWNLOAD WEBM (2.4 MB)  ┃          │    ║
║  │     ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛          │    ║
║  │               gold bg, primary CTA           │    ║
║  │                                              │    ║
║  │  ─────────── CONVERT ──────────────          │    ║
║  │                                              │    ║
║  │    [ Convert to GIF ]  [ Convert to MOV ]    │    ║
║  │     gold border, secondary actions           │    ║
║  │                                              │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║                                        [ Close ]     ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

### State 3: Converting (e.g. user clicked "Convert to GIF")

The WebM download stays visible. A conversion sub-area appears below.

```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║             ✦  CONVERTING TO GIF...  ✦               ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │              [canvas preview]                │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │                                              │    ║
║  │     ↓ Download WebM (2.4 MB)                 │    ║
║  │                                              │    ║
║  │  ─────────── CONVERT ──────────────          │    ║
║  │  [ Convert to GIF ] ← disabled/active        │    ║
║  │  [ Convert to MOV ] ← disabled               │    ║
║  │                                              │    ║
║  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄       │    ║
║  │  Converting to GIF...                        │    ║
║  │  █████████████░░░░░░░░░░░░░░░  50%           │    ║
║  │                                              │    ║
║  │              [ Cancel ]                      │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

### State 4: Conversion Complete

Both downloads available. Convert buttons re-enabled.

```
╔══════════════════════════════════════════════════════╗
║                                                      ║
║            ✦  CONVERSION COMPLETE  ✦                 ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │              [canvas preview]                │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║  ┌──────────────────────────────────────────────┐    ║
║  │                                              │    ║
║  │     ↓ Download WebM (2.4 MB)                 │    ║
║  │                                              │    ║
║  │  ─────────── CONVERT ──────────────          │    ║
║  │  [ Convert to GIF ]  [ Convert to MOV ]      │    ║
║  │                                              │    ║
║  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄       │    ║
║  │  ✓ GIF ready (1.8 MB)                       │    ║
║  │  ┌━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓             │    ║
║  │  ┃  ↓ DOWNLOAD GIF (1.8 MB)   ┃             │    ║
║  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛             │    ║
║  │                                              │    ║
║  └──────────────────────────────────────────────┘    ║
║                                                      ║
║                                        [ Close ]     ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

---

## Implementation Phases

### Phase 1: Visual Hierarchy (CSS + DOM structure)

**Goal:** Make the primary action obvious and group secondary actions.

**Changes:**

| File | What |
|------|------|
| `cli/player.html` | Add `.export-dl-primary` class (gold bg `#d4af37`, dark text `#1a1a1a`, bold). Add `.export-section-label` class (tiny uppercase Georgia label, `#666` color). Move Close to `align-self: flex-end`. |
| `cli/player-runtime.js` | In `recorder.onstop`: assign primary class to download link, wrap GIF/MOV buttons with a "Convert" label div, place Close button last with right-alignment. |

**Risk:** Low. CSS-only + small DOM restructure.

### Phase 2: Dynamic Title + Progress Continuity

**Goal:** Clear "where am I" at every step.

**Changes:**

| File | What |
|------|------|
| `cli/player.html` | Add `@keyframes export-shimmer` (gold gradient sweep). Add `.export-progress-indeterminate` class. |
| `cli/player-runtime.js` | Update `h3.textContent` at each state transition (Recording → Export Ready → Converting → Complete). During ffmpeg.wasm load phase, add indeterminate shimmer class to progress bar; remove it when conversion starts. Don't reset progress to 0% — start conversion progress from current position. |

**Risk:** Low. 5-6 one-liners at existing state-change points.

### Phase 3: Non-destructive Conversion + Keyboard

**Goal:** Keep WebM download during/after conversion. Basic a11y.

**Changes:**

| File | What |
|------|------|
| `cli/player-runtime.js` | Restructure `convertWithFFmpeg`: instead of `actionsEl.innerHTML = ''`, append a `.export-conversion-area` sub-div below existing actions. On completion, show format download there without removing WebM link. Re-enable convert buttons. Add Escape key handler, `role="dialog"`, focus management. |
| `cli/player.html` | Add `.export-conversion-area` CSS (top border separator, subtle bg differentiation). |

**Risk:** Medium. `convertWithFFmpeg` restructure touches the most code.

---

## Retro Style Guide (for implementation reference)

| Element | Value |
|---------|-------|
| Background | `#1a1a1a` (modal), `#2a2a2a` (buttons) |
| Gold accent | `#d4af37` |
| Text primary | `#e8e0d0` |
| Text muted | `#999` |
| Border | `1px solid #555` (buttons), `2px solid #d4af37` (modal) |
| Title font | Georgia, serif — uppercase, `letter-spacing: 0.1em` |
| Mono font | `ui-monospace, 'Courier New', monospace` |
| Border radius | `8px` (modal), `4px` (buttons, inputs) |
| Transitions | `all 0.2s` |
| Hover pattern | bg → `#3a3a3a`, border → `#d4af37` |
| Primary CTA | Invert: gold bg, dark text (same as hover but persistent) |

---

## Sequence

1. **Phase 1** — ship independently, pure visual improvement
2. **Phase 2** — builds on Phase 1's DOM (references `<h3>`)
3. **Phase 3** — most involved, should follow stable Phase 2

Each phase is independently testable by running a race and clicking through the export flow.
