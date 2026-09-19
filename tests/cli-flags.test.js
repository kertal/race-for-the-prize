import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_NAME, packageVersion } from '../race.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

// The bin name is what every doc and help line tells people to type, so it
// must be the one package.json actually installs.
function runCli(...args) {
  return spawnSync(process.execPath, ['race.js', ...args], { cwd: ROOT, encoding: 'utf-8' });
}

describe('CLI_NAME and packageVersion', () => {
  it('CLI_NAME is the bin package.json installs', () => {
    expect(Object.keys(pkg.bin)).toEqual([CLI_NAME]);
  });

  it('packageVersion reads the published version', () => {
    expect(packageVersion()).toBe(pkg.version);
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('race-for-the-prize --version', () => {
  it('prints "<bin> v<version>" on stdout and exits 0', () => {
    const { status, stdout, stderr } = runCli('--version');
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(`${CLI_NAME} v${pkg.version}`);
    expect(stderr).toBe('');
  });
});

describe('race-for-the-prize --help', () => {
  it('prints the usage banner and exits 0', () => {
    const { status, stderr } = runCli('--help');
    expect(status).toBe(0);
    expect(stderr).toContain('Quick Start');
    expect(stderr).toContain(`${CLI_NAME} demo:lauda-vs-hunt`);
    expect(stderr).toContain(`npx ${CLI_NAME}`);
  });

  it('the banner never tells people to run the entry point by file name', () => {
    const { stderr } = runCli('--help');
    expect(stderr).not.toContain('node race.js');
  });

  it('no arguments shows the same banner but exits 1', () => {
    const { status, stderr } = runCli();
    expect(status).toBe(1);
    expect(stderr).toContain('Quick Start');
  });

  it('an unknown flag points at --help', () => {
    const { status, stderr } = runCli('--bogus');
    expect(status).toBe(2);
    expect(stderr).toContain(`${CLI_NAME} --help`);
  });
});
