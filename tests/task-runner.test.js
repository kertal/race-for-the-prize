import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { runScript } from '../cli/task-runner.js';

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
    // Port 9 (discard) on localhost is almost certainly closed; connection refused
    await expect(
      run({ command: 'ok.js', waitFor: { url: 'http://127.0.0.1:9/', timeout: 400, interval: 50 } })
    ).rejects.toThrow(/Timeout waiting for http:\/\/127\.0\.0\.1:9\/ after 400ms/);
  }, 15000);
});
