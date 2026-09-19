import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEMO_RACES,
  parseDemoArg,
  findDemo,
  demoSourceDir,
  planDemo,
  copyDemo,
  formatDemoList,
  UnknownDemoError,
} from '../cli/demos.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function withTempCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-demo-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('parseDemoArg', () => {
  it('parses demo:<name>', () => {
    expect(parseDemoArg('demo:lauda-vs-hunt')).toEqual({ name: 'lauda-vs-hunt' });
  });

  it('treats a bare demo (or demo:) as a request to list them', () => {
    expect(parseDemoArg('demo')).toEqual({ name: null });
    expect(parseDemoArg('demo:')).toEqual({ name: null });
  });

  it('ignores anything that is not a demo command', () => {
    expect(parseDemoArg('./races/lauda-vs-hunt')).toBeNull();
    expect(parseDemoArg('https://react.dev')).toBeNull();
    expect(parseDemoArg('demos:lauda-vs-hunt')).toBeNull();
    expect(parseDemoArg(undefined)).toBeNull();
  });
});

describe('DEMO_RACES', () => {
  it('names only races that actually ship in races/', () => {
    for (const demo of DEMO_RACES) {
      const dir = demoSourceDir(demo.name, ROOT);
      expect(fs.existsSync(dir), `missing demo race: ${dir}`).toBe(true);
      const specs = fs.readdirSync(dir).filter(f => f.endsWith('.spec.js'));
      expect(specs.length, `no specs in ${dir}`).toBeGreaterThan(0);
    }
  });

  it('is covered by the package.json files globs', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.files).toContain('races/*/*.spec.js');
    expect(pkg.files).toContain('races/*/settings.json');
  });

  it('has a unique name and a description per demo', () => {
    const names = DEMO_RACES.map(d => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const demo of DEMO_RACES) expect(demo.description).toBeTruthy();
  });
});

describe('findDemo', () => {
  it('looks demos up by name', () => {
    expect(findDemo('lauda-vs-hunt')).toMatchObject({ name: 'lauda-vs-hunt' });
  });

  it('returns null for unknown names', () => {
    expect(findDemo('nope')).toBeNull();
    expect(findDemo('../../etc')).toBeNull();
  });
});

describe('planDemo', () => {
  it('lists the files a demo would copy into <cwd>/races/<name>, without writing them', () => {
    withTempCwd(cwd => {
      const plan = planDemo('lauda-vs-hunt', { rootDir: ROOT, cwd });
      expect(plan.demo.name).toBe('lauda-vs-hunt');
      expect(plan.dir).toBe(path.join(cwd, 'races', 'lauda-vs-hunt'));
      expect(plan.files).toEqual(expect.arrayContaining(['lauda.spec.js', 'hunt.spec.js']));
      // Planning alone must never touch the user's directory — the CLI asks first.
      expect(fs.existsSync(path.join(cwd, 'races'))).toBe(false);
    });
  });

  it('leaves out files that are already there, so local edits survive', () => {
    withTempCwd(cwd => {
      const target = path.join(cwd, 'races', 'lauda-vs-hunt');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'lauda.spec.js'), '// my edit\n');

      const plan = planDemo('lauda-vs-hunt', { rootDir: ROOT, cwd });

      expect(plan.files).not.toContain('lauda.spec.js');
      expect(plan.files).toContain('hunt.spec.js');
    });
  });

  it('plans no copy at all when run from the package itself', () => {
    const plan = planDemo('lauda-vs-hunt', { rootDir: ROOT, cwd: ROOT });
    expect(plan.dir).toBe(demoSourceDir('lauda-vs-hunt', ROOT));
    expect(plan.files).toEqual([]);
  });

  it('never plans to copy results directories', () => {
    withTempCwd(cwd => {
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-demo-src-'));
      const srcRace = path.join(source, 'races', 'lauda-vs-hunt');
      fs.mkdirSync(path.join(srcRace, 'results-2025-01-01_00-00-00'), { recursive: true });
      fs.writeFileSync(path.join(srcRace, 'lauda.spec.js'), '// spec\n');
      try {
        expect(planDemo('lauda-vs-hunt', { rootDir: source, cwd }).files).toEqual(['lauda.spec.js']);
      } finally {
        fs.rmSync(source, { recursive: true, force: true });
      }
    });
  });

  it('throws UnknownDemoError for a name that is not a demo', () => {
    withTempCwd(cwd => {
      expect(() => planDemo('nope', { rootDir: ROOT, cwd })).toThrow(UnknownDemoError);
      // Path traversal can never reach the filesystem — the list is a whitelist.
      expect(() => planDemo('../../etc', { rootDir: ROOT, cwd })).toThrow(UnknownDemoError);
      expect(fs.existsSync(path.join(cwd, 'races'))).toBe(false);
    });
  });

  it('reports a demo missing from the install', () => {
    withTempCwd(cwd => {
      expect(() => planDemo('lauda-vs-hunt', { rootDir: cwd, cwd }))
        .toThrow(/missing from this install/);
    });
  });
});

describe('copyDemo', () => {
  it('copies exactly the planned files', () => {
    withTempCwd(cwd => {
      const plan = planDemo('lauda-vs-hunt', { rootDir: ROOT, cwd });
      expect(copyDemo(plan)).toEqual(plan.files);
      expect(fs.readdirSync(plan.dir).sort()).toEqual([...plan.files].sort());
      expect(fs.readFileSync(path.join(plan.dir, 'lauda.spec.js'), 'utf-8'))
        .toBe(fs.readFileSync(path.join(demoSourceDir('lauda-vs-hunt', ROOT), 'lauda.spec.js'), 'utf-8'));
    });
  });

  it('writes nothing for an empty plan', () => {
    withTempCwd(cwd => {
      const plan = { ...planDemo('lauda-vs-hunt', { rootDir: ROOT, cwd }), files: [] };
      expect(copyDemo(plan)).toEqual([]);
      expect(fs.existsSync(path.join(cwd, 'races'))).toBe(false);
    });
  });
});

describe('formatDemoList', () => {
  it('lists every demo with its description', () => {
    const out = formatDemoList();
    for (const demo of DEMO_RACES) {
      expect(out).toContain(`demo:${demo.name}`);
      expect(out).toContain(demo.description);
    }
  });

  it('spells the "run one with" hint the way the caller was started', () => {
    expect(formatDemoList({}, 'node race.js'))
      .toContain(`Run one with:  node race.js demo:${DEMO_RACES[0].name}`);
    expect(formatDemoList()).toContain(`Run one with:  race-for-the-prize demo:${DEMO_RACES[0].name}`);
  });
});
