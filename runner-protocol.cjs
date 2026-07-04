/**
 * Shared definitions for the runner ↔ parent contract.
 * Kept in its own CJS module so both runner.cjs (require) and race.js
 * (via createRequire) consume the exact same values.
 *
 * The contract has three channels:
 *
 * 1. Config (argv): race.js passes a RunnerConfig as JSON in argv[2].
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
 * @property {string} [recordingsDir]
 * @property {boolean} [ignoreHTTPSErrors]
 * @property {number|null} [viewportHeight]
 *
 * @typedef {object} BrowserResult
 * @property {string} id
 * @property {string|null} videoPath
 * @property {string|null} fullVideoPath
 * @property {string|null} tracePath
 * @property {string|null} harPath
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

// Bump whenever the config or result shape changes incompatibly. The runner
// rejects a config with a different version, and the parent rejects a result
// with a different version, so a mismatched race.js/runner.cjs pair fails
// with a clear error instead of silently-missing fields.
const PROTOCOL_VERSION = 1;

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

/** Build the stderr line for page.raceMessage(text). */
function formatRaceMessage(id, elapsedSeconds, text) {
  return `[${id}] ${RACE_MESSAGE_MARKER}[${elapsedSeconds}]:${text}`;
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
  formatRaceMessage,
  createRaceMessageRegex,
  formatContextClosed,
};
