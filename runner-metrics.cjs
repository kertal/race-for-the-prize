/**
 * runner-metrics.cjs — CDP performance metrics collection and profiling.
 *
 * Owns the CDP-based metrics collector (network transfer/request tracking,
 * Performance API deltas, web vitals, per-section measurements) plus the
 * browser tracing lifecycle (startProfiling / collectProfilingResults).
 */

const fs = require('fs');
const path = require('path');
const { confinePath } = require('./runner-protocol.cjs');

/** Zeroed CPU accumulators for the measured scope. */
function newCpuTotals() {
  return { scriptDuration: 0, layoutDuration: 0, recalcStyleDuration: 0, taskDuration: 0 };
}

/**
 * Set up CDP session for capturing network and performance metrics.
 * Tracks network transfer sizes, request counts, and prepares for Performance API collection.
 * Supports both total session metrics and measurement-scoped metrics (between raceStart/raceEnd).
 * @param {Page} page - Playwright page
 * @param {string} id - Browser identifier for logging
 * @returns {Object} Metrics collector with methods to snapshot and collect
 */
async function setupMetricsCollection(page, id) {
  // Running totals for network (accumulated via events)
  const networkTotals = {
    transferSize: 0,
    requestCount: 0
  };

  // Network and CPU accumulated across every measurement window: the span from a
  // raceStart with nothing else measuring to the raceEnd that closes it. A race
  // with several sections has several windows, so the gaps between them — and
  // the tail after the last raceEnd — stay out of the "measured" scope.
  let measuredNetwork = { transferSize: 0, requestCount: 0 };
  let measuredCpu = newCpuTotals();
  let windowStartCdp = null;
  let hasMeasuredCpu = false;
  let isMeasuring = false;
  // End-of-section snapshot the closing raceEnd already fetched, reused as the
  // window's end so a section boundary costs one CDP round trip, not two.
  let lastSectionEndCdp = null;
  const pendingWindowEnds = [];
  const sectionMeasurements = new Map();

  let client = null;

  try {
    client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Performance.enable');

    // Track network transfer sizes
    client.on('Network.loadingFinished', (params) => {
      const size = params.encodedDataLength || 0;
      networkTotals.transferSize += size;
      networkTotals.requestCount++;
      // Also track during measurement period
      if (isMeasuring) {
        measuredNetwork.transferSize += size;
        measuredNetwork.requestCount++;
      }
    });

  } catch (error) {
    console.error(`[${id}] Warning: metrics collection setup failed: ${error.message}`);
  }

  /**
   * Get current CDP performance metrics snapshot.
   */
  async function getCdpMetrics() {
    if (!client) return null;
    try {
      const perfMetrics = await client.send('Performance.getMetrics');
      const metricsMap = {};
      for (const m of perfMetrics.metrics) {
        metricsMap[m.name] = m.value;
      }
      // CDP Performance.getMetrics returns durations in seconds; convert to ms
      return {
        jsHeapUsedSize: metricsMap.JSHeapUsedSize || 0,
        scriptDuration: (metricsMap.ScriptDuration || 0) * 1000,
        layoutDuration: (metricsMap.LayoutDuration || 0) * 1000,
        recalcStyleDuration: (metricsMap.RecalcStyleDuration || 0) * 1000,
        taskDuration: (metricsMap.TaskDuration || 0) * 1000
      };
    } catch {
      return null;
    }
  }

  /**
   * Open a measurement window if none is open, reusing the caller's snapshot.
   */
  function openMeasurementWindow(startCdp) {
    if (isMeasuring) return;
    isMeasuring = true;
    windowStartCdp = startCdp;
    lastSectionEndCdp = null;
  }

  /**
   * Close the open measurement window and fold its CPU time into the totals.
   * The end snapshot is asynchronous, so collect() awaits pendingWindowEnds.
   */
  function closeMeasurementWindow() {
    if (!isMeasuring) return;
    isMeasuring = false;
    const startCdp = windowStartCdp;
    windowStartCdp = null;
    if (!startCdp) return;
    pendingWindowEnds.push(
      (lastSectionEndCdp || getCdpMetrics())
        .then(endCdp => {
          // Only a complete start/end pair says anything about CPU time; without
          // one the measured scope reports null rather than a misleading zero.
          if (!endCdp) return;
          hasMeasuredCpu = true;
          for (const metric of Object.keys(measuredCpu)) {
            const delta = endCdp[metric] - startCdp[metric];
            if (delta < 0) console.warn(`[${id}] Negative delta for "${metric}" (${startCdp[metric]} → ${endCdp[metric]}), clamping to 0`);
            measuredCpu[metric] += Math.max(0, delta);
          }
        })
        .catch(() => {})
    );
  }

  function cloneNetworkTotals() {
    return {
      transferSize: networkTotals.transferSize,
      requestCount: networkTotals.requestCount,
    };
  }

  return {
    /**
     * Reset the measured scope (first raceStart of the race). The window itself
     * is opened by the section start that follows.
     */
    startMeasurement() {
      measuredNetwork = { transferSize: 0, requestCount: 0 };
      measuredCpu = newCpuTotals();
    },

    /**
     * End the current measurement window (the raceEnd that closed the last
     * open section). A later raceStart opens a new one.
     */
    stopMeasurement() {
      closeMeasurementWindow();
    },

    async startSectionMeasurement(name = 'default') {
      const sectionName = String(name);
      if (sectionMeasurements.has(sectionName)) {
        console.warn(`[${id}] Section measurement "${sectionName}" started again before ending; previous measurement will be lost`);
      }
      const startCdp = await getCdpMetrics();
      openMeasurementWindow(startCdp);
      sectionMeasurements.set(sectionName, {
        startCdp,
        endCdp: null,
        startNetwork: cloneNetworkTotals(),
        endNetwork: null,
        endCdpPromise: null,
      });
    },

    stopSectionMeasurement(name = 'default') {
      const sectionName = String(name);
      const section = sectionMeasurements.get(sectionName);
      if (!section) return;
      section.endNetwork = cloneNetworkTotals();
      lastSectionEndCdp = getCdpMetrics().catch(() => null);
      section.endCdpPromise = lastSectionEndCdp
        .then(metrics => { section.endCdp = metrics; });
    },

    /**
     * Collect final metrics at the end of the race.
     * Returns both total session metrics and measurement-scoped metrics.
     */
    async collect() {
      // A script that threw between raceStart and raceEnd leaves a window open;
      // close it here so the measured scope still covers what did run.
      closeMeasurementWindow();
      await Promise.all([
        ...[...sectionMeasurements.values()].map(s => s.endCdpPromise).filter(Boolean),
        ...pendingWindowEnds,
      ]);

      const result = {
        total: {
          networkTransferSize: networkTotals.transferSize,
          networkRequestCount: networkTotals.requestCount,
          ttfb: null,
          fcp: null,
          lcp: null,
          cls: null,
          domContentLoaded: null,
          domComplete: null,
          jsHeapUsedSize: null,
          scriptDuration: null,
          layoutDuration: null,
          recalcStyleDuration: null,
          taskDuration: null
        },
        measured: {
          networkTransferSize: measuredNetwork.transferSize,
          networkRequestCount: measuredNetwork.requestCount,
          scriptDuration: hasMeasuredCpu ? measuredCpu.scriptDuration : null,
          layoutDuration: hasMeasuredCpu ? measuredCpu.layoutDuration : null,
          recalcStyleDuration: hasMeasuredCpu ? measuredCpu.recalcStyleDuration : null,
          taskDuration: hasMeasuredCpu ? measuredCpu.taskDuration : null
        },
        measuredSections: Object.create(null)
      };

      try {
        // Get navigation timing + web vitals from the page in a single evaluate
        const timing = await page.evaluate(() => {
          const perf = window.performance;
          if (!perf) return null;
          const t = perf.timing || {};
          const nav = perf.getEntriesByType('navigation');
          const paint = perf.getEntriesByType('paint');
          const fcpEntry = paint.find(e => e.name === 'first-contentful-paint');
          const lcpEntries = window.__raceLCPEntries;
          return {
            domContentLoaded: t.domContentLoadedEventEnd && t.navigationStart
              ? t.domContentLoadedEventEnd - t.navigationStart : null,
            domComplete: t.domComplete && t.navigationStart
              ? t.domComplete - t.navigationStart : null,
            ttfb: nav.length > 0 ? nav[0].responseStart : (
              t.responseStart && t.navigationStart ? t.responseStart - t.navigationStart : null
            ),
            fcp: fcpEntry ? fcpEntry.startTime : null,
            lcp: lcpEntries && lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null,
            cls: typeof window.__raceCLSValue === 'number' ? window.__raceCLSValue : null,
          };
        });

        if (timing) {
          result.total.domContentLoaded = timing.domContentLoaded > 0 ? timing.domContentLoaded : null;
          result.total.domComplete = timing.domComplete > 0 ? timing.domComplete : null;
          result.total.ttfb = timing.ttfb > 0 ? timing.ttfb : null;
          result.total.fcp = timing.fcp > 0 ? timing.fcp : null;
          result.total.lcp = timing.lcp > 0 ? timing.lcp : null;
          result.total.cls = timing.cls != null ? timing.cls : null;
        }

        // Get final CDP metrics
        const endMetrics = await getCdpMetrics();
        if (endMetrics) {
          result.total.jsHeapUsedSize = endMetrics.jsHeapUsedSize || null;
          result.total.scriptDuration = endMetrics.scriptDuration || null;
          result.total.layoutDuration = endMetrics.layoutDuration || null;
          result.total.recalcStyleDuration = endMetrics.recalcStyleDuration || null;
          result.total.taskDuration = endMetrics.taskDuration || null;
        }
      } catch (error) {
        console.error(`[${id}] Warning: failed to collect metrics: ${error.message}`);
      }

      for (const [sectionName, section] of sectionMeasurements.entries()) {
        const startNetwork = section.startNetwork;
        const endNetwork = section.endNetwork;
        const startCdp = section.startCdp;
        const endCdp = section.endCdp;

        const measuredSection = {
          networkTransferSize: (startNetwork && endNetwork)
            ? Math.max(0, endNetwork.transferSize - startNetwork.transferSize)
            : null,
          networkRequestCount: (startNetwork && endNetwork)
            ? Math.max(0, endNetwork.requestCount - startNetwork.requestCount)
            : null,
          scriptDuration: null,
          layoutDuration: null,
          recalcStyleDuration: null,
          taskDuration: null,
        };

        if (startCdp && endCdp) {
          const computeDelta = (metric) => {
            const delta = endCdp[metric] - startCdp[metric];
            return Math.max(0, delta);
          };
          measuredSection.scriptDuration = computeDelta('scriptDuration');
          measuredSection.layoutDuration = computeDelta('layoutDuration');
          measuredSection.recalcStyleDuration = computeDelta('recalcStyleDuration');
          measuredSection.taskDuration = computeDelta('taskDuration');
        }

        result.measuredSections[sectionName] = measuredSection;
      }

      return result;
    },

    /**
     * Detach the CDP session.
     */
    async detach() {
      try {
        if (client) await client.detach();
      } catch {}
    }
  };
}

