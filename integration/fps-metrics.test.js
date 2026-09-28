/**
 * Integration test: --fps must actually produce frame timing.
 *
 * The whole feature rests on one assumption about the browser — that the
 * `disabled-by-default-devtools.timeline.frame` category emits `DrawFrame`
 * instant events, one per frame the compositor draws. Nothing in the unit tests
 * can check that, because they feed frame-stats.cjs synthetic events. If a
 * Chrome update renames or drops that event, --fps would silently report
 * nothing at all, so this runs a real race and looks at the numbers.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { hasChromiumInstalled, parseResultsDir } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

let raceDir = null;

// A page that animates on the compositor for a second. A CSS transform keeps
// the main thread out of it, which is exactly the case the AnimationFrame::*
// events miss and DrawFrame catches.
const PAGE = `<!doctype html><style>
  @keyframes slide { from { transform: translateX(0) } to { transform: translateX(300px) } }
  .box { width: 80px; height: 80px; background: crimson;
         animation: slide 0.5s linear infinite; will-change: transform }
</style><div class="box"></div>`;

function specFor(pageHtml) {
  return [
    `await page.setContent(${JSON.stringify(pageHtml)});`,
    "await page.raceStart('Animate');",
    'await page.waitForTimeout(1200);',
    "page.raceEnd('Animate');",
  ].join('\n');
}

function runRace(extraArgs) {
  return spawnSync(
    'node',
    ['race.js', path.relative(projectRoot, raceDir), '--headless', '--recording=false',
      '--serve=false', ...extraArgs],
    { cwd: projectRoot, timeout: 120_000, encoding: 'utf-8', env: { ...process.env, FORCE_COLOR: '0' } }
  );
}

function readProfiles(proc) {
  const resultsDir = parseResultsDir(projectRoot, proc.stderr);
  expect(resultsDir).toBeTruthy();
  const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
  return summary.profileMetrics;
}

describe('--fps', () => {
  it('derives frame timing from a real race, and only when asked', ({ skip }) => {
    if (!hasChromiumInstalled(projectRoot)) {
      skip('Playwright Chromium binary not installed; skipping --fps integration test');
    }

    raceDir = fs.mkdtempSync(path.join(projectRoot, 'races', 'tmp-fps-'));
    const spec = specFor(PAGE);
    fs.writeFileSync(path.join(raceDir, 'alpha.spec.js'), spec);
    fs.writeFileSync(path.join(raceDir, 'bravo.spec.js'), spec);

    const withFps = runRace(['--fps']);
    expect(withFps.status).toBe(0);
    const profiles = readProfiles(withFps);
    expect(profiles).toHaveLength(2);

    for (const profile of profiles) {
      // The display period has to look like real hardware, not like noise.
      expect(profile.frameTiming.displayFrameMs).toBeGreaterThan(2);
      expect(profile.frameTiming.displayFrameMs).toBeLessThan(60);
      expect(profile.frameTiming.budgetFrameMs)
        .toBeCloseTo(profile.frameTiming.displayFrameMs * 1.5, 1);

      // Whole journey and the measured scope both carry frame numbers.
      for (const scope of [profile.total, profile.measured]) {
        expect(scope.frames).toBeGreaterThan(3);
        expect(scope.medianFrameMs).toBeGreaterThan(0);
        expect(scope.p95FrameMs).toBeGreaterThanOrEqual(scope.medianFrameMs);
        expect(scope.worstFrameMs).toBeGreaterThanOrEqual(scope.p95FrameMs);
        expect(scope.droppedFrames).not.toBeNull();
      }

      // And so does the section the spec measured, keyed by its own name.
      const section = profile.measuredSections.Animate;
      expect(section.frames).toBeGreaterThan(3);
      expect(section.medianFrameMs).toBeGreaterThan(0);
      // A compositor animation over more than a second draws many frames; this
      // is the case that reads as ~0 fps if the frame source is ever wrong.
      expect(section.fps).toBeGreaterThan(10);
    }

    // Without the flag the trace has no frame category, so the metrics are
    // absent rather than zero — and no warning is printed about it.
    const withoutFps = runRace([]);
    expect(withoutFps.status).toBe(0);
    for (const profile of readProfiles(withoutFps)) {
      expect(profile.frameTiming).toBeUndefined();
      expect(profile.total.medianFrameMs).toBeUndefined();
      expect(profile.measuredSections.Animate.medianFrameMs).toBeUndefined();
    }
    expect(withoutFps.stderr).not.toContain('no frame events');
  }, 150_000);
});

afterEach(() => {
  if (raceDir && fs.existsSync(raceDir)) fs.rmSync(raceDir, { recursive: true, force: true });
  raceDir = null;
});
