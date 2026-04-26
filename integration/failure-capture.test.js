/**
 * Integration test: when a race script throws (e.g. selector timeout),
 * the runner writes a screenshot and HTML dump of the failing page.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('failure capture', () => {
  let recordingsDir;

  afterEach(() => {
    if (recordingsDir && fs.existsSync(recordingsDir)) {
      fs.rmSync(recordingsDir, { recursive: true, force: true });
    }
  });

  it('writes screenshot and HTML when a race script throws', () => {
    recordingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-failure-'));

    const config = {
      browsers: [{
        id: 'failing',
        script: [
          "await page.goto('data:text/html,<html><body><h1>hello-from-failure-test</h1></body></html>');",
          "await page.click('#does-not-exist', { timeout: 500 });",
        ].join('\n'),
        vars: {},
      }],
      executionMode: 'sequential',
      headless: true,
      noOverlay: true,
      noRecording: true,
      recordingsDir,
    };

    const proc = spawnSync('node', ['runner.cjs', JSON.stringify(config)], {
      cwd: projectRoot,
      timeout: 60_000,
      encoding: 'utf-8',
    });

    expect(proc.status).toBe(1);

    const racerDir = path.join(recordingsDir, 'failing');
    const screenshotPath = path.join(racerDir, 'failing.failure.png');
    const htmlPath = path.join(racerDir, 'failing.failure.html');

    expect(fs.existsSync(screenshotPath)).toBe(true);
    expect(fs.statSync(screenshotPath).size).toBeGreaterThan(0);

    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, 'utf-8');
    expect(html).toContain('hello-from-failure-test');

    expect(proc.stderr).toContain('Failure URL:');
    expect(proc.stderr).toContain('Failure screenshot saved:');
    expect(proc.stderr).toContain('Failure HTML saved:');
  });
});
