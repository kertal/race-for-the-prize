import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { hasChromiumInstalled, parseResultsDir } from './test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let tempRaceDir = null;
let resultsDir = null;
const testResultsRoot = path.join(projectRoot, 'test-results');

function buildSpec(title, measureAWaitMs, measureBWaitMs) {
  return `await page.goto('data:text/html,<html><body><h1>${title}</h1></body></html>');
await page.raceRecordingStart();

await page.raceStart('Measure A');
await page.waitForTimeout(${measureAWaitMs});
page.raceEnd('Measure A');

await page.raceStart('Measure B');
await page.waitForTimeout(${measureBWaitMs});
page.raceEnd('Measure B');

await page.raceRecordingEnd();
`;
}

function writeFixture(dir, racerASpec, racerBSpec) {
  fs.writeFileSync(path.join(dir, 'racer-a.spec.js'), racerASpec, 'utf-8');
  fs.writeFileSync(path.join(dir, 'racer-b.spec.js'), racerBSpec, 'utf-8');
}

function runRaceFixture(tempPrefix, buildSpecs) {
  fs.mkdirSync(testResultsRoot, { recursive: true });
  tempRaceDir = fs.mkdtempSync(path.join(testResultsRoot, tempPrefix));
  const { racerASpec, racerBSpec } = buildSpecs();
  writeFixture(tempRaceDir, racerASpec, racerBSpec);

  const proc = spawnSync(
    'node',
    ['race.js', tempRaceDir, '--headless', '--recording=false', '--serve=false', '--runs=1'],
    {
      cwd: projectRoot,
      timeout: 90_000,
      encoding: 'utf-8',
      env: { ...process.env, FORCE_COLOR: '0' },
    }
  );

  expect(proc.status).toBe(0);
  resultsDir = parseResultsDir(projectRoot, proc.stderr);
  expect(resultsDir).toBeTruthy();
  expect(fs.existsSync(resultsDir)).toBe(true);

  const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
  const readme = fs.readFileSync(path.join(resultsDir, 'README.md'), 'utf-8');
  return { proc, summary, readme };
}

describe('tie terminology integration', () => {
  it('reports tie wording in summary output and files', ({ skip }) => {
    if (!hasChromiumInstalled(projectRoot)) {
      skip('Playwright Chromium binary not installed; skipping tie terminology integration test');
    }

    const { proc, summary, readme } = runRaceFixture('rftp-tie-', () => {
      const racerASpec = buildSpec('tie race', 80, 160);
      // Keep this fixture symmetric to make tie expectations deterministic.
      return { racerASpec, racerBSpec: racerASpec };
    });
    expect(summary.overallWinner).toBe('tie');
    expect(readme).toContain("It's a Tie!");
    expect(readme).not.toContain('Draw');
    expect(readme).not.toContain('Unentschieden');

    expect(proc.stderr).toContain("It's a tie!");
    expect(proc.stderr).not.toContain('Draw');
    expect(proc.stderr).not.toContain('Unentschieden');
  });

  it('reports winner when one racer consistently wins, even for small differences', ({ skip }) => {
    if (!hasChromiumInstalled(projectRoot)) {
      skip('Playwright Chromium binary not installed; skipping tie threshold integration test');
    }

    const { summary, readme } = runRaceFixture('rftp-tie-threshold-', () => ({
      racerASpec: buildSpec('threshold tie race', 1500, 1800),
      racerBSpec: buildSpec('threshold tie race', 1530, 1836),
    }));
    expect(summary.wins['racer-a']).toBeGreaterThan(summary.wins['racer-b']);
    expect(summary.overallWinner).toBe('racer-a');
    expect(readme).toContain('Winner: racer-a');
    expect(readme).not.toContain("It's a Tie!");
    expect(readme).not.toContain('Draw');
    expect(readme).not.toContain('Unentschieden');
  });
});

afterEach(() => {
  if (resultsDir && fs.existsSync(resultsDir)) {
    fs.rmSync(resultsDir, { recursive: true, force: true });
    resultsDir = null;
  }
  if (tempRaceDir && fs.existsSync(tempRaceDir)) {
    fs.rmSync(tempRaceDir, { recursive: true, force: true });
    tempRaceDir = null;
  }
});
