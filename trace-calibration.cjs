'use strict';

const TRACE_PREFIX = 'race:';
const REC_START = `${TRACE_PREFIX}recording:start`;
const REC_END = `${TRACE_PREFIX}recording:end`;
const MEASURE_START = `${TRACE_PREFIX}measure:start:`;
const MEASURE_END = `${TRACE_PREFIX}measure:end:`;

function toTraceObject(traceText) {
  if (!traceText) return null;
  if (typeof traceText === 'string') {
    try {
      return JSON.parse(traceText);
    } catch {
      return null;
    }
  }
  if (typeof traceText === 'object') return traceText;
  return null;
}

function decodeMeasureName(encoded) {
  if (!encoded) return 'default';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function microsToSeconds(delta) {
  return delta / 1e6;
}

function sorted(events) {
  return events.slice().sort((a, b) => {
    const av = typeof a === 'number' ? a : Number(a?.ts);
    const bv = typeof b === 'number' ? b : Number(b?.ts);
    if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
    if (!Number.isFinite(av)) return 1;
    if (!Number.isFinite(bv)) return -1;
    return av - bv;
  });
}

function pairRanges(starts, ends) {
  const startList = sorted(starts);
  const endList = sorted(ends);
  const pairs = [];
  let endIdx = 0;
  for (const startTs of startList) {
    while (endIdx < endList.length && endList[endIdx] <= startTs) endIdx++;
    if (endIdx >= endList.length) break;
    pairs.push({ startTs, endTs: endList[endIdx] });
    endIdx++;
  }
  return pairs;
}

function buildMeasurements(measureStartsByName, measureEndsByName, recordingStartTs) {
  const out = [];
  for (const [name, starts] of measureStartsByName.entries()) {
    const ends = measureEndsByName.get(name) || [];
    const pairs = pairRanges(starts, ends);
    for (const pair of pairs) {
      const startTime = microsToSeconds(pair.startTs - recordingStartTs);
      const endTime = microsToSeconds(pair.endTs - recordingStartTs);
      if (!isFinite(startTime) || !isFinite(endTime) || endTime < startTime) continue;
      out.push({
        name,
        startTime,
        endTime,
        duration: endTime - startTime,
        startTraceTs: pair.startTs,
        endTraceTs: pair.endTs,
      });
    }
  }
  return out.sort((a, b) => a.startTraceTs - b.startTraceTs);
}

function deriveTraceTiming(traceText) {
  const traceObj = toTraceObject(traceText);
  const traceEvents = traceObj?.traceEvents;
  if (!Array.isArray(traceEvents) || traceEvents.length === 0) return null;

  const screenshotTs = [];
  const recStartTs = [];
  const recEndTs = [];
  const measureStarts = new Map();
  const measureEnds = new Map();

  for (const ev of traceEvents) {
    if (!ev || typeof ev.ts !== 'number') continue;
    const name = typeof ev.name === 'string' ? ev.name : '';
    if (name === 'Screenshot') {
      screenshotTs.push(ev.ts);
      continue;
    }
    if (!name.startsWith(TRACE_PREFIX)) continue;
    if (name === REC_START) {
      recStartTs.push(ev.ts);
      continue;
    }
    if (name === REC_END) {
      recEndTs.push(ev.ts);
      continue;
    }
    if (name.startsWith(MEASURE_START)) {
      const decoded = decodeMeasureName(name.slice(MEASURE_START.length));
      if (!measureStarts.has(decoded)) measureStarts.set(decoded, []);
      measureStarts.get(decoded).push(ev.ts);
      continue;
    }
    if (name.startsWith(MEASURE_END)) {
      const decoded = decodeMeasureName(name.slice(MEASURE_END.length));
      if (!measureEnds.has(decoded)) measureEnds.set(decoded, []);
      measureEnds.get(decoded).push(ev.ts);
    }
  }

  const segmentPairs = pairRanges(recStartTs, recEndTs);
  const firstSegment = segmentPairs[0] || null;
  const recordingStartTs = firstSegment?.startTs ?? sorted(recStartTs)[0] ?? null;
  const recordingEndTs = segmentPairs[segmentPairs.length - 1]?.endTs ?? sorted(recEndTs).slice(-1)[0] ?? null;
  const firstFrameTs = sorted(screenshotTs)[0] ?? null;
  const lastFrameTs = sorted(screenshotTs).slice(-1)[0] ?? null;

  if (recordingStartTs == null) return null;

  const recordingSegments = segmentPairs
    .map(({ startTs, endTs }) => ({
      start: microsToSeconds(startTs - recordingStartTs),
      end: microsToSeconds(endTs - recordingStartTs),
      startTraceTs: startTs,
      endTraceTs: endTs,
    }))
    .filter(seg => isFinite(seg.start) && isFinite(seg.end) && seg.end > seg.start);

  const measurements = buildMeasurements(measureStarts, measureEnds, recordingStartTs);

  let ptsSegments = [];
  let calibratedStartPts = null;
  if (firstFrameTs != null) {
    ptsSegments = segmentPairs
      .map(({ startTs, endTs }) => ({
        start: Math.max(0, microsToSeconds(startTs - firstFrameTs)),
        end: Math.max(0, microsToSeconds(endTs - firstFrameTs)),
      }))
      .filter(seg => isFinite(seg.start) && isFinite(seg.end) && seg.end > seg.start);
    if (ptsSegments.length > 0) calibratedStartPts = ptsSegments[0].start;
  }

  return {
    recordingSegments,
    measurements,
    ptsSegments,
    calibratedStartPts,
    traceCalibration: {
      firstFrameTs,
      lastFrameTs,
      recordingStartTs,
      recordingEndTs,
    },
  };
}

module.exports = { deriveTraceTiming };
