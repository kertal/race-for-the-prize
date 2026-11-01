/**
 * Integration test: --cpu must still be in force when the race is timed.
 *
 * CPU throttling is applied through a CDP session, and Chrome keeps the rate
 * per session: attaching another one to the page can start it over at 1x. The
 * runner attaches two after throttling is first applied — one for profiling,
 * one lazily in raceWaitForVisualStability — and tests/runner.test.js pins the
 * order in which the throttle is re-applied behind them. This test checks the
 * outcome those mocks cannot: in a real Chromium, with both sessions attached
 * before the timed section starts, a fixed amount of JavaScript work has to
 * take clearly longer at --cpu=4 than at --cpu=1.
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

// Both extra CDP sessions are up before the section starts: the profiling one
// from the moment the page opened, the stability one from the wait below. The
// section then does a fixed amount of main-thread work — the iteration count is
// what stays constant between the two runs; how long it takes is what
// throttling changes.
const SPEC = [
  "await page.setContent('<!doctype html><title>busy</title>');",
  'await page.raceWaitForVisualStability({ timeout: 500 });',
  "await page.raceStart('Crunch');",
  'await page.evaluate(() => { let x = 0; for (let i = 0; i < 3e7; i++) x += Math.sqrt(i); return x; });',
  "page.raceEnd('Crunch');",
].join('\n');

function runRace(extraArgs) {
  return spawnSync(
    'node',
    ['race.js', path.relative(projectRoot, raceDir), '--headless', '--recording=false',
      '--serve=false', ...extraArgs],
    { cwd: projectRoot, timeout: 120_000, encoding: 'utf-8', env: { ...process.env, FORCE_COLOR: '0' } }
  );
}

/** Each racer's measured duration of the Crunch section, in seconds. */
function readDurations(proc) {
  expect(proc.status, proc.stderr).toBe(0);
  const resultsDir = parseResultsDir(projectRoot, proc.stderr);
  expect(resultsDir).toBeTruthy();
  const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
  const crunch = summary.comparisons.find(comp => comp.name === 'Crunch');
  expect(crunch).toBeTruthy();
  return crunch.racers.map(r => r?.duration);
}

describe('--cpu', () => {
  it('still slows the timed section down with the profiling and stability sessions attached', ({ skip }) => {
    if (!hasChromiumInstalled(projectRoot)) {
      skip('Playwright Chromium binary not installed; skipping --cpu integration test');
    }

    raceDir = fs.mkdtempSync(path.join(projectRoot, 'races', 'tmp-cpu-'));
    fs.writeFileSync(path.join(raceDir, 'alpha.spec.js'), SPEC);
    fs.writeFileSync(path.join(raceDir, 'bravo.spec.js'), SPEC);

    const unthrottled = readDurations(runRace(['--cpu=1']));
    const throttled = readDurations(runRace(['--cpu=4']));
    expect(unthrottled).toHaveLength(2);
    expect(throttled).toHaveLength(2);

    for (let i = 0; i < 2; i++) {
      expect(unthrottled[i]).toBeGreaterThan(0);
      // 4x throttling makes the same work take about four times as long. The
      // floor is well under that so machine noise cannot fail it, and well
      // over the ~1x a lost throttle produces.
      const ratio = throttled[i] / unthrottled[i];
      expect(ratio, `racer ${i}: ${throttled[i]}s throttled vs ${unthrottled[i]}s unthrottled`).toBeGreaterThan(2);
    }
  }, 150_000);
});

afterEach(() => {
  if (raceDir && fs.existsSync(raceDir)) fs.rmSync(raceDir, { recursive: true, force: true });
  raceDir = null;
});
