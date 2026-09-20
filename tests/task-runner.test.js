import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { runScript, createStderrBuffer } from '../cli/task-runner.js';

describe('createStderrBuffer', () => {
  it('keeps what the script wrote', () => {
    const buf = createStderrBuffer();
    buf.append('one\n');
    buf.append('two\n');
    expect(buf.text).toBe('one\ntwo\n');
  });

  it('ignores anything written after it closes', () => {
    // The pipes outlive the script: a waitFor service inherits them and keeps
    // logging for as long as it runs, into a buffer nobody will ever read.
    const buf = createStderrBuffer();
    buf.append('before\n');
    buf.close();
    buf.append('after\n');
    expect(buf.text).toBe('before\n');
  });

  it('keeps only the tail of a chatty script, and says so', () => {
    const buf = createStderrBuffer(100);
    for (let i = 0; i < 200; i++) buf.append(`line ${i}\n`);
    expect(buf.text).toContain('line 199');
    expect(buf.text).not.toContain('line 0\n');
    expect(buf.text).toContain('earlier output dropped');
    expect(buf.text.length).toBeLessThan(200);
  });

  it('says nothing about dropping when nothing was dropped', () => {
    const buf = createStderrBuffer(100);
    buf.append('short\n');
    expect(buf.text).toBe('short\n');
  });
});

let tmpDir;
let errorSpy;
let stderrSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-runner-test-'));
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Silence progress spinner output
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  errorSpy.mockRestore();
  stderrSpy.mockRestore();
});

const run = (script, label = 'Setup', vars = undefined, options = {}) =>
  runScript(script, label, vars, { raceDir: tmpDir, ...options });

describe('runScript path confinement', () => {
  it('rejects commands that resolve outside the race directory', async () => {
    await expect(run('../outside.sh')).rejects.toThrow(
      'Setup script path must be within race directory: ../outside.sh'
    );
  });

  it('rejects absolute paths outside the race directory', async () => {
    const outside = path.join(os.tmpdir(), 'task-runner-outside.js');
    fs.writeFileSync(outside, 'process.exit(0);');
    try {
      await expect(run(outside)).rejects.toThrow('must be within race directory');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('rejects deep traversal via object config', async () => {
    await expect(run({ command: 'a/../../evil.sh' }, 'Teardown')).rejects.toThrow(
      'Teardown script path must be within race directory'
    );
  });

  it('accepts a script inside a raceDir written with a trailing separator', async () => {
    // A trailing separator must not produce a doubled prefix that rejects
    // scripts genuinely inside the race directory.
    const scriptPath = path.join(tmpDir, 'setup.js');
    fs.writeFileSync(scriptPath, 'process.exit(0);');
    await expect(
      runScript('setup.js', 'Setup', undefined, { raceDir: tmpDir + path.sep })
    ).resolves.toBeUndefined();
  });
});

describe('runScript validation', () => {
  it('resolves immediately for a falsy script', async () => {
    await expect(run(null)).resolves.toBeUndefined();
    await expect(run(undefined)).resolves.toBeUndefined();
  });

  it('rejects config without a valid command field', async () => {
    await expect(run({})).rejects.toThrow("Setup script config missing valid 'command' field");
    await expect(run({ command: '   ' })).rejects.toThrow("missing valid 'command' field");
  });

  it('rejects non-positive or non-finite timeouts', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.js'), 'process.exit(0);');
    await expect(run({ command: 'ok.js', timeout: -1 })).rejects.toThrow('Setup timeout must be a positive number');
    await expect(run({ command: 'ok.js', timeout: Infinity })).rejects.toThrow('timeout must be a positive number');
  });

  it('warns and resolves when the script does not exist', async () => {
    await expect(run('missing.js')).resolves.toBeUndefined();
    const output = errorSpy.mock.calls.map(args => args.join(' ')).join('\n');
    expect(output).toContain('Warning: Setup script not found');
  });

  it('rejects symlinked scripts (not a regular file)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'target.js'), 'process.exit(0);');
    fs.symlinkSync(path.join(tmpDir, 'target.js'), path.join(tmpDir, 'link.js'));
    await expect(run('link.js')).rejects.toThrow('Setup script path is not a regular file');
  });

  it('rejects directories (not a regular file)', async () => {
    fs.mkdirSync(path.join(tmpDir, 'dir.js'));
    await expect(run('dir.js')).rejects.toThrow('is not a regular file');
  });

  it('rejects unsupported extensions', async () => {
    fs.writeFileSync(path.join(tmpDir, 'script.py'), 'print("no")');
    await expect(run('script.py')).rejects.toThrow(
      "Setup script has unsupported extension '.py' (expected .sh or .js)"
    );
  });

  it('rejects waitFor that is not an object with a url', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.js'), 'process.exit(0);');
    await expect(run({ command: 'ok.js', waitFor: ['x'] })).rejects.toThrow(
      "Setup waitFor must be an object with a 'url' field"
    );
    await expect(run({ command: 'ok.js', waitFor: { url: '' } })).rejects.toThrow(
      'Setup waitFor.url must be a non-empty string'
    );
    await expect(run({ command: 'ok.js', waitFor: { url: 'http://x', timeout: -5 } })).rejects.toThrow(
      'Setup waitFor.timeout must be a positive number'
    );
    await expect(run({ command: 'ok.js', waitFor: { url: 'http://x', interval: 0 } })).rejects.toThrow(
      'Setup waitFor.interval must be a positive number'
    );
  });
});

