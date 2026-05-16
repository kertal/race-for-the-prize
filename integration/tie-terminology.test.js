import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let tempRaceDir = null;
let resultsDir = null;

function hasChromiumInstalled() {
  const check = spawnSync(
    'node',
    [
      '-e',
      "const { chromium } = require('playwright'); const fs = require('fs'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);",
    ],
    { cwd: projectRoot, timeout: 10_000 }
  );
  return check.status === 0;
}

function parseResultsDir(stderrText) {
  const ansiRe = new RegExp('\\u001B\\[[0-9;]*m', 'g');
  const stripped = stderrText.replace(ansiRe, '');
  const match = stripped.match(/📂\s+(.+)/);
  return match ? path.resolve(projectRoot, match[1].trim()) : null;
}

function writeRaceFixture(dir) {
  const racerASpec = `await page.goto('data:text/html,<html><body><h1>tie race</h1></body></html>');
await page.raceRecordingStart();

await page.raceStart('Measure A');
await page.waitForTimeout(80);
page.raceEnd('Measure A');

await page.raceStart('Measure B');
await page.waitForTimeout(160);
page.raceEnd('Measure B');

await page.raceRecordingEnd();
`;

  // Keep this fixture symmetric to make tie expectations deterministic.
  const racerBSpec = racerASpec;

  fs.writeFileSync(path.join(dir, 'racer-a.spec.js'), racerASpec, 'utf-8');
  fs.writeFileSync(path.join(dir, 'racer-b.spec.js'), racerBSpec, 'utf-8');
}

function writeThresholdTieFixture(dir) {
  const racerASpec = `await page.goto('data:text/html,<html><body><h1>threshold tie race</h1></body></html>');
await page.raceRecordingStart();

await page.raceStart('Measure A');
await page.waitForTimeout(1500);
page.raceEnd('Measure A');

await page.raceStart('Measure B');
await page.waitForTimeout(1800);
page.raceEnd('Measure B');

await page.raceRecordingEnd();
`;

  const racerBSpec = `await page.goto('data:text/html,<html><body><h1>threshold tie race</h1></body></html>');
await page.raceRecordingStart();

await page.raceStart('Measure A');
await page.waitForTimeout(1530);
page.raceEnd('Measure A');

await page.raceStart('Measure B');
await page.waitForTimeout(1836);
page.raceEnd('Measure B');

await page.raceRecordingEnd();
`;

  fs.writeFileSync(path.join(dir, 'racer-a.spec.js'), racerASpec, 'utf-8');
  fs.writeFileSync(path.join(dir, 'racer-b.spec.js'), racerBSpec, 'utf-8');
}

describe('tie terminology integration', () => {
  it('reports tie wording in summary output and files', ({ skip }) => {
    if (!hasChromiumInstalled()) {
      skip('Playwright Chromium binary not installed; skipping tie terminology integration test');
    }

    tempRaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-tie-'));
    writeRaceFixture(tempRaceDir);

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

    resultsDir = parseResultsDir(proc.stderr);
    expect(resultsDir).toBeTruthy();
    expect(fs.existsSync(resultsDir)).toBe(true);

    const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
    expect(summary.overallWinner).toBe('tie');

    const readme = fs.readFileSync(path.join(resultsDir, 'README.md'), 'utf-8');
    expect(readme).toContain("It's a Tie!");
    expect(readme).not.toContain('Draw');
    expect(readme).not.toContain('Unentschieden');

    expect(proc.stderr).toContain("It's a tie!");
    expect(proc.stderr).not.toContain('Draw');
    expect(proc.stderr).not.toContain('Unentschieden');
  });

  it('reports winner when one racer consistently wins, even for small differences', ({ skip }) => {
    if (!hasChromiumInstalled()) {
      skip('Playwright Chromium binary not installed; skipping tie threshold integration test');
    }

    tempRaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-tie-threshold-'));
    writeThresholdTieFixture(tempRaceDir);

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

    resultsDir = parseResultsDir(proc.stderr);
    expect(resultsDir).toBeTruthy();
    expect(fs.existsSync(resultsDir)).toBe(true);

    const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
    expect(summary.wins['racer-a']).toBeGreaterThan(summary.wins['racer-b']);
    expect(summary.overallWinner).toBe('racer-a');

    const readme = fs.readFileSync(path.join(resultsDir, 'README.md'), 'utf-8');
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
