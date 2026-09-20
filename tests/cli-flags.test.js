import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_NAME, packageVersion, printAndExit } from '../race.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

// Spawned rather than called in-process: exit codes, the stream each screen
// lands on, and surviving a piped stdout only show up in a real child process.
function runCli(...args) {
  return spawnSync(process.execPath, ['race.js', ...args], { cwd: ROOT, encoding: 'utf-8' });
}

// The same CLI started the way an npm install starts it: through a bin shim
// named after the package, which is what puts `race-for-the-prize` in argv[1].
function runInstalled(...args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-bin-'));
  const shim = path.join(dir, CLI_NAME);
  fs.symlinkSync(path.join(ROOT, 'race.js'), shim);
  try {
    return spawnSync(process.execPath, [shim, ...args], { cwd: ROOT, encoding: 'utf-8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The bin name is what every doc and help line tells people to type, so it
// must be the one package.json actually installs.
describe('CLI_NAME and packageVersion', () => {
  it('CLI_NAME is the bin package.json installs', () => {
    expect(Object.keys(pkg.bin)).toEqual([CLI_NAME]);
  });

  it('packageVersion reads the published version', () => {
    expect(packageVersion()).toBe(pkg.version);
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('--version', () => {
  it('prints "<bin> v<version>" on stdout and exits 0', () => {
    const { status, stdout, stderr } = runCli('--version');
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(`${CLI_NAME} v${pkg.version}`);
    expect(stderr).toBe('');
  });
});

describe('--help', () => {
  it('prints the usage banner on stdout and exits 0', () => {
    const { status, stdout, stderr } = runCli('--help');
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Race two browsers');
  });

  it('names the command an npm install put on the reader\'s PATH', () => {
    const { status, stdout } = runInstalled('--help');
    expect(status).toBe(0);
    expect(stdout).toContain(`${CLI_NAME} demo:lauda-vs-hunt`);
    expect(stdout).toContain(`npx ${CLI_NAME}`);
    // Nobody installing from npm has a race.js to run.
    expect(stdout).not.toContain('node race.js');
  });

  it('names the command a checkout can actually run', () => {
    const { stdout } = runCli('--help');
    expect(stdout).toContain('node race.js demo:lauda-vs-hunt');
    // The install instructions still name the package, as they must.
    expect(stdout).toContain(`npx ${CLI_NAME}`);
  });

  it('reaches its last line through a pipe, rather than exiting mid-write', () => {
    const { stdout } = runCli('--help');
    expect(strip(stdout).trimEnd()).toMatch(/--version {3}\(v[\d.]+\)$/);
  });

  it('no arguments shows the same banner on stderr but exits 1', () => {
    const { status, stdout, stderr } = runCli();
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Race two browsers');
    expect(strip(stderr).trimEnd()).toMatch(/--version {3}\(v[\d.]+\)$/);
  });

  it('an unknown flag points at --help, spelled for this invocation', () => {
    expect(runCli('--bogus').status).toBe(2);
    expect(strip(runCli('--bogus').stderr)).toContain('Run node race.js --help');
    expect(strip(runInstalled('--bogus').stderr)).toContain(`Run ${CLI_NAME} --help`);
  });
});

describe('printAndExit', () => {
  it('writes the whole text, with a trailing newline, before exiting', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-exit-')), 'out.txt');
    const fd = fs.openSync(file, 'w');
    try {
      printAndExit({ fd }, 'bye', 3);
      expect(fs.readFileSync(file, 'utf-8')).toBe('bye\n');
      expect(exit).toHaveBeenCalledWith(3);
    } finally {
      fs.closeSync(fd);
      exit.mockRestore();
    }
  });
});