/** Start CDP metrics collection and browser tracing for one racer. */
async function startProfiling(page, browser, id) {
  const metricsCollector = await setupMetricsCollection(page, id);
  await browser.startTracing(page, { screenshots: true, categories: ['devtools.timeline', 'blink.user_timing'] });
  return metricsCollector;
}

/** Stop tracing, persist the trace file, and collect final metrics. */
async function collectProfilingResults(browser, metricsCollector, outputDir, id) {
  let profileMetrics = null;
  if (metricsCollector) {
    profileMetrics = await metricsCollector.collect();
    await metricsCollector.detach();
  }
  const traceBuffer = await browser.stopTracing();
  // id is validated at config entry (isSafeRacerId); confinePath re-checks the
  // constructed path so the trace can only ever be written inside outputDir.
  const tracePath = confinePath(outputDir, `${id}.trace.json`);
  fs.writeFileSync(tracePath, traceBuffer); // NOSONAR — tracePath comes from confinePath (id validated by isSafeRacerId at config entry)
  console.error(`[${id}] Performance trace saved: ${tracePath}`);
  return {
    tracePath,
    profileMetrics,
    traceText: traceBuffer.toString('utf8'),
  };
}

module.exports = { setupMetricsCollection, startProfiling, collectProfilingResults };
