import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { setupMetricsCollection, runMarkerMode, selectRaceTiming } = require('../runner.cjs');
const { SyncBarrier } = require('../sync-barrier.cjs');

describe('cosmetic failures', () => {
  it('keeps the measurements when an overlay update throws mid-race', async () => {
    // A page that navigates while the overlay is being painted rejects the
    // evaluate with "Execution context was destroyed". Trace marks pass a
    // string; overlay writes pass an object — fail only the latter.
    const page = makeBarePage();
    page.evaluate = async (fn, arg) => {
      if (arg && typeof arg === 'object') throw new Error('Execution context was destroyed');
      return null;
    };
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      const result = await runMarkerMode(page, {
        id: 'nav',
        script: "await page.raceStart('Load');\npage.raceEnd('Load');",
      }, { noOverlay: false, noRecording: false });
      expect(result.measurements.map(m => m.name)).toEqual(['Load']);
      expect(result.segments).toHaveLength(1);
      // Reported once, not once per overlay write.
      expect(errors.filter(e => e.includes('overlay update failed'))).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });
});

describe('script compilation', () => {
  const runScript = (script) => {
    const page = makeBarePage();
    return runMarkerMode(page, { id: 'q', script }, { noOverlay: true, noRecording: true }).then(result => ({ page, result }));
  };

  it('keeps typographic quotes inside a script that already parses', async () => {
    // A selector or message with an apostrophe must reach the page as typed.
    const { page } = await runScript("page.note = 'Let’s go';");
    expect(page.note).toBe('Let’s go');
  });

  it('still rescues a script pasted with smart quotes as string delimiters', async () => {
    const { result } = await runScript('await page.raceStart(‘Load’);\npage.raceEnd(“Load”);');
    expect(result.measurements.map(m => m.name)).toEqual(['Load']);
  });

  it('reports a genuine syntax error as a script failure', async () => {
    await expect(runScript('await page.raceStart(;')).rejects.toThrow('Script execution failed');
  });
});

describe('selectRaceTiming', () => {
  const markerSegments = [{ start: 1.5, end: 3.5 }];
  const markerMeasurements = [{ name: 'Load', startTime: 1.6, endTime: 3.4, duration: 1.8 }];
  const traceSegments = [{ start: 0, end: 2.0, startTraceTs: 1_500_000, endTraceTs: 3_500_000 }];
  const traceMeasurements = [{ name: 'Load', startTime: 0.1, endTime: 1.9, duration: 1.8, startTraceTs: 1_600_000, endTraceTs: 3_400_000 }];
  const calibrated = { recordingSegments: traceSegments, measurements: traceMeasurements, ptsSegments: [{ start: 1.5, end: 3.5 }] };

  it('prefers the trace when it is complete and calibratable', () => {
    expect(selectRaceTiming(calibrated, markerSegments, markerMeasurements))
      .toEqual({ recordingSegments: traceSegments, measurements: traceMeasurements });
  });

  it('falls back to marker segments when the trace has no frames to calibrate against', () => {
    // Trace segments count from the recording-start mark, so without the
    // first frame's timestamp their start of 0 would be read as video PTS 0.
    const uncalibrated = { ...calibrated, ptsSegments: [] };
    expect(selectRaceTiming(uncalibrated, markerSegments, markerMeasurements))
      .toEqual({ recordingSegments: markerSegments, measurements: traceMeasurements });
  });

  it('falls back to marker measurements when a mark went missing', () => {
    // Two sections measured, but the second measure:end mark was lost to a
    // navigation: the trace pairs only one, so the marker clock keeps both.
    const twoMarkers = [...markerMeasurements, { name: 'Render', startTime: 3.5, endTime: 4.0, duration: 0.5 }];
    expect(selectRaceTiming(calibrated, markerSegments, twoMarkers).measurements).toBe(twoMarkers);
  });

  it('falls back to marker segments when the trace merged two of them', () => {
    const twoMarkerSegments = [{ start: 1, end: 2 }, { start: 3, end: 4 }];
    expect(selectRaceTiming(calibrated, twoMarkerSegments, markerMeasurements).recordingSegments).toBe(twoMarkerSegments);
  });

  it('uses the markers when there is no trace at all', () => {
    expect(selectRaceTiming(null, markerSegments, markerMeasurements))
      .toEqual({ recordingSegments: markerSegments, measurements: markerMeasurements });
  });
});

