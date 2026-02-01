import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the page.race* API and auto-recording behavior.
 * Simulates the same wiring that runner.js does in runMarkerModeRecording.
 */

function createRaceAPI() {
  const segments = [];
  let currentSegmentStart = null;
  const measurements = [];
  const activeMeasurements = {};
  const markerState = { segments, currentSegmentStart };
  const recordingStartTime = Date.now();

  const __startRecording = async () => {
    if (markerState.currentSegmentStart !== null) return;
    const timestamp = (Date.now() - recordingStartTime) / 1000;
    markerState.currentSegmentStart = timestamp;
  };

  const __stopRecording = () => {
    if (markerState.currentSegmentStart === null) return;
    const timestamp = (Date.now() - recordingStartTime) / 1000;
    markerState.segments.push({
      start: markerState.currentSegmentStart,
      end: timestamp,
    });
    markerState.currentSegmentStart = null;
  };

  const __startMeasure = (name = 'default') => {
    const timestamp = (Date.now() - recordingStartTime) / 1000;
    activeMeasurements[name] = timestamp;
  };

  const __endMeasure = (name = 'default') => {
    const startTime = activeMeasurements[name];
    if (startTime === undefined) return 0;
    const endTime = (Date.now() - recordingStartTime) / 1000;
    const duration = endTime - startTime;
    measurements.push({ name, startTime, endTime, duration });
    delete activeMeasurements[name];
    return duration;
  };

  // Replicate the page.race* attachment from runner.js
  let hasExplicitRecording = false;
  let autoRecordingStarted = false;

  const page = {};

  page.raceRecordingStart = async () => {
    hasExplicitRecording = true;
    await __startRecording();
  };
  page.raceRecordingEnd = () => {
    hasExplicitRecording = true;
    __stopRecording();
  };
  page.raceStart = async (name = 'default') => {
    if (!hasExplicitRecording && !autoRecordingStarted) {
      autoRecordingStarted = true;
      await __startRecording();
    }
    __startMeasure(name);
  };
  page.raceEnd = (name = 'default') => {
    return __endMeasure(name);
  };

  // Auto-stop helper (called after script execution in runner.js)
  const autoStopIfNeeded = () => {
    if (autoRecordingStarted && !hasExplicitRecording && markerState.currentSegmentStart !== null) {
      __stopRecording();
    }
  };

  return { page, markerState, measurements, autoStopIfNeeded, __startRecording, __stopRecording, __startMeasure, __endMeasure };
}

