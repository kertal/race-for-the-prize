import { describe, it, expect, vi } from 'vitest';

const { runMarkerMode } = require('../runner.cjs');

// The player trims each clip at the `recording:end` trace mark, so anything the
// page paints after that mark falls outside the clip and is never seen. The
// finish flag has to go up before it — and far enough before that the ~25fps
// screencast has captured a frame showing it.

// One page stand-in, recording what the runner asks of it in order. The runner
// only reaches for these four in marker mode (page.context() is lazy, behind
// raceWaitForVisualStability, which this script never calls).
function createFakePage() {
  const calls = [];
  const page = {
    on: vi.fn(),
    addInitScript: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async (ms) => { calls.push({ kind: 'wait', ms }); }),
    evaluate: vi.fn(async (fn, arg) => { calls.push(classify(arg)); }),
  };
  return { page, calls };
}

// Each overlay helper has its own argument shape, which is enough to tell the
// page writes apart without reaching into the runner.
function classify(arg) {
  if (typeof arg === 'string' && arg.startsWith('race:')) return { kind: 'mark', name: arg };
  if (typeof arg === 'string' && arg.includes('top:50%')) return { kind: 'finish-flag' };
  if (arg && typeof arg === 'object' && 'd' in arg) return { kind: 'overlay', right: arg.r, dot: arg.d };
  return { kind: 'other' };
}

const SCRIPT = `
  await page.raceRecordingStart();
  await page.raceStart('Load');
  page.raceEnd('Load');
  await page.raceRecordingEnd();
`;

function run(page, { noOverlay = false, noRecording = false } = {}) {
  return runMarkerMode(
    page, {}, { id: 'alpha', script: SCRIPT, vars: {} },
    null, false, null, Date.now(), noOverlay, null, noRecording, false, false
  );
}

describe('runMarkerMode finish ordering', () => {
  it('raises the finish flag before the recording-end mark', async () => {
    const { page, calls } = createFakePage();

    await run(page);

    const flag = calls.findIndex(c => c.kind === 'finish-flag');
    const mark = calls.findIndex(c => c.kind === 'mark' && c.name.endsWith('recording:end'));
    expect(flag).toBeGreaterThanOrEqual(0);
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(flag).toBeLessThan(mark);
  });

  it('gives the recorder a beat to capture the flag before marking', async () => {
    const { page, calls } = createFakePage();

    await run(page);

    const flag = calls.findIndex(c => c.kind === 'finish-flag');
    const mark = calls.findIndex(c => c.kind === 'mark' && c.name.endsWith('recording:end'));
    const beat = calls.slice(flag, mark).find(c => c.kind === 'wait');
    expect(beat).toBeDefined();
    // Two frames at the recorder's ~25fps. Shorter and the flag lands on the
    // trim boundary, where it survives or not by a frame.
    expect(beat.ms).toBeGreaterThanOrEqual(80);
  });

  it('flips the corner to the flag in the same breath as the centre', async () => {
    const { page, calls } = createFakePage();

    await run(page);

    const mark = calls.findIndex(c => c.kind === 'mark' && c.name.endsWith('recording:end'));
    const corner = calls.slice(0, mark).filter(c => c.kind === 'overlay').pop();
    // A stopwatch corner over a centre flag reads as a bug, so both go up
    // before the mark rather than the corner waiting for the recording stop.
    expect(corner.right).toBe('\u{1F3C1}');
  });

  it('spends no beat when overlays are off', async () => {
    const { page, calls } = createFakePage();

    await run(page, { noOverlay: true });

    expect(calls.some(c => c.kind === 'finish-flag')).toBe(false);
    const mark = calls.findIndex(c => c.kind === 'mark' && c.name.endsWith('recording:end'));
    expect(calls.slice(0, mark).some(c => c.kind === 'wait')).toBe(false);
  });
});
