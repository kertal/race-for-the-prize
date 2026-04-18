/**
 * Shared constants that define the runner ↔ parent contract.
 * Kept in its own CJS module so both runner.cjs (require) and race.js
 * (via createRequire) consume the exact same values.
 */

// Prefix for the single authoritative result line on runner stdout.
// Any stdout line not starting with this prefix is treated as noise
// (debug logs, Playwright traces, etc.) — never as a race result.
const RESULT_SENTINEL = '__RACE_RESULT__';

module.exports = { RESULT_SENTINEL };
