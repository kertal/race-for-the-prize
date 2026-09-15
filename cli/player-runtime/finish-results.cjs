/* Pure finish labels, shared by the player and its tests. */
function racerFinishResult(entries, results, racerIndex, videoTime) {
  const ct = entries?.[racerIndex];
  if (!ct || !Number.isFinite(videoTime)) return null;
  const measurements = ct.measurements || [];
  // Video time of a measurement boundary: from the trace when the clip is
  // calibrated, else from wall-clock time against the clip's wall-clock start.
  const firstFrameTs = ct.traceCalibration?.firstFrameTs;
  const toPts = (trace, wall) => {
    if (Number.isFinite(trace) && Number.isFinite(firstFrameTs)) return (trace - firstFrameTs) / 1e6;
    if (!Number.isFinite(wall) || !Number.isFinite(ct._wcStart)) return null;
    return ct.start + wall - ct._wcStart;
  };
  let endPts = -Infinity;
  for (const m of measurements) {
    const end = toPts(m.endTraceTs, m.endTime);
    if (end === null) return null;
    endPts = Math.max(endPts, end);
  }
  if (!measurements.length || videoTime + 0.000001 < endPts) return null;
  const sections = results?.filter(r => !r.isSyntheticTotal);
  if (!sections?.length) return null;
  const count = sections[0].durations?.length;
  // Missing/error results must not turn an incomplete race into a winner.
  const complete = (r) => Array.isArray(r.durations) && r.durations.length === count && r.durations.every(Number.isFinite);
  if (!count || !sections.every(complete)) return null;
  const durations = Array.from({ length: count }, (_, i) => sections.reduce((sum, r) => sum + r.durations[i], 0));
  const duration = durations[racerIndex];
  if (!Number.isFinite(duration)) return null;
  // Match the summary's overall winner: summed totals within 10ms of the
  // fastest are joint first (sub-frame noise); everyone else ranks below them.
  const fastest = Math.min(...durations);
  const inFastest = sections.length > 1 && duration - fastest <= 0.01;
  const jointFirst = inFastest && durations.filter(d => d - fastest <= 0.01).length > 1;
  const place = inFastest ? 1 : 1 + durations.filter(d => d < duration).length;
  const tied = jointFirst || durations.filter(d => d === duration).length > 1;
  const medal = ['🥇', '🥈', '🥉', '4\uFE0F\u20E3', '5\uFE0F\u20E3'][place - 1] || `${place}`;
  const ordinal = ['1st', '2nd', '3rd'][place - 1] || `${place}th`;
  return { place, duration, name: 'Total race',
    label: `${medal} ${tied ? 'Joint ' : ''}${ordinal} · ${duration.toFixed(3)}s total` };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { racerFinishResult };
