/**
 * cdp-calibration.cjs — CDP screencast-based video PTS calibration.
 *
 * Starts a lightweight parallel CDP screencast to capture frame timestamps,
 * building a wall-clock → CDP-timestamp mapping table. This lets us convert
 * any Date.now() value into an approximate video PTS without injecting
 * visible cue markers into the page.
 *
 * Precision is ~1 frame (40ms at 25fps) due to the unknown delta between
 * Playwright's internal first frame and ours.
 */
'use strict';

/**
 * Start a minimal CDP screencast alongside Playwright's own recording.
 * Returns a controller with methods to record events and compute PTS.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<CdpCalibrator>}
 */
async function createCdpCalibrator(page) {
  const mapping = [];          // [{ cdpTs: number, wallMs: number }]
  let firstCdpTs = null;
  let session = null;
  let stopped = false;

  try {
    session = await page.context().newCDPSession(page);

    session.on('Page.screencastFrame', (event) => {
      if (stopped) return;
      const cdpTs = event.metadata.timestamp;
      const wallMs = Date.now();
      if (firstCdpTs === null) firstCdpTs = cdpTs;
      mapping.push({ cdpTs, wallMs });

      session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    });

    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 1,
      maxWidth: 1,
      maxHeight: 1,
      everyNthFrame: 1,
    });
  } catch (e) {
    console.error(`[cdp-calibration] Failed to start screencast: ${e.message}`);
    if (session) {
      try { await session.detach(); } catch (_) {}
    }
    return createNullCalibrator();
  }

  return {
    /**
     * Stop the screencast and detach the CDP session.
     */
    async stop() {
      if (stopped) return;
      stopped = true;
      try { await session.send('Page.stopScreencast'); } catch (_) {}
      try { await session.detach(); } catch (_) {}
    },

    /**
     * Convert a wall-clock timestamp (Date.now()) to an estimated video PTS
     * in seconds. Returns null if we have insufficient data.
     *
     * @param {number} wallMs - Date.now() value to convert
     * @returns {number|null}
     */
    wallClockToPts(wallMs) {
      if (mapping.length < 2 || firstCdpTs === null) return null;
      const cdpTs = interpolateCdpTimestamp(mapping, wallMs);
      if (cdpTs === null) return null;
      return cdpTs - firstCdpTs;
    },

    /** True when at least 2 mapping samples exist. */
    get hasData() {
      return mapping.length >= 2;
    },

    /** Number of frames captured. */
    get sampleCount() {
      return mapping.length;
    },
  };
}

/**
 * Interpolate a wall-clock timestamp to a CDP timestamp using
 * collected (cdpTs, wallMs) pairs. Uses linear interpolation
 * between the two nearest samples.
 *
 * @param {{ cdpTs: number, wallMs: number }[]} mapping
 * @param {number} wallMs
 * @returns {number|null}
 */
function interpolateCdpTimestamp(mapping, wallMs) {
  if (mapping.length === 0) return null;
  if (mapping.length === 1) {
    const m = mapping[0];
    return m.cdpTs + (wallMs - m.wallMs) / 1000;
  }

  // Find the two samples that bracket wallMs
  let lo = 0;
  let hi = mapping.length - 1;

  if (wallMs <= mapping[lo].wallMs) {
    // Extrapolate before first sample
    const m0 = mapping[0];
    const m1 = mapping[1];
    const rate = (m1.cdpTs - m0.cdpTs) / (m1.wallMs - m0.wallMs);
    return m0.cdpTs + rate * (wallMs - m0.wallMs);
  }

  if (wallMs >= mapping[hi].wallMs) {
    // Extrapolate after last sample
    const m0 = mapping[hi - 1];
    const m1 = mapping[hi];
    const rate = (m1.cdpTs - m0.cdpTs) / (m1.wallMs - m0.wallMs);
    return m1.cdpTs + rate * (wallMs - m1.wallMs);
  }

  // Binary search for bracketing pair
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (mapping[mid].wallMs <= wallMs) lo = mid;
    else hi = mid;
  }

  const m0 = mapping[lo];
  const m1 = mapping[hi];
  const frac = (wallMs - m0.wallMs) / (m1.wallMs - m0.wallMs);
  return m0.cdpTs + frac * (m1.cdpTs - m0.cdpTs);
}

/**
 * Null-object calibrator returned when CDP screencast setup fails.
 * All PTS conversions return null, triggering the cue-based fallback.
 */
function createNullCalibrator() {
  return {
    async stop() {},
    wallClockToPts() { return null; },
    get hasData() { return false; },
    get sampleCount() { return 0; },
  };
}

module.exports = { createCdpCalibrator, interpolateCdpTimestamp };
