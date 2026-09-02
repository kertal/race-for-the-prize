import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

// race-api.cjs is CJS — use createRequire to load it in ESM test context.
// This is the REAL module runner.cjs injects into pages, not a replica.
const require = createRequire(import.meta.url);
const { createRaceApi } = require('../race-api.cjs');

function createTestApi(options = {}) {
  const api = createRaceApi(options);
  const page = {};
  api.attach(page);
  return { api, page };
}

describe('page.race* API (race-api.cjs)', () => {
  describe('page.raceStart / page.raceEnd', () => {
    it('creates a measurement', async () => {
      const { api, page } = createTestApi();

      await page.raceStart('Load');
      await new Promise(r => setTimeout(r, 10));
      const duration = page.raceEnd('Load');

      expect(api.measurements).toHaveLength(1);
      expect(api.measurements[0].name).toBe('Load');
      expect(api.measurements[0].duration).toBeGreaterThan(0);
      expect(duration).toBeGreaterThan(0);
    });

    it('auto-starts recording on first raceStart', async () => {
      const { api, page } = createTestApi();

      expect(api.currentSegmentStart).toBeNull();
      await page.raceStart('Load');
      expect(api.currentSegmentStart).not.toBeNull();
    });

    it('only auto-starts recording once', async () => {
      const { api, page } = createTestApi();

      await page.raceStart('First');
      const firstStart = api.currentSegmentStart;
      await page.raceStart('Second');
      // Should not change the segment start
      expect(api.currentSegmentStart).toBe(firstStart);
    });

    it('uses "default" name when none provided', async () => {
      const { api, page } = createTestApi();

      await page.raceStart();
      page.raceEnd();

      expect(api.measurements).toHaveLength(1);
      expect(api.measurements[0].name).toBe('default');
    });

    it('raceEnd returns 0 for unknown measurement', () => {
      const { page } = createTestApi();
      const duration = page.raceEnd('nonexistent');
      expect(duration).toBe(0);
    });

    it('treats inherited Object keys as unmatched instead of recording NaN', () => {
      // activeMeasurements must not resolve names like 'constructor' through
      // the prototype chain: the guard would not fire and endMeasure would push
      // a measurement whose times are all NaN.
      const unmatched = [];
      const { api, page } = createTestApi({
        hooks: { onUnmatchedMeasureEnd: (name) => unmatched.push(name) },
      });

      for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        expect(page.raceEnd(name), name).toBe(0);
      }

      expect(unmatched).toEqual(['constructor', 'toString', '__proto__', 'hasOwnProperty']);
      expect(api.measurements).toEqual([]);
    });

    it('still measures normally for names that shadow Object keys', async () => {
      const now = vi.fn().mockReturnValue(1000);
      const { api, page } = createTestApi({ recordingStartTime: 1000, now });

      await page.raceStart('constructor');
      now.mockReturnValue(3000);
      expect(page.raceEnd('constructor')).toBe(2);
      expect(api.measurements).toEqual([
        { name: 'constructor', startTime: 0, endTime: 2, duration: 2 },
      ]);
    });

    it('measurement times are relative to recordingStartTime', async () => {
      const now = vi.fn().mockReturnValue(5000);
      const { api, page } = createTestApi({ recordingStartTime: 1000, now });

      await page.raceStart('Load');
      now.mockReturnValue(7000);
      page.raceEnd('Load');

      expect(api.measurements[0]).toEqual({
        name: 'Load', startTime: 4, endTime: 6, duration: 2,
      });
    });
  });

  describe('page.raceRecordingStart / page.raceRecordingEnd', () => {
    it('creates explicit recording segments', async () => {
      const { api, page } = createTestApi();

      await page.raceRecordingStart();
      expect(api.currentSegmentStart).not.toBeNull();

      await new Promise(r => setTimeout(r, 10));
      await page.raceRecordingEnd();

      expect(api.segments).toHaveLength(1);
      expect(api.segments[0].start).toBeDefined();
      expect(api.segments[0].end).toBeDefined();
      expect(api.segments[0].end).toBeGreaterThan(api.segments[0].start);
    });

    it('prevents auto-recording when explicit recording is used', async () => {
      const { api, page } = createTestApi();

      await page.raceRecordingStart();
      await page.raceStart('Load');
      page.raceEnd('Load');
      await page.raceRecordingEnd();

      expect(api.segments).toHaveLength(1);

      // finalize should be a no-op since the segment was explicitly closed
      await api.finalize();
      expect(api.segments).toHaveLength(1);
    });

    it('allows multiple recording segments', async () => {
      const { api, page } = createTestApi();

      await page.raceRecordingStart();
      await new Promise(r => setTimeout(r, 5));
      await page.raceRecordingEnd();

      await page.raceRecordingStart();
      await new Promise(r => setTimeout(r, 5));
      await page.raceRecordingEnd();

      expect(api.segments).toHaveLength(2);
    });

    it('ignores a duplicate recording start while a segment is open', async () => {
      const { api, page } = createTestApi();

      await page.raceRecordingStart();
      const first = api.currentSegmentStart;
      await page.raceRecordingStart(); // should be ignored
      expect(api.currentSegmentStart).toBe(first);
    });

    it('ignores recording end without a start', async () => {
      const { api, page } = createTestApi();

      await page.raceRecordingEnd(); // should be a no-op
      expect(api.segments).toHaveLength(0);
    });

    it('skips the segment when the recording-start gate aborts', async () => {
      const { api, page } = createTestApi({
        hooks: { gateRecordingStart: async () => ({ aborted: true }) },
      });

      await page.raceRecordingStart();
      expect(api.currentSegmentStart).toBeNull();
      expect(api.segments).toHaveLength(0);
    });
  });

  describe('auto-recording behavior', () => {
    it('finalize closes an auto-started segment', async () => {
      const { api, page } = createTestApi();

      await page.raceStart('Load');
      await new Promise(r => setTimeout(r, 10));
      page.raceEnd('Load');

      // Recording was auto-started, segment is still open
      expect(api.currentSegmentStart).not.toBeNull();
      expect(api.segments).toHaveLength(0);

      await api.finalize();
      expect(api.segments).toHaveLength(1);
      expect(api.currentSegmentStart).toBeNull();
    });

    it('auto-recording wraps from first raceStart to finalize', async () => {
      const { api, page } = createTestApi();

      await page.raceStart('Step1');
      const segStart = api.currentSegmentStart;
      page.raceEnd('Step1');

      await page.raceStart('Step2');
      page.raceEnd('Step2');

      await api.finalize();

      expect(api.segments).toHaveLength(1);
      expect(api.segments[0].start).toBe(segStart);
    });
  });

  describe('page.raceMessage', () => {
    it('emits through the onMessage hook with elapsed race time', async () => {
      const messages = [];
      const now = vi.fn().mockReturnValue(1000);
      const { page } = createTestApi({
        recordingStartTime: 1000,
        now,
        hooks: { onMessage: (elapsed, text) => messages.push({ elapsed, text }) },
      });

      page.raceMessage('before start');
      await page.raceStart('Load');
      now.mockReturnValue(3500);
      page.raceMessage('halfway');

      expect(messages).toEqual([
        { elapsed: '0.0', text: 'before start' },
        { elapsed: '2.5', text: 'halfway' },
      ]);
    });

    it('stringifies non-string and nullish messages', () => {
      const messages = [];
      const { page } = createTestApi({
        hooks: { onMessage: (elapsed, text) => messages.push(text) },
      });

      page.raceMessage(42);
      page.raceMessage(null);
      page.raceMessage(undefined);

      expect(messages).toEqual(['42', '', '']);
    });
  });

  describe('hook wiring', () => {
    it('fires onFirstRaceStart exactly once, before the first measurement', async () => {
      const calls = [];
      const { page } = createTestApi({
        hooks: {
          onFirstRaceStart: async () => calls.push('first'),
          onSectionStart: async (name) => calls.push(`section:${name}`),
          onSectionEnd: (name, activeCount) => calls.push(`sectionEnd:${name}:${activeCount}`),
        },
      });

      await page.raceStart('A');
      page.raceEnd('A');
      await page.raceStart('B');
      page.raceEnd('B');

      expect(calls).toEqual([
        'first', 'section:A', 'sectionEnd:A:0',
        'section:B', 'sectionEnd:B:0',
      ]);
    });

    it('reports remaining active measurements to onSectionEnd for nested sections', async () => {
      const ends = [];
      const { page } = createTestApi({
        hooks: { onSectionEnd: (name, activeCount) => ends.push([name, activeCount]) },
      });

      await page.raceStart('outer');
      await page.raceStart('inner');
      page.raceEnd('inner');
      page.raceEnd('outer');

      expect(ends).toEqual([['inner', 1], ['outer', 0]]);
    });

    it('passes the last measurement end time to onRecordingStop', async () => {
      let stopInfo = null;
      const now = vi.fn().mockReturnValue(1000);
      const { api, page } = createTestApi({
        recordingStartTime: 1000,
        now,
        hooks: { onRecordingStop: async (info) => { stopInfo = info; } },
      });

      await page.raceStart('Load');
      now.mockReturnValue(4000);
      page.raceEnd('Load');
      now.mockReturnValue(9000);
      await api.finalize();

      // Finish time is the measurement's end (3s), not the segment close (8s)
      expect(stopInfo).toEqual({ endTime: 3 });
    });
  });

  describe('direct __ function args (AsyncFunction injection surface)', () => {
    it('startMeasure / endMeasure work directly', async () => {
      const { api } = createTestApi();

      await api.startMeasure('legacy');
      const dur = api.endMeasure('legacy');

      expect(api.measurements).toHaveLength(1);
      expect(api.measurements[0].name).toBe('legacy');
      expect(dur).toBeGreaterThanOrEqual(0);
    });

    it('startRecording / stopRecording work directly', async () => {
      const { api } = createTestApi();

      await api.startRecording();
      expect(api.currentSegmentStart).not.toBeNull();

      await api.stopRecording();
      expect(api.segments).toHaveLength(1);
    });
  });
});
