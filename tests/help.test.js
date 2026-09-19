import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { buildHelp, resolveInvocation, PKG_NAME } from '../cli/help.js';
import { KNOWN_FLAGS } from '../cli/config.js';
import { printAndExit } from '../race.js';

const RACE_JS = fileURLToPath(new URL('../race.js', import.meta.url));

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('resolveInvocation', () => {
  it('uses the bare bin name for a global install', () => {
    expect(resolveInvocation(`/usr/local/bin/${PKG_NAME}`)).toBe(PKG_NAME);
  });

  it('uses npx for a one-off npx run (the shim does not survive it)', () => {
    expect(resolveInvocation(`/home/me/.npm/_npx/9f3/node_modules/.bin/${PKG_NAME}`)).toBe(`npx ${PKG_NAME}`);
  });

  it('uses npx for a project dependency', () => {
    expect(resolveInvocation(`/work/app/node_modules/${PKG_NAME}/race.js`)).toBe(`npx ${PKG_NAME}`);
  });

  it('uses npx for a project-local bin shim, whose name matches the global one', () => {
    expect(resolveInvocation(`/work/app/node_modules/.bin/${PKG_NAME}`)).toBe(`npx ${PKG_NAME}`);
  });

  it('handles the Windows bin shim and separators', () => {
    expect(resolveInvocation(`C:\\Users\\me\\AppData\\npm\\${PKG_NAME}.cmd`)).toBe(PKG_NAME);
  });

  it('falls back to node race.js for a git checkout', () => {
    expect(resolveInvocation('/home/me/race-for-the-prize/race.js')).toBe('node race.js');
    expect(resolveInvocation('')).toBe('node race.js');
    expect(resolveInvocation(null)).toBe('node race.js');
  });
});

describe('buildHelp', () => {
  const installedHelp = () => strip(buildHelp(PKG_NAME));
  const checkoutHelp = () => strip(buildHelp('node race.js'));

  it('spells every example with the command the reader actually has', () => {
    const help = installedHelp();
    expect(help).not.toContain('node race.js');
    expect(help).toContain(`${PKG_NAME} <url> <url> [url...]`);
    expect(help).toContain(`${PKG_NAME} --init my-race`);
  });

  it('keeps node race.js for a checkout', () => {
    expect(checkoutHelp()).toContain('node race.js --init my-race');
  });

  it('documents how to install the published package', () => {
    const help = installedHelp();
    expect(help).toContain(`npx ${PKG_NAME}@latest`);
    expect(help).toContain(`npm install -g ${PKG_NAME}`);
    expect(help).toContain(`npm install -D ${PKG_NAME}`);
    expect(help).toContain('npx playwright install chromium');
  });

  it('sends every reader to a demo race, which needs no races/ of their own', () => {
    expect(installedHelp()).toContain(`Try a demo:  ${PKG_NAME} demo:lauda-vs-hunt`);
    expect(checkoutHelp()).toContain('Try a demo:  node race.js demo:lauda-vs-hunt');
    expect(installedHelp()).toContain(`${PKG_NAME} demo — to list them all`);
  });

  it('lists the built-in skins it was given', () => {
    const help = strip(buildHelp(PKG_NAME, ['light', 'neon']));
    expect(help).toContain('light, neon, or a path to a .css file');
  });

  it('documents every flag the CLI accepts', () => {
    const help = installedHelp();
    for (const flag of KNOWN_FLAGS) {
      expect(help, `--${flag} is missing from the help`).toContain(`--${flag}`);
    }
  });

  it('lines the flag descriptions up in one column', () => {
    const flagLines = installedHelp()
      .split('\n')
      .filter(l => /^ {2}--/.test(l) && l.trim().includes('  '));
    expect(flagLines.length).toBeGreaterThan(20);
    for (const line of flagLines) {
      expect(line.search(/ \S/g) >= 0).toBe(true);
      const description = line.replace(/^ {2}\S+ +/, '');
      expect(line.length - description.length, `misaligned: ${line}`).toBe(25);
    }
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

describe('CLI parting screens', () => {
  // Spawned, not called in-process: the point is that the screens survive a
  // piped stdout, which only a real child process with a real pipe can show.
  const run = args => spawnSync(process.execPath, [RACE_JS, ...args], { encoding: 'utf-8' });

  it('prints the whole help on stdout and exits 0', () => {
    const { status, stdout, stderr } = run(['--help']);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Race two browsers');
    expect(strip(stdout).trimEnd()).toMatch(/Try a demo: {2}node race\.js demo:lauda-vs-hunt$/);
  });

  it('prints the package version on stdout and exits 0', () => {
    const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
    const { status, stdout } = run(['--version']);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(version);
  });

  it('prints the help on stderr and exits 1 when given no arguments', () => {
    const { status, stdout, stderr } = run([]);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Race two browsers');
    expect(strip(stderr).trimEnd()).toMatch(/Try a demo: {2}node race\.js demo:lauda-vs-hunt$/);
  });
});
