import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { setupMetricsCollection, runMarkerMode } = require('../runner.cjs');

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
    await runMarkerMode(
      page,
      null,
      {
        id: 'lauda',
        script: `
          for (const name of ['__proto__', 'constructor', 'hasOwnProperty']) {
            await page.raceStart(name);
            page.raceEnd(name);
          }
        `,
      },
      null,
      false,
      { finishOrder: [] },
      Date.now(),
      true,
      metricsCollector,
      true
    );

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
    await runMarkerMode(
      page,
      null,
      {
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
      },
      null,
      false,
      { finishOrder: [] },
      Date.now(),
      true,
      metricsCollector,
      true
    );

    const profileMetrics = await metricsCollector.collect();

    expect(profileMetrics.measuredSections['Fetch and store'].networkRequestCount).toBe(1);
    expect(profileMetrics.measuredSections['Reload to data'].networkRequestCount).toBe(1);
    // Both sections count; the request between them does not.
    expect(profileMetrics.measured.networkRequestCount).toBe(2);
    expect(profileMetrics.measured.networkTransferSize).toBe(300);
    expect(profileMetrics.total.networkRequestCount).toBe(3);
    expect(profileMetrics.total.networkTransferSize).toBe(301);
  });
});