/** The minimum a page has to offer runMarkerMode when overlays and metrics are off. */
function makeBarePage() {
  return {
    on() {},
    context() { return { newCDPSession: async () => ({ async send() { return {}; }, async detach() {} }) }; },
    async evaluate() { return null; },
    async addInitScript() {},
    async waitForTimeout() {},
  };
}

describe('parallel checkpoints', () => {
  // Two racers, real barriers, a short deadlock backstop: if a checkpoint is
  // ever left one racer short, the barrier times out and flags sharedState.
  function makeBarriers(sharedState) {
    const opts = { timeoutMs: 500 };
    return {
      ready: new SyncBarrier(2, sharedState, opts),
      recordingStart: new SyncBarrier(2, sharedState, opts),
      stop: new SyncBarrier(2, sharedState, opts),
    };
  }

  const runRacer = (id, script, barriers, sharedState) =>
    runMarkerMode(makeBarePage(), { id, script }, { barriers, isParallel: true, noOverlay: true, noRecording: true });

  it.each([
    ['an empty script', ''],
    ['a script that never calls raceStart', '// warming up only\nawait page.waitForTimeout(1);'],
  ])('lets a racer with %s finish without stranding its partner at a checkpoint', async (_, script) => {
    const sharedState = { hasError: false, errorMessage: null };
    const barriers = makeBarriers(sharedState);

    const [idle, racing] = await Promise.all([
      runRacer('idle', script, barriers, sharedState),
      runRacer('racing', "await page.raceStart('Load');\npage.raceEnd('Load');", barriers, sharedState),
    ]);

    expect(sharedState.hasError).toBe(false);
    expect(idle.measurements).toEqual([]);
    expect(racing.measurements.map(m => m.name)).toEqual(['Load']);
  });
});

function makePerformanceMetrics({
  jsHeapUsedSize = 0,
  scriptDuration = 0,
  layoutDuration = 0,
  recalcStyleDuration = 0,
  taskDuration = scriptDuration,
} = {}) {
  return {
    metrics: [
      { name: 'JSHeapUsedSize', value: jsHeapUsedSize },
      { name: 'ScriptDuration', value: scriptDuration / 1000 },
      { name: 'LayoutDuration', value: layoutDuration / 1000 },
      { name: 'RecalcStyleDuration', value: recalcStyleDuration / 1000 },
      { name: 'TaskDuration', value: taskDuration / 1000 },
    ],
  };
}

