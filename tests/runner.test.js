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
    const performanceQueue = [
      makePerformanceMetrics({ scriptDuration: 1, taskDuration: 2 }),
      makePerformanceMetrics({ scriptDuration: 2, taskDuration: 3 }),
      makePerformanceMetrics({ scriptDuration: 7, taskDuration: 9 }),
      makePerformanceMetrics({ scriptDuration: 8, taskDuration: 10 }),
      makePerformanceMetrics({ scriptDuration: 13, taskDuration: 16 }),
      makePerformanceMetrics({ scriptDuration: 14, taskDuration: 17 }),
      makePerformanceMetrics({ scriptDuration: 19, taskDuration: 23 }),
      makePerformanceMetrics({ scriptDuration: 23, taskDuration: 29 }),
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
    expect(profileMetrics.measured.scriptDuration).toBe(22);
    expect(profileMetrics.measured.taskDuration).toBe(27);
  });
});
