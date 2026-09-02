/**
 * race-api.cjs — the state machine behind the injected page.race* API.
 *
 * Owns all timing, segment, measurement, and auto-recording state:
 *
 *   await page.raceStart(name)        — start a named stopwatch (async: syncs in parallel)
 *   page.raceEnd(name)                — stop the stopwatch (sync: just arithmetic)
 *   await page.raceRecordingStart()   — manually start a video segment
 *   await page.raceRecordingEnd()     — manually end a video segment
 *   page.raceMessage(text)            — send a message to the CLI terminal
 *
 * If no explicit raceRecordingStart/End calls are made, recording automatically
 * wraps from the first raceStart until finalize().
 *
 * All side effects — trace marks, overlays, visual cues, CDP metrics, barrier
 * synchronization, stderr protocol lines — are injected as hooks by runner.cjs,
 * which keeps this module pure and unit-testable, and keeps runner.cjs and the
 * tests exercising the exact same state machine.
 */

/**
 * @param {object} [options]
 * @param {number} [options.recordingStartTime] Wall-clock ms epoch that segment
 *   and measurement times are relative to (defaults to creation time).
 * @param {() => number} [options.now] Clock, injectable for tests.
 * @param {object} [options.hooks] All optional; awaited where marked async.
 * @param {() => Promise<{aborted?: boolean}|void>} [options.hooks.gateRecordingStart]
 *   Barrier sync before a segment opens; returning { aborted: true } skips the segment.
 * @param {() => Promise<void>} [options.hooks.onRecordingStart] After a segment opens
 *   (trace mark, overlay, start cue).
 * @param {() => Promise<void>} [options.hooks.markRecordingEnd] Immediately when a
 *   segment closes, before deferred effects (trace mark).
 * @param {(info: {endTime: number}) => Promise<void>} [options.hooks.onRecordingStop]
 *   Deferred stop effects (finish overlay, end cue); endTime is the racer's finish
 *   time in seconds (last measurement end, or now).
 * @param {(name: string) => Promise<void>} [options.hooks.onMeasureStart]
 * @param {(name: string) => void} [options.hooks.onMeasureEnd]
 * @param {(name: string) => void} [options.hooks.onUnmatchedMeasureEnd] raceEnd
 *   was called with a name that has no open raceStart (usually a typo).
 * @param {() => Promise<void>} [options.hooks.onFirstRaceStart] Once, on the first
 *   raceStart before any measurement exists (CDP metrics measurement start).
 * @param {(name: string) => Promise<void>} [options.hooks.onSectionStart]
 * @param {(name: string, activeCount: number) => void} [options.hooks.onSectionEnd]
 *   activeCount is the number of still-open measurements after this one ended.
 * @param {(elapsedSeconds: string, text: string) => void} [options.hooks.onMessage]
 */
function createRaceApi({ recordingStartTime = Date.now(), now = Date.now, hooks = {} } = {}) {
  const {
    gateRecordingStart,
    onRecordingStart,
    markRecordingEnd,
    onRecordingStop,
    onMeasureStart,
    onMeasureEnd,
    onUnmatchedMeasureEnd,
    onFirstRaceStart,
    onSectionStart,
    onSectionEnd,
    onMessage,
  } = hooks;

  const segments = [];
  const measurements = [];
  // Null-prototype: measurement names come from user race scripts, so a plain
  // object would resolve raceEnd('constructor') / raceEnd('toString') through
  // the prototype chain, skip the unmatched-name guard, and record a NaN
  // measurement. Matches runner-metrics.cjs's measuredSections.
  const activeMeasurements = Object.create(null);
  let currentSegmentStart = null;
  let raceStartTime = null;
  let hasExplicitRecording = false;
  let autoRecordingStarted = false;
  let stopPromise = null;

  const elapsed = () => (now() - recordingStartTime) / 1000;

  const startRecording = async () => {
    if (currentSegmentStart !== null) return;
    if (gateRecordingStart) {
      const result = await gateRecordingStart();
      if (result?.aborted) return;
    }
    currentSegmentStart = elapsed();
    if (onRecordingStart) await onRecordingStart();
  };

  const stopRecording = async () => {
    if (currentSegmentStart === null) return stopPromise;
    segments.push({ start: currentSegmentStart, end: elapsed() });
    if (markRecordingEnd) await markRecordingEnd();
    currentSegmentStart = null;
    stopPromise = (async () => {
      const lastMeasurement = measurements[measurements.length - 1];
      const endTime = lastMeasurement ? lastMeasurement.endTime : elapsed();
      if (onRecordingStop) await onRecordingStop({ endTime });
    })();
    return stopPromise;
  };

  const startMeasure = async (name = 'default') => {
    if (raceStartTime === null) raceStartTime = now();
    activeMeasurements[name] = elapsed();
    if (onMeasureStart) await onMeasureStart(name);
  };

  const endMeasure = (name = 'default') => {
    const start = activeMeasurements[name];
    if (start === undefined) {
      // No matching raceStart — almost always a typo'd measurement name. Report
      // it rather than silently dropping the timing and showing no data.
      if (onUnmatchedMeasureEnd) onUnmatchedMeasureEnd(name);
      return 0;
    }
    const end = elapsed();
    const duration = end - start;
    measurements.push({ name, startTime: start, endTime: end, duration });
    delete activeMeasurements[name];
    if (onMeasureEnd) onMeasureEnd(name);
    return duration;
  };

  /** Attach the page.race* methods (except raceWaitForVisualStability, which is CDP-bound). */
  const attach = (page) => {
    page.raceMessage = (text) => {
      if (text == null) {
        text = '';
      } else if (typeof text !== 'string') {
        text = String(text);
      }
      const secs = raceStartTime ? ((now() - raceStartTime) / 1000).toFixed(1) : '0.0';
      if (onMessage) onMessage(secs, text);
    };
    page.raceRecordingStart = async () => { hasExplicitRecording = true; await startRecording(); };
    page.raceRecordingEnd = async () => { hasExplicitRecording = true; await stopRecording(); };
    page.raceStart = async (name = 'default') => {
      if (!hasExplicitRecording && !autoRecordingStarted) {
        autoRecordingStarted = true;
        await startRecording();
      }
      if (raceStartTime === null && onFirstRaceStart) await onFirstRaceStart();
      if (onSectionStart) await onSectionStart(name);
      await startMeasure(name);
    };
    page.raceEnd = (name = 'default') => {
      const duration = endMeasure(name);
      if (onSectionEnd) onSectionEnd(name, Object.keys(activeMeasurements).length);
      return duration;
    };
    return page;
  };

  /** Close any still-open segment and flush deferred stop effects. */
  const finalize = async () => {
    if (currentSegmentStart !== null) await stopRecording();
    if (stopPromise) await stopPromise;
  };

  return {
    attach,
    startRecording,
    stopRecording,
    startMeasure,
    endMeasure,
    finalize,
    get segments() { return segments; },
    get measurements() { return measurements; },
    get currentSegmentStart() { return currentSegmentStart; },
  };
}

module.exports = { createRaceApi };