describe('runner metrics collection', () => {
  it('populates measuredSections from page.raceStart/page.raceEnd using safe section keys', async () => {
    // One snapshot per section boundary (start, end) plus the final one taken by
    // collect(). Each section spans 5ms of script / 6ms of task time; the gaps
    // between sections are idle for script but not for task, so the measured
    // scope must add up to the sections, not to the span that contains them.
    const performanceQueue = [
      makePerformanceMetrics({ scriptDuration: 1, taskDuration: 2 }),
      makePerformanceMetrics({ scriptDuration: 6, taskDuration: 8 }),
      makePerformanceMetrics({ scriptDuration: 8, taskDuration: 10 }),
      makePerformanceMetrics({ scriptDuration: 13, taskDuration: 16 }),
      makePerformanceMetrics({ scriptDuration: 15, taskDuration: 18 }),
      makePerformanceMetrics({ scriptDuration: 20, taskDuration: 24 }),
      makePerformanceMetrics({ scriptDuration: 25, taskDuration: 30 }),
    ];

    const client = {
      on() {},
      async send(method) {
        if (method === 'Network.enable' || method === 'Performance.enable') return {};
        if (method === 'Performance.getMetrics') return performanceQueue.shift();
        throw new Error(`Unexpected CDP method: ${method}`);
      },
      async detach() {},
    };

    const page = {
      on() {},
      context() {
        return {
          newCDPSession: async () => client,
        };
      },
      async evaluate(fn) {
        const source = fn.toString();
        if (source.includes('const perf = window.performance')) {
          return {
            domContentLoaded: null,
            domComplete: null,
            ttfb: null,
            fcp: null,
            lcp: null,
            cls: null,
          };
        }
        return null;
      },
      async addInitScript() {},
      async waitForTimeout() {},
    };

    const metricsCollector = await setupMetricsCollection(page, 'lauda');
    await runMarkerMode(page, {
      id: 'lauda',
      script: `
        for (const name of ['__proto__', 'constructor', 'hasOwnProperty']) {
          await page.raceStart(name);
          page.raceEnd(name);
        }
      `,
    }, { noOverlay: true, metricsCollector, noRecording: true });

    const profileMetrics = await metricsCollector.collect();

    expect(Object.getPrototypeOf(profileMetrics.measuredSections)).toBeNull();
    expect(Object.keys(profileMetrics.measuredSections)).toEqual(['__proto__', 'constructor', 'hasOwnProperty']);
    expect(profileMetrics.measuredSections.__proto__).toEqual({
      networkTransferSize: 0,
      networkRequestCount: 0,
      scriptDuration: 5,
      layoutDuration: 0,
      recalcStyleDuration: 0,
      taskDuration: 6,
    });
    expect(profileMetrics.measuredSections.constructor).toEqual({
      networkTransferSize: 0,
      networkRequestCount: 0,
      scriptDuration: 5,
      layoutDuration: 0,
      recalcStyleDuration: 0,
      taskDuration: 6,
    });
    expect(profileMetrics.measuredSections.hasOwnProperty).toEqual({
      networkTransferSize: 0,
      networkRequestCount: 0,
      scriptDuration: 5,
      layoutDuration: 0,
      recalcStyleDuration: 0,
      taskDuration: 6,
    });
    // Sum of the three sections (5/6 each), not first-raceStart-to-end-of-race.
    expect(profileMetrics.measured.scriptDuration).toBe(15);
    expect(profileMetrics.measured.taskDuration).toBe(18);
  });

  it('counts network activity from every measured section, not just the first', async () => {
    let networkListener = null;
    const client = {
      on(event, handler) {
        if (event === 'Network.loadingFinished') networkListener = handler;
      },
      async send(method) {
        if (method === 'Network.enable' || method === 'Performance.enable') return {};
        if (method === 'Performance.getMetrics') return makePerformanceMetrics();
        throw new Error(`Unexpected CDP method: ${method}`);
      },
      async detach() {},
    };

    const page = {
      on() {},
      context() {
        return { newCDPSession: async () => client };
      },
      async evaluate() { return null; },
      async addInitScript() {},
      async waitForTimeout() {},
      // Stands in for a response arriving while the script runs.
      download(bytes) { networkListener({ encodedDataLength: bytes }); },
    };

    const metricsCollector = await setupMetricsCollection(page, 'no-cache');
    await runMarkerMode(page, {
      id: 'no-cache',
      script: `
        await page.raceStart('Fetch and store');
        page.download(100);
        page.raceEnd('Fetch and store');
        page.download(1);
        await page.raceStart('Reload to data');
        page.download(200);
        page.raceEnd('Reload to data');
      `,
    }, { noOverlay: true, metricsCollector, noRecording: true });

    const profileMetrics = await metricsCollector.collect();

    expect(profileMetrics.measuredSections['Fetch and store'].networkRequestCount).toBe(1);
    expect(profileMetrics.measuredSections['Reload to data'].networkRequestCount).toBe(1);
    // Both sections count; the request between them does not.
    expect(profileMetrics.measured.networkRequestCount).toBe(2);
    expect(profileMetrics.measured.networkTransferSize).toBe(300);
    expect(profileMetrics.total.networkRequestCount).toBe(3);
    expect(profileMetrics.total.networkTransferSize).toBe(301);
  });

  it('reports null measured CPU when the closing snapshot fails, not zero', async () => {
    let snapshots = 0;
    const client = {
      on() {},
      async send(method) {
        if (method === 'Network.enable' || method === 'Performance.enable') return {};
        if (method === 'Performance.getMetrics') {
          snapshots += 1;
          // The section start snapshot lands; every later one fails, so no
          // window ever gets a complete start/end pair.
          if (snapshots === 1) return makePerformanceMetrics({ scriptDuration: 4, taskDuration: 6 });
          throw new Error('CDP session closed');
        }
        throw new Error(`Unexpected CDP method: ${method}`);
      },
      async detach() {},
    };

    const page = {
      on() {},
      context() {
        return { newCDPSession: async () => client };
      },
      async evaluate() { return null; },
      async addInitScript() {},
      async waitForTimeout() {},
    };

    const metricsCollector = await setupMetricsCollection(page, 'flaky');
    await runMarkerMode(page, {
      id: 'flaky',
      script: `
        await page.raceStart('only');
        page.raceEnd('only');
      `,
    }, { noOverlay: true, metricsCollector, noRecording: true });

    const profileMetrics = await metricsCollector.collect();

    expect(profileMetrics.measured.scriptDuration).toBeNull();
    expect(profileMetrics.measured.taskDuration).toBeNull();
    expect(profileMetrics.measured.layoutDuration).toBeNull();
    expect(profileMetrics.measured.recalcStyleDuration).toBeNull();
  });
});
