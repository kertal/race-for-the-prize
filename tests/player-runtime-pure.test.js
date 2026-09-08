/**
 * Behavioral tests for the pure logic of the browser player runtime
 * (cli/player-runtime/*.cjs). These files are concatenated into the
 * generated player's IIFE for the browser, and expose a guarded
 * module.exports so Node can require() them directly.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  US_PER_SECOND,
  isValidClipEntry,
  hasTraceCalibration,
  canApplyTraceCalibration,
  traceTsToClipPts,
  applyCalibrationToClip,
  computeSegmentClipTimes,
  resolveClipWindow,
} = require('../cli/player-runtime/calibration.cjs');
const { computeExportLayout } = require('../cli/player-runtime/export-layout.cjs');
const { crc32, createZipBuilder } = require('../cli/player-runtime/zip.cjs');
const { csvCell, buildMetricsCsv } = require('../cli/player-runtime/metrics-csv.cjs');

// --- Calibration math -------------------------------------------------------

describe('calibration isValidClipEntry', () => {
  it('accepts finite start <= end', () => {
    expect(isValidClipEntry({ start: 1, end: 3 })).toBe(true);
    expect(isValidClipEntry({ start: 0, end: 0 })).toBe(true); // zero-length clip is valid
  });

  it('rejects null/undefined entries', () => {
    expect(isValidClipEntry(null)).toBe(false);
    expect(isValidClipEntry(undefined)).toBe(false);
  });

  it('rejects non-finite or missing bounds', () => {
    expect(isValidClipEntry({ start: NaN, end: 3 })).toBe(false);
    expect(isValidClipEntry({ start: 1, end: Infinity })).toBe(false);
    expect(isValidClipEntry({ start: 1 })).toBe(false);
    expect(isValidClipEntry({ start: '1', end: 3 })).toBe(false); // Number.isFinite, no coercion
  });

  it('rejects inverted ranges', () => {
    expect(isValidClipEntry({ start: 3, end: 1 })).toBe(false);
  });
});

describe('calibration trace metadata predicates', () => {
  it('hasTraceCalibration requires a finite recordingStartTs', () => {
    expect(hasTraceCalibration({ traceCalibration: { recordingStartTs: 1_100_000 } })).toBe(true);
    expect(hasTraceCalibration({ traceCalibration: { recordingStartTs: NaN } })).toBe(false);
    expect(hasTraceCalibration({ traceCalibration: {} })).toBe(false);
    expect(hasTraceCalibration({})).toBe(false);
    expect(hasTraceCalibration(null)).toBe(false);
  });

  it('canApplyTraceCalibration additionally requires a finite firstFrameTs', () => {
    const both = { traceCalibration: { recordingStartTs: 1_100_000, firstFrameTs: 1_000_000 } };
    const noFirst = { traceCalibration: { recordingStartTs: 1_100_000 } };
    expect(canApplyTraceCalibration(both)).toBe(true);
    expect(canApplyTraceCalibration(noFirst)).toBe(false);
    expect(canApplyTraceCalibration(null)).toBe(false);
  });
});

describe('calibration traceTsToClipPts', () => {
  // Trace timestamps are microseconds; video PTS 0 is the first captured frame.
  const ct = { traceCalibration: { firstFrameTs: 2_000_000, recordingStartTs: 2_500_000 } };

  it('measures PTS from firstFrameTs, not recordingStartTs', () => {
    expect(traceTsToClipPts(ct, 3_000_000)).toBeCloseTo(1.0, 9);
    expect(traceTsToClipPts(ct, 2_000_000)).toBe(0); // first frame = PTS 0
    // recordingStartTs maps to +0.5s of video time, NOT 0
    expect(traceTsToClipPts(ct, 2_500_000)).toBeCloseTo(0.5, 9);
  });

  it('uses microsecond units', () => {
    expect(US_PER_SECOND).toBe(1e6);
    expect(traceTsToClipPts(ct, 2_000_001)).toBeCloseTo(1e-6, 12);
  });

  it('returns null without trace calibration or with a non-finite timestamp', () => {
    expect(traceTsToClipPts({}, 3_000_000)).toBe(null);
    expect(traceTsToClipPts(ct, NaN)).toBe(null);
    expect(traceTsToClipPts(ct, undefined)).toBe(null);
  });
});

describe('calibration applyCalibrationToClip', () => {
  const makeCt = () => ({ start: 10, end: 14, _wcStart: 10, _wcEnd: 14 });

  it('rebases start/end onto the PTS start, preserving wall-clock duration', () => {
    const ct = makeCt();
    applyCalibrationToClip(ct, 0.5, 100);
    expect(ct.calibratedStart).toBe(0.5);
    expect(ct.calibratedEnd).toBe(4.5); // 0.5 + (14 - 10)
    expect(ct.start).toBe(0.5);
    expect(ct.end).toBe(4.5);
    expect(ct._ptsScale).toBe(null);
    expect(ct._converted).toBe(true);
  });

  it('clamps end (but not calibratedEnd) to a finite video duration', () => {
    const ct = makeCt();
    applyCalibrationToClip(ct, 0.5, 3);
    expect(ct.end).toBe(3);
    expect(ct.calibratedEnd).toBe(4.5);
  });

  it('does not clamp when the video duration is not finite', () => {
    const ct = makeCt();
    applyCalibrationToClip(ct, 0.5, Infinity);
    expect(ct.end).toBe(4.5);
  });

  it('matches the onMeta pipeline: PTS start derived from trace timestamps', () => {
    // recordingStartTs - firstFrameTs = 100ms => recording began 0.1s into the video
    const cal = { recordingStartTs: 1_100_000, firstFrameTs: 1_000_000 };
    const ct = { start: 1, end: 3, _wcStart: 1, _wcEnd: 3, traceCalibration: cal };
    const tracePtsStart = (cal.recordingStartTs - cal.firstFrameTs) / US_PER_SECOND;
    expect(tracePtsStart).toBeCloseTo(0.1, 9);
    applyCalibrationToClip(ct, tracePtsStart, 5);
    expect(ct.calibratedStart).toBeCloseTo(0.1, 9);
    expect(ct.start).toBeCloseTo(0.1, 9);
    expect(ct.end).toBeCloseTo(2.1, 9); // 0.1 + 2s wall-clock segment
  });
});

describe('calibration computeSegmentClipTimes', () => {
  const cal = { firstFrameTs: 1_000_000, recordingStartTs: 1_100_000 };
  const entry = {
    _wcStart: 0.1,
    _wcEnd: 0.9,
    traceCalibration: cal,
    measurements: [
      { name: 'Load', startTraceTs: 1_200_000, endTraceTs: 1_600_000 },
      { name: 'Render', startTraceTs: 1_600_000, endTraceTs: 1_900_000 },
    ],
  };

  it('maps a named measurement to its PTS window per entry', () => {
    const out = computeSegmentClipTimes([entry], 'Load');
    expect(out).toHaveLength(1);
    expect(out[0].start).toBeCloseTo(0.2, 9);
    expect(out[0].end).toBeCloseTo(0.6, 9);
    const render = computeSegmentClipTimes([entry], 'Render');
    expect(render[0].start).toBeCloseTo(0.6, 9);
    expect(render[0].end).toBeCloseTo(0.9, 9);
  });

  it('returns null for entries that cannot be derived', () => {
    expect(computeSegmentClipTimes([entry], 'Nope')).toEqual([null]); // unknown segment
    expect(computeSegmentClipTimes([null], 'Load')).toEqual([null]); // missing entry
    const noWc = { ...entry, _wcStart: null };
    expect(computeSegmentClipTimes([noWc], 'Load')).toEqual([null]); // not yet converted
    const noTrace = { ...entry, traceCalibration: undefined };
    expect(computeSegmentClipTimes([noTrace], 'Load')).toEqual([null]); // no calibration
    const noTs = { ...entry, measurements: [{ name: 'Load', startTraceTs: NaN, endTraceTs: 1_600_000 }] };
    expect(computeSegmentClipTimes([noTs], 'Load')).toEqual([null]); // non-finite trace ts
  });

  it('rejects empty or inverted segments (endPts <= startPts)', () => {
    const zero = { ...entry, measurements: [{ name: 'Load', startTraceTs: 1_500_000, endTraceTs: 1_500_000 }] };
    expect(computeSegmentClipTimes([zero], 'Load')).toEqual([null]);
    const inverted = { ...entry, measurements: [{ name: 'Load', startTraceTs: 1_600_000, endTraceTs: 1_200_000 }] };
    expect(computeSegmentClipTimes([inverted], 'Load')).toEqual([null]);
  });

  it('returns null for null clip times and keeps per-entry independence', () => {
    expect(computeSegmentClipTimes(null, 'Load')).toBe(null);
    const out = computeSegmentClipTimes([entry, null], 'Load');
    expect(out[0]).not.toBe(null);
    expect(out[1]).toBe(null);
  });
});

describe('calibration resolveClipWindow', () => {
  it('uses the earliest start plus the longest duration (not the latest end)', () => {
    // Durations: 2s and 1.5s; window = [1, 1 + 2] even though max end is 3.5
    const win = resolveClipWindow([{ start: 1, end: 3 }, { start: 2, end: 3.5 }], new Set());
    expect(win).toEqual({ start: 1, end: 3 });
  });

  it('skips hidden racer indices', () => {
    const entries = [{ start: 1, end: 3 }, { start: 2, end: 3.5 }];
    expect(resolveClipWindow(entries, new Set([0]))).toEqual({ start: 2, end: 3.5 });
    expect(resolveClipWindow(entries, new Set([0, 1]))).toBe(null);
  });

  it('ignores null and invalid entries', () => {
    const win = resolveClipWindow([null, { start: 0.5, end: 2 }, { start: 3, end: 1 }], new Set());
    expect(win).toEqual({ start: 0.5, end: 2 });
  });

  it('returns null when nothing is resolvable', () => {
    expect(resolveClipWindow(null, new Set())).toBe(null);
    expect(resolveClipWindow([], new Set())).toBe(null);
    expect(resolveClipWindow([null, { start: NaN, end: 1 }], new Set())).toBe(null);
  });
});

// --- Export layout ----------------------------------------------------------

describe('computeExportLayout', () => {
  const ASPECT = 9 / 16; // 640x360 / 480x270 cells

  it('lays out 2 videos in a single 640px-wide row', () => {
    const l = computeExportLayout(2, ASPECT);
    expect(l.targetW).toBe(640);
    expect(l.cellH).toBe(360);
    expect(l.labelH).toBe(30);
    expect(l.positions).toEqual([{ x: 0, y: 0 }, { x: 640, y: 0 }]);
    expect(l.canvasW).toBe(1280);
    expect(l.canvasH).toBe(390); // 360 + 30, already even
  });

  it('never lets a row overflow the canvas (bottom row centred by its own count)', () => {
    // The CLI caps racers at 5, but the layout must stay self-consistent: a
    // fixed half-cell indent pushed a 3-cell bottom row past the canvas.
    for (const count of [2, 3, 4, 5, 6]) {
      const l = computeExportLayout(count, ASPECT);
      for (const pos of l.positions) {
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.x + l.targetW, `count=${count} overflows canvasW`).toBeLessThanOrEqual(l.canvasW);
      }
    }
  });

  it('lays out 3 videos in a single row', () => {
    const l = computeExportLayout(3, ASPECT);
    expect(l.targetW).toBe(640);
    expect(l.positions).toEqual([{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 1280, y: 0 }]);
    expect(l.canvasW).toBe(1920);
    expect(l.canvasH).toBe(390);
  });

  it('lays out 4 videos in a 2x2 grid at 480px', () => {
    const l = computeExportLayout(4, ASPECT);
    expect(l.targetW).toBe(480);
    expect(l.cellH).toBe(270);
    expect(l.positions).toEqual([
      { x: 0, y: 0 }, { x: 480, y: 0 },
      { x: 0, y: 300 }, { x: 480, y: 300 },
    ]);
    expect(l.canvasW).toBe(960);
    expect(l.canvasH).toBe(600); // 2 * (270 + 30)
  });

  it('lays out 5 videos as 3 on top, 2 centered below, on a 3-column canvas', () => {
    const l = computeExportLayout(5, ASPECT);
    expect(l.targetW).toBe(480);
    expect(l.positions).toEqual([
      { x: 0, y: 0 }, { x: 480, y: 0 }, { x: 960, y: 0 },
      { x: 240, y: 300 }, { x: 720, y: 300 },
    ]);
    expect(l.canvasW).toBe(1440);
    expect(l.canvasH).toBe(600);
  });

  it('bumps odd canvas heights to even for libx264', () => {
    // aspect chosen so cellH = 321 -> rawH = 351 (odd) -> canvasH = 352
    const l = computeExportLayout(2, 321 / 640);
    expect(l.cellH).toBe(321);
    expect(l.canvasH).toBe(352);
    expect(l.canvasH % 2).toBe(0);
  });
});

// --- CRC32 / ZIP builder ----------------------------------------------------

const enc = (s) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches known CRC-32 (IEEE) answer vectors', () => {
    expect(crc32(enc(''))).toBe(0x00000000);
    expect(crc32(enc('a'))).toBe(0xE8B7BE43);
    expect(crc32(enc('abc'))).toBe(0x352441C2);
    expect(crc32(enc('123456789'))).toBe(0xCBF43926);
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414FA339);
  });

  it('handles binary data and returns an unsigned 32-bit value', () => {
    const val = crc32(new Uint8Array([0x00, 0xFF, 0x10, 0x80]));
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(0xFFFFFFFF);
    expect(Number.isInteger(val)).toBe(true);
  });
});

describe('createZipBuilder', () => {
  async function buildZip(files) {
    const b = createZipBuilder();
    for (const [name, data] of files) b.addFile(name, data);
    const blob = b.toBlob();
    expect(blob.type).toBe('application/zip');
    return new DataView(await blob.arrayBuffer());
  }

  const SIG_LOCAL = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD = 0x06054b50;

  it('writes a correct local file header for a single stored file', async () => {
    const data = enc('hello');
    const dv = await buildZip([['index.html', data]]);
    expect(dv.getUint32(0, true)).toBe(SIG_LOCAL);
    expect(dv.getUint16(4, true)).toBe(20); // version needed
    expect(dv.getUint16(6, true)).toBe(0x0800); // UTF-8 flag
    expect(dv.getUint16(8, true)).toBe(0); // method: stored (no compression)
    expect(dv.getUint32(14, true)).toBe(crc32(data)); // CRC-32
    expect(dv.getUint32(18, true)).toBe(data.length); // compressed size
    expect(dv.getUint32(22, true)).toBe(data.length); // uncompressed size
    expect(dv.getUint16(26, true)).toBe('index.html'.length); // name length
    expect(dv.getUint16(28, true)).toBe(0); // extra length
    const name = new TextDecoder().decode(new Uint8Array(dv.buffer, 30, 10));
    expect(name).toBe('index.html');
    // File data immediately follows the header
    const body = new TextDecoder().decode(new Uint8Array(dv.buffer, 40, data.length));
    expect(body).toBe('hello');
  });

  it('ends with an EOCD record whose counts and offsets are consistent', async () => {
    const a = enc('hello');
    const b = new Uint8Array([0, 1, 2, 255]);
    const dv = await buildZip([['index.html', a], ['dir/data.bin', b]]);
    const eocdPos = dv.byteLength - 22;
    expect(dv.getUint32(eocdPos, true)).toBe(SIG_EOCD);
    expect(dv.getUint16(eocdPos + 8, true)).toBe(2); // entries on this disk
    expect(dv.getUint16(eocdPos + 10, true)).toBe(2); // total entries
    const localBytes =
      (30 + 'index.html'.length + a.length) + (30 + 'dir/data.bin'.length + b.length);
    const cdSize = (46 + 'index.html'.length) + (46 + 'dir/data.bin'.length);
    expect(dv.getUint32(eocdPos + 12, true)).toBe(cdSize); // central dir size
    expect(dv.getUint32(eocdPos + 16, true)).toBe(localBytes); // central dir offset
    expect(dv.byteLength).toBe(localBytes + cdSize + 22); // nothing else in the file
  });

  it('writes central directory entries pointing back at each local header', async () => {
    const a = enc('hello');
    const b = new Uint8Array([0, 1, 2, 255]);
    const dv = await buildZip([['index.html', a], ['dir/data.bin', b]]);
    const cdOffset = dv.getUint32(dv.byteLength - 22 + 16, true);

    // First central entry
    let pos = cdOffset;
    expect(dv.getUint32(pos, true)).toBe(SIG_CENTRAL);
    expect(dv.getUint32(pos + 16, true)).toBe(crc32(a));
    expect(dv.getUint16(pos + 28, true)).toBe('index.html'.length);
    expect(dv.getUint32(pos + 42, true)).toBe(0); // local header offset of first file
    let name = new TextDecoder().decode(new Uint8Array(dv.buffer, pos + 46, 10));
    expect(name).toBe('index.html');

    // Second central entry
    pos += 46 + 'index.html'.length;
    expect(dv.getUint32(pos, true)).toBe(SIG_CENTRAL);
    expect(dv.getUint16(pos + 28, true)).toBe('dir/data.bin'.length);
    const secondLocal = dv.getUint32(pos + 42, true);
    expect(secondLocal).toBe(30 + 'index.html'.length + a.length);
    expect(dv.getUint32(secondLocal, true)).toBe(SIG_LOCAL); // offset resolves to a local header
    name = new TextDecoder().decode(new Uint8Array(dv.buffer, pos + 46, 12));
    expect(name).toBe('dir/data.bin');
  });

  it('produces an archive that a real unzip implementation accepts', async () => {
    const dv = await buildZip([['index.html', enc('<html></html>')], ['notes.txt', enc('ok')]]);
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
    try {
      const zipPath = path.join(tmp, 'out.zip');
      fs.writeFileSync(zipPath, Buffer.from(dv.buffer));
      const listing = execFileSync('python3', ['-c',
        `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); z.testzip(); print(','.join(sorted(z.namelist())))`,
        zipPath], { encoding: 'utf-8' });
      expect(listing.trim()).toBe('index.html,notes.txt');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- metrics.csv builder ----------------------------------------------------

describe('metrics-csv csvCell', () => {
  it('passes plain values through and quotes commas, quotes, and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
});

describe('metrics-csv buildMetricsCsv', () => {
  const racers = ['lauda', 'hunt'];
  const timing = { name: 'Load', racers: [{ duration: 1 }, { duration: 2 }], winner: 'lauda', diffPercent: 100 };

  it('emits race timings and combined profile comparisons with their own scope', () => {
    const csv = buildMetricsCsv({
      racers,
      comparisons: [timing],
      profileComparison: {
        comparisons: [
          { scope: 'measured', category: 'computation', name: 'Script Execution', values: [40, 60], winner: 'lauda', diffPercent: 50 },
          { scope: 'total', category: 'loading', name: 'FCP', values: [100, 150], winner: 'lauda', diffPercent: 50 },
        ],
      },
    });
    expect(csv).toContain('scope,category,metric,lauda,hunt,winner,diff_percent');
    expect(csv).toContain('race,timing,Load (s),1,2,lauda,100.0');
    expect(csv).toContain('measured,computation,Script Execution,40,60,lauda,50.0');
    expect(csv).toContain('total,loading,FCP,100,150,lauda,50.0');
  });

  it('falls back to measured/total sections when no combined comparisons array exists', () => {
    const csv = buildMetricsCsv({
      racers,
      profileComparison: {
        measured: { comparisons: [{ category: 'computation', name: 'Script Execution', values: [40, 60], winner: 'lauda', diffPercent: 50 }] },
        total: { comparisons: [{ category: 'loading', name: 'FCP', values: [100, 150], winner: 'lauda', diffPercent: 50 }] },
      },
    });
    expect(csv).toContain('measured,computation,Script Execution,40,60,lauda,50.0');
    expect(csv).toContain('total,loading,FCP,100,150,lauda,50.0');
  });

  it('uses fallback racer names and returns null when there are no metrics', () => {
    const csv = buildMetricsCsv({ comparisons: [timing] }, racers);
    expect(csv).toContain('scope,category,metric,lauda,hunt,winner,diff_percent');
    expect(buildMetricsCsv({}, racers)).toBeNull();
  });
});