describe('page.race* API', () => {
  describe('page.raceStart / page.raceEnd', () => {
    it('creates a measurement', async () => {
      const { page, measurements } = createRaceAPI();

      await page.raceStart('Load');
      // Simulate some time
      await new Promise(r => setTimeout(r, 10));
      const duration = page.raceEnd('Load');

      expect(measurements).toHaveLength(1);
      expect(measurements[0].name).toBe('Load');
      expect(measurements[0].duration).toBeGreaterThan(0);
      expect(duration).toBeGreaterThan(0);
    });

    it('auto-starts recording on first raceStart', async () => {
      const { page, markerState } = createRaceAPI();

      expect(markerState.currentSegmentStart).toBeNull();
      await page.raceStart('Load');
      expect(markerState.currentSegmentStart).not.toBeNull();
    });

    it('only auto-starts recording once', async () => {
      const { page, markerState } = createRaceAPI();

      await page.raceStart('First');
      const firstStart = markerState.currentSegmentStart;
      await page.raceStart('Second');
      // Should not change the segment start
      expect(markerState.currentSegmentStart).toBe(firstStart);
    });

    it('uses "default" name when none provided', async () => {
      const { page, measurements } = createRaceAPI();

      await page.raceStart();
      page.raceEnd();

      expect(measurements).toHaveLength(1);
      expect(measurements[0].name).toBe('default');
    });

    it('raceEnd returns 0 for unknown measurement', () => {
      const { page } = createRaceAPI();
      const duration = page.raceEnd('nonexistent');
      expect(duration).toBe(0);
    });
  });

  describe('page.raceRecordingStart / page.raceRecordingEnd', () => {
    it('creates explicit recording segments', async () => {
      const { page, markerState } = createRaceAPI();

      await page.raceRecordingStart();
      expect(markerState.currentSegmentStart).not.toBeNull();

      await new Promise(r => setTimeout(r, 10));
      page.raceRecordingEnd();

      expect(markerState.segments).toHaveLength(1);
      expect(markerState.segments[0].start).toBeDefined();
      expect(markerState.segments[0].end).toBeDefined();
      expect(markerState.segments[0].end).toBeGreaterThan(markerState.segments[0].start);
    });

    it('prevents auto-recording when explicit recording is used', async () => {
      const { page, markerState, autoStopIfNeeded } = createRaceAPI();

      await page.raceRecordingStart();
      await page.raceStart('Load');
      page.raceEnd('Load');
      page.raceRecordingEnd();

      expect(markerState.segments).toHaveLength(1);

      // autoStop should be a no-op since explicit recording was used
      autoStopIfNeeded();
      expect(markerState.segments).toHaveLength(1);
    });

    it('allows multiple recording segments', async () => {
      const { page, markerState } = createRaceAPI();

      await page.raceRecordingStart();
      await new Promise(r => setTimeout(r, 5));
      page.raceRecordingEnd();

      await page.raceRecordingStart();
      await new Promise(r => setTimeout(r, 5));
      page.raceRecordingEnd();

      expect(markerState.segments).toHaveLength(2);
    });
  });

  describe('auto-recording behavior', () => {
    it('auto-stops recording when autoStopIfNeeded is called', async () => {
      const { page, markerState, autoStopIfNeeded } = createRaceAPI();

      await page.raceStart('Load');
      await new Promise(r => setTimeout(r, 10));
      page.raceEnd('Load');

      // Recording was auto-started, segment is still open
      expect(markerState.currentSegmentStart).not.toBeNull();
      expect(markerState.segments).toHaveLength(0);

      autoStopIfNeeded();
      expect(markerState.segments).toHaveLength(1);
      expect(markerState.currentSegmentStart).toBeNull();
    });

    it('auto-recording wraps from first raceStart to autoStop', async () => {
      const { page, markerState, autoStopIfNeeded } = createRaceAPI();

      await page.raceStart('Step1');
      const segStart = markerState.currentSegmentStart;
      page.raceEnd('Step1');

      await page.raceStart('Step2');
      page.raceEnd('Step2');

      autoStopIfNeeded();

      expect(markerState.segments).toHaveLength(1);
      expect(markerState.segments[0].start).toBe(segStart);
    });
  });

  describe('legacy __ functions', () => {
    it('__startMeasure / __endMeasure still work directly', () => {
      const { __startMeasure, __endMeasure, measurements } = createRaceAPI();

      __startMeasure('legacy');
      const dur = __endMeasure('legacy');

      expect(measurements).toHaveLength(1);
      expect(measurements[0].name).toBe('legacy');
      expect(dur).toBeGreaterThanOrEqual(0);
    });

    it('__startRecording / __stopRecording still work directly', async () => {
      const { __startRecording, __stopRecording, markerState } = createRaceAPI();

      await __startRecording();
      expect(markerState.currentSegmentStart).not.toBeNull();

      __stopRecording();
      expect(markerState.segments).toHaveLength(1);
    });

    it('ignores duplicate __startRecording', async () => {
      const { __startRecording, markerState } = createRaceAPI();

      await __startRecording();
      const first = markerState.currentSegmentStart;
      await __startRecording(); // should be ignored
      expect(markerState.currentSegmentStart).toBe(first);
    });

    it('ignores __stopRecording without __startRecording', () => {
      const { __stopRecording, markerState } = createRaceAPI();

      __stopRecording(); // should be a no-op
      expect(markerState.segments).toHaveLength(0);
    });
  });
});
