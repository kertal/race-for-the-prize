# Security Code Review — RaceForThePrize

**Date:** 2026-02-06
**Scope:** Full codebase review for security anti-patterns

---

## Summary

The codebase is a CLI benchmarking tool with a small dependency footprint and no
network services. Most file and process operations follow safe patterns. Four
findings are worth addressing, ranked by severity below.

---

## Findings

### 1. Arbitrary Code Execution via `new AsyncFunction()` (HIGH)

**File:** `runner.cjs:730-732`

```js
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const fn = new AsyncFunction('page', '__startRecording', '__stopRecording',
  '__startMeasure', '__endMeasure', sanitized);
await fn(page, startRecording, stopRecording, startMeasure, endMeasure);
```

User-supplied `.spec.js` files are read from disk and evaluated with full
Node.js process privileges. The `sanitizeScript()` function at line 512 only
normalises smart-quotes and unicode whitespace — it performs no security
filtering whatsoever.

**Impact:** A malicious or compromised `.spec.js` file can execute arbitrary
code in the runner process: read/write any file, spawn processes, exfiltrate
data over the network, etc. The `page` object is a full Playwright handle so
the script also has unrestricted browser control.

**Mitigating context:** Race spec files are local files the operator explicitly
chooses to run, similar to running `node <script>`. The threat model is roughly
the same as any CLI tool that evaluates user-provided scripts.

**Recommendation:** If spec files are only expected to use the `page.*` API,
consider running them in a stricter sandbox (e.g. Node.js `vm` module with a
limited context, or a Worker thread with restricted permissions). At minimum,
document the trust model so users understand that running a spec file is
equivalent to running arbitrary code.

---

### 2. Unvalidated CLI Flag Values Passed to Configuration (MEDIUM)

**File:** `cli/config.js:49-61`

```js
if (kvFlags.network !== undefined) s.network = kvFlags.network;
if (kvFlags.cpu !== undefined) s.cpuThrottle = Number(kvFlags.cpu);
if (kvFlags.format !== undefined) s.format = kvFlags.format;
if (kvFlags.runs !== undefined) s.runs = Number(kvFlags.runs);
if (kvFlags.slowmo !== undefined) s.slowmo = Number(kvFlags.slowmo);
```

No validation is applied to user-provided flag values:

- `--network` accepts any string. An unrecognised value is silently passed to
  `NETWORK_PRESETS[throttle.network]` in `runner.cjs:762` which returns
  `undefined`, so throttling is silently skipped. Not dangerous, but confusing.
- `--format` accepts any string. An unrecognised format is passed through to
  file-extension lookups and FFmpeg codec selection. `FORMAT_EXTENSIONS[format]`
  returns `undefined`, falling back to `.webm`, but the mismatch between what
  the user asked for and what is produced could cause confusion.
- `--cpu` / `--runs` / `--slowmo` are coerced with `Number()` but the result
  is not range-checked. `--runs=0`, `--runs=-1`, `--cpu=0`, or
  `--runs=999999` are all accepted without error.

**Impact:** Low direct security risk, but unchecked numeric values could cause
unexpected resource consumption (e.g. `--runs=999999` running the browser
hundreds of thousands of times).

**Recommendation:** Add allowlist validation for `--network` and `--format`.
Clamp numeric flags to sane ranges (e.g. `runs` between 1 and 100, `cpu` >= 1).

---

### 3. HTML Output Constructed Without Escaping (MEDIUM)

**File:** `cli/videoplayer.js:90-671`

Racer names, comparison metric names, and other user-derived strings are
interpolated directly into the HTML template:

```js
// Line 119 — racer name injected into HTML attribute and text content
`<div class="racer-label" style="color: ${color}">${racer}</div>`

// Line 112 — overallWinner injected unescaped
`<span class="trophy">&#127942;</span> ${overallWinner.toUpperCase()} wins!`

// Line 159 — title constructed from racer names
const title = `Race: ${racers.join(' vs ')}`;  // into <title>

// Line 149 — file paths into JS string literals
const fullVideoPaths = fullVideoFiles
  ? `[${fullVideoFiles.map(f => `'${f}'`).join(', ')}]`
  : 'null';
```

If a racer name (derived from the spec filename) or a measurement name (from
the spec script's `raceStart('name')` call) contains HTML metacharacters
(`<`, `>`, `"`, `'`) or JavaScript-breaking characters, this results in:

- **XSS in the generated HTML page** — a filename like
  `<img onerror=alert(1) src=x>.spec.js` would inject markup.
- **JavaScript injection** — file paths containing `'` break out of JS string
  literals in the `<script>` block.

**Impact:** The HTML is generated locally and opened in the user's own browser.
The attack surface is limited to cases where an attacker controls the filename
of a spec file or the race directory structure. In a shared-CI or
downloaded-race-pack scenario this could be exploited.

**Recommendation:** HTML-escape all interpolated values. For values injected
into `<script>` blocks, use `JSON.stringify()` instead of manual string
quoting. Example fix for JS strings:

```js
const fullVideoPaths = fullVideoFiles
  ? JSON.stringify(fullVideoFiles)
  : 'null';
```

---

### 4. Video Path in `ffprobe` Filter String Uses Shell-Style Escaping (LOW)

**File:** `runner.cjs:62`

```js
const escaped = videoPath.replace(/\\/g, '/').replace(/'/g, "'\\''")
  .replace(/ /g, '\\ ');
```

The video path is embedded into an FFmpeg `lavfi` filter expression as the
`movie=` source. The escaping logic handles backslashes, single-quotes, and
spaces, but does not account for other FFmpeg filter metacharacters (`;`, `,`,
`[`, `]`, `=`, `'`, `\`). Because `execFileSync` is used (not a shell), there
is no shell-injection risk, but a path containing these characters could cause
`ffprobe` to misparse the filter graph and fail or behave unexpectedly.

**Impact:** Denial of functionality — cue detection fails and the tool falls
back to marker-based trimming. No code execution risk since `execFileSync`
does not invoke a shell.

**Recommendation:** Use FFmpeg's percent-encoding for the `movie=` path, or
pass the video through stdin / a temp symlink with a safe name.

---

## Positive Observations

| Area | Assessment |
|------|-----------|
| **External commands** | All use `execFileSync` (not `exec` or `execSync` with `shell: true`). Arguments are array-based, not string-concatenated. No shell injection is possible. |
| **File path construction** | Consistently uses `path.join()`. No string concatenation of user input into paths. Directory traversal is not a concern. |
| **Dependencies** | Only 2 production deps (`playwright`) and 1 dev dep (`vitest`). Minimal attack surface. |
| **No secrets** | No API keys, tokens, credentials, or `.env` files. |
| **No network services** | The tool does not listen on any port or expose any API. |
| **Error handling** | JSON parsing is wrapped in try/catch with graceful fallbacks. Process errors are caught and reported. |
| **Signal handling** | Proper cleanup of browser instances on SIGTERM/SIGINT. |
| **Data locality** | All results are written to local disk. No external data transmission. |

---

## Recommendations Summary

| # | Finding | Severity | Effort |
|---|---------|----------|--------|
| 1 | `AsyncFunction` eval of spec files | High | Medium — document trust model; optionally sandbox |
| 2 | Unvalidated CLI flags | Medium | Low — add allowlists and range checks |
| 3 | HTML template injection (XSS) | Medium | Low — escape interpolated values |
| 4 | FFmpeg filter path escaping | Low | Low — use percent-encoding or temp symlink |
