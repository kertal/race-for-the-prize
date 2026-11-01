import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { mergeFrameStats } = require('../runner.cjs');

function emptyMetrics() {
  return { total: { fcp: 100 }, measured: { scriptDuration: 5 }, measuredSections: { Scroll: { taskDuration: 9 } } };
}

describe('mergeFrameStats', () => {
  it('folds frame stats into the existing scopes without dropping metrics', () => {
    const metrics = emptyMetrics();
    mergeFrameStats(metrics, {
      displayFrameMs: 8.3, budgetFrameMs: 12.5,
      total: { fps: 60, medianFrameMs: 16.7, droppedFrames: 3 },
      measured: { fps: 120, medianFrameMs: 8.3, droppedFrames: 0 },
      sections: { Scroll: { fps: 30, medianFrameMs: 33, droppedFrames: 12 } },
    }, 'hunt');

    expect(metrics.frameTiming).toEqual({ displayFrameMs: 8.3, budgetFrameMs: 12.5 });
    expect(metrics.total).toMatchObject({ fcp: 100, medianFrameMs: 16.7 });
    expect(metrics.measured).toMatchObject({ scriptDuration: 5, medianFrameMs: 8.3 });
    expect(metrics.measuredSections.Scroll).toMatchObject({ taskDuration: 9, medianFrameMs: 33 });
  });

  it('warns and changes nothing when the trace had no frame events', () => {
    const metrics = emptyMetrics();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mergeFrameStats(metrics, null, 'hunt');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('no frame events'));
    expect(metrics).toEqual(emptyMetrics());
    err.mockRestore();
  });

  it('tolerates a missing profileMetrics', () => {
    expect(() => mergeFrameStats(null, { sections: {} }, 'hunt')).not.toThrow();
  });

  it('adds a section the collector never recorded', () => {
    const metrics = emptyMetrics();
    mergeFrameStats(metrics, { displayFrameMs: 8.3, budgetFrameMs: 12.5, total: null, measured: null,
      sections: { Fresh: { fps: 60, medianFrameMs: 16.7 }, Skipped: null } }, 'hunt');
    expect(metrics.measuredSections.Fresh).toEqual({ fps: 60, medianFrameMs: 16.7 });
    expect(metrics.measuredSections).not.toHaveProperty('Skipped');
  });
});
