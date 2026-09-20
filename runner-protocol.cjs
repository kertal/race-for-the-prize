/**
 * Shared definitions for the runner ↔ parent contract.
 * Kept in its own CJS module so both runner.cjs (require) and race.js
 * (via createRequire) consume the exact same values.
 *
 * The contract has three channels:
 *
 * 1. Config: race.js writes a RunnerConfig as JSON to a temp file and passes
 *    `--config-file <path>` (inline JSON in argv[2] still works for direct
 *    invocation, but large race scripts overflow the OS argv limit).
 * 2. Result (stdout): runner.cjs prints exactly one authoritative line,
 *    prefixed with RESULT_SENTINEL, containing a RunnerResult as JSON.
 * 3. Progress (stderr): human-readable logs, plus two machine-parsed line
 *    formats that drive the terminal animation — race messages and the
 *    per-racer context-closed marker. Both sides must build/parse these
 *    through the helpers below so the formats cannot drift apart.
 *
 * @typedef {object} RunnerConfig
 * @property {number} protocolVersion  Must equal PROTOCOL_VERSION.
 * @property {Array<{id: string, script: string, vars?: object, headless?: boolean}>} browsers
 * @property {'parallel'|'sequential'} executionMode
 * @property {{network: string, cpu: number}} [throttle]
 * @property {boolean} [headless]
 * @property {number} [slowmo]
 * @property {boolean} [noOverlay]
 * @property {boolean} [noRecording]
 * @property {boolean} [ffmpeg]
 * @property {boolean} [har]
 * @property {boolean} [cueMarkers]
 * @property {boolean} [wallClock]
 * @property {string} [recordingsDir]
 * @property {boolean} [ignoreHTTPSErrors]
 * @property {number|null} [viewportHeight]
 *
 * @typedef {object} BrowserResult
 * @property {string} id
 * @property {string|null} tracePath  Relative to recordingsDir; the parent copies it in --recording=0 mode.
 *   (Videos and HAR files are not named here: the parent picks them up by scanning the racer's directory.)
 * @property {Array<{name: string, startTime: number, endTime: number, duration: number}>} measurements
 * @property {object|null} profileMetrics
 * @property {Array<{start: number, end: number}>|null} recordingSegments
 * @property {number} recordingOffset
 * @property {number} wallClockDuration
 * @property {number|null} calibratedStart
 * @property {object|null} traceCalibration
 * @property {string|null} error
 *
 * @typedef {object} RunnerResult
 * @property {number} protocolVersion  Equals PROTOCOL_VERSION of the runner that produced it.
 * @property {BrowserResult[]} browsers
 * @property {string[]} [errors]
 */

const path = require('path');

// Bump whenever the config or result shape changes incompatibly. The runner
// rejects a config with a different version, and the parent rejects a result
// with a different version, so a mismatched race.js/runner.cjs pair fails
// with a clear error instead of silently-missing fields.
//   v2: BrowserResult dropped videoPath, fullVideoPath and harPath, which the
//       parent never read (it scans the recordings directory instead).
const PROTOCOL_VERSION = 2;

// Prefix for the single authoritative result line on runner stdout.
// Any stdout line not starting with this prefix is treated as noise
// (debug logs, Playwright traces, etc.) — never as a race result.
const RESULT_SENTINEL = '__RACE_RESULT__';

// --- stderr line formats ---

const RACE_MESSAGE_MARKER = '__raceMessage__';
const CONTEXT_CLOSED_MARKER = 'Context closed';

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A racer id is used as a directory and file name inside the recordings dir
 * (`<recordingsDir>/<id>/<id>.trace.json`, …), so it must be a plain basename.
 * The runner rejects a config whose ids fail this check, keeping every path
 * the runner constructs confined to the recordings directory even when
 * runner.cjs is invoked directly with a hand-built config.
 */
function isSafeRacerId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id !== '.' &&
    id !== '..' &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('\0')
  );
}

/**
 * Enforcement companion to isSafeRacerId: resolve `segments` against `baseDir`
 * and verify the result stays inside it. Every path the runner constructs from
 * protocol data (racer ids, recording filenames) goes through this before any
 * filesystem access, so a malformed config or filename can never escape the
 * recordings directory. Returns the resolved absolute path; throws on escape.
 */
/**
 * True when `target` is `base` itself or sits below it.
 *
 * Uses path.relative rather than a `base + sep` prefix test: that prefix is
 * '//' when base is the filesystem root, which rejects every valid child, and
 * a raw prefix also accepts siblings that merely share a string prefix.
 * Mirrors `isPathInside` in cli/paths.js — the ESM/CJS split means the two
 * processes can't share one module, so this stays a deliberate duplicate.
 */
function isPathInside(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedBase) return true;
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel === '' || rel === '..') return false;
  return !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function confinePath(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, ...segments);
  if (!isPathInside(base, resolved)) {
    throw new Error(`Path escapes base directory ${base}: ${segments.join('/')}`);
  }
  return resolved;
}

/**
 * Build the stderr line for page.raceMessage(text). The parser reads one line,
 * so a newline in the text would truncate the message and leave its tail as
 * stray stderr — fold it onto one line instead.
 */
function formatRaceMessage(id, elapsedSeconds, text) {
  const oneLine = String(text).replace(/\r\n|\r|\n/g, ' ');
  return `[${id}] ${RACE_MESSAGE_MARKER}[${elapsedSeconds}]:${oneLine}`;
}

/** Regex matching formatRaceMessage lines for one racer; captures (elapsed, text). */
function createRaceMessageRegex(id) {
  return new RegExp(`\\[${escapeRegExp(id)}\\] ${RACE_MESSAGE_MARKER}\\[([\\d.]+)\\]:(.*)`, 'g');
}

/** Build the stderr marker emitted when a racer's browser context closes. */
function formatContextClosed(id) {
  return `[${id}] ${CONTEXT_CLOSED_MARKER}`;
}

module.exports = {
  PROTOCOL_VERSION,
  RESULT_SENTINEL,
  isSafeRacerId,
  confinePath,
  isPathInside,
  formatRaceMessage,
  createRaceMessageRegex,
  formatContextClosed,
};