describe('runScript execution', () => {
  it('runs a trivial node script successfully', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.js'), 'process.exit(0);');
    await expect(run('ok.js')).resolves.toBeUndefined();
  });

  it('exposes RACE_DIR and RACE_VAR_* env vars to the script', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'env.js'),
      "require('fs').writeFileSync('out.txt', process.env.RACE_DIR + '|' + process.env.RACE_VAR_PORT);"
    );
    await run('env.js', 'Setup', { port: 8080 });
    const out = fs.readFileSync(path.join(tmpDir, 'out.txt'), 'utf-8');
    expect(out).toBe(`${tmpDir}|8080`);
  });

  it('rejects when the script exits non-zero', async () => {
    fs.writeFileSync(path.join(tmpDir, 'fail.js'), 'console.error("boom"); process.exit(3);');
    await expect(run('fail.js', 'Teardown')).rejects.toThrow('Teardown script exited with code 3');
  });

  describe('a background process holding the script pipes', () => {
    // `npm start &` style setup scripts hand the server the script's own
    // stdout/stderr, so 'close' only fires once the server dies.
    let server, url;
    beforeEach(async () => {
      server = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${server.address().port}/health`;
    });
    afterEach(() => new Promise(resolve => server.close(resolve)));

    it('does not keep a waitFor script from settling', async () => {
      // Regression: runScript waited for 'close', so the race hung on
      // "Running setup…" for as long as the server lived.
      fs.writeFileSync(path.join(tmpDir, 'bg.sh'), '#!/bin/sh\nsleep 5 &\nexit 0\n');
      const started = Date.now();
      await run({ command: 'bg.sh', timeout: 3000, waitFor: { url, interval: 50 } });
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('still lets a waitFor script report its exit code and stderr', async () => {
      fs.writeFileSync(path.join(tmpDir, 'bg-fail.sh'), '#!/bin/sh\necho oops >&2\nsleep 5 &\nexit 7\n');
      await expect(run({ command: 'bg-fail.sh', timeout: 3000, waitFor: { url } })).rejects.toThrow('exited with code 7');
      expect(errorSpy.mock.calls.some(call => String(call[0]).includes('oops'))).toBe(true);
    });

    it('is waited for by a plain script, so background work can finish', async () => {
      // Without waitFor the script settles when its pipes close: work it
      // backgrounded (writing race fixtures, say) is done by then.
      fs.writeFileSync(path.join(tmpDir, 'bg-work.sh'), '#!/bin/sh\n(sleep 0.5; echo done > marker) &\nexit 0\n');
      await run({ command: 'bg-work.sh', timeout: 5000 });
      expect(fs.existsSync(path.join(tmpDir, 'marker'))).toBe(true);
    });

    it('is named in the timeout error of a plain script', async () => {
      fs.writeFileSync(path.join(tmpDir, 'bg-forever.sh'), '#!/bin/sh\nsleep 5 &\nexit 0\n');
      const started = Date.now();
      await expect(run({ command: 'bg-forever.sh', timeout: 300 })).rejects.toThrow(/still holding its output.*waitFor/);
      // Rejects at the timeout, not when the background process finally lets go.
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('does not hold up a plain script still running at its timeout', async () => {
      // The script itself is alive at the timeout, so it is killed — but its
      // descendant keeps the pipes, so 'close' never comes. Waiting for it
      // would hang the race on a script that has already been given up on.
      fs.writeFileSync(path.join(tmpDir, 'slow-bg.sh'), '#!/bin/sh\nsleep 5 &\nsleep 30\n');
      const started = Date.now();
      await expect(run({ command: 'slow-bg.sh', timeout: 300 })).rejects.toThrow(/timed out after 300ms/);
      expect(Date.now() - started).toBeLessThan(3000);
    }, 15000);
  });

  it('rejects with a timeout error when the script exceeds its timeout', async () => {
    fs.writeFileSync(path.join(tmpDir, 'slow.js'), 'setTimeout(() => {}, 60000);');
    await expect(run({ command: 'slow.js', timeout: 300 })).rejects.toThrow(
      'Setup script timed out after 300ms'
    );
  }, 15000);

  it('resolves once the waitFor URL responds with 2xx', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.js'), 'process.exit(0);');
    const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      await expect(
        run({ command: 'ok.js', waitFor: { url: `http://127.0.0.1:${port}/health`, interval: 50 } })
      ).resolves.toBeUndefined();
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('rejects when the waitFor URL never becomes ready', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ok.js'), 'process.exit(0);');
    // Serve a deterministic non-2xx rather than assuming a port is closed:
    // port 9 (discard) is open on some systems, which made this flaky.
    const server = http.createServer((_req, res) => { res.writeHead(503); res.end(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      await expect(
        run({ command: 'ok.js', waitFor: { url: `http://127.0.0.1:${port}/`, timeout: 400, interval: 50 } })
      ).rejects.toThrow(new RegExp(`Timeout waiting for http://127\\.0\\.0\\.1:${port}/ after 400ms`));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }, 15000);

  it('accepts a script inside a raceDir given as the filesystem root', async () => {
    // A `resolvedRaceDir + path.sep` prefix becomes '//' for a root raceDir and
    // rejected every child; isPathInside handles it.
    const marker = path.join(tmpDir, 'root-scoped.js');
    fs.writeFileSync(marker, 'process.exit(0);');
    const rootDir = path.parse(tmpDir).root;
    const relFromRoot = path.relative(rootDir, marker);
    await expect(
      runScript(relFromRoot, 'Setup', undefined, { raceDir: rootDir })
    ).resolves.toBeUndefined();
  }, 15000);
});
