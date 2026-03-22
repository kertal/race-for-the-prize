import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { discoverSetupTeardown, discoverRacerSetupTeardown } from '../cli/config.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-teardown-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Helper to write an executable shell script and run it */
async function runShellScript(scriptPath, content, options = {}) {
  fs.writeFileSync(scriptPath, content, { mode: 0o755 });

  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath], {
      cwd: options.cwd || path.dirname(scriptPath),
      env: options.env || process.env,
    });
    child.on('close', code => {
      if (options.expectFailure) {
        resolve(code);
      } else if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Exit code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

/** Helper to write and run a Node.js script */
async function runNodeScript(scriptPath, content, options = {}) {
  fs.writeFileSync(scriptPath, content, { mode: 0o644 });

  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      cwd: options.cwd || path.dirname(scriptPath),
      env: options.env || process.env,
    });
    child.on('close', code => {
      if (options.expectFailure) {
        resolve(code);
      } else if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Exit code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

describe('setup/teardown discovery edge cases', () => {
  it('handles race directory with only setup (no teardown)', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash\necho "setup"');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup, teardown } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe('setup.sh');
    expect(teardown).toBe(null);
  });

  it('handles race directory with only teardown (no setup)', () => {
    fs.writeFileSync(path.join(tmpDir, 'teardown.js'), 'console.log("teardown")');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup, teardown } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe(null);
    expect(teardown).toBe('teardown.js');
  });

  it('handles empty settings object', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup } = discoverSetupTeardown(tmpDir, {});
    expect(setup).toBe('setup.sh');
  });

  it('settings can set setup to empty string to disable', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    // Empty string is falsy but not undefined, so it should override
    const { setup } = discoverSetupTeardown(tmpDir, { setup: '' });
    expect(setup).toBe('');
  });

  it('settings can set setup to false to disable', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup } = discoverSetupTeardown(tmpDir, { setup: false });
    expect(setup).toBe(false);
  });

  it('handles complex command object in settings', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const settings = {
      setup: {
        command: './custom-setup.sh',
        timeout: 120000,
        waitFor: {
          url: 'http://localhost:3000/health',
          timeout: 60000,
          interval: 500,
        },
      },
    };

    const { setup } = discoverSetupTeardown(tmpDir, settings);
    expect(setup).toEqual(settings.setup);
  });

  it('does not discover scripts with wrong extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.py'), 'print("setup")');
    fs.writeFileSync(path.join(tmpDir, 'teardown.ts'), 'console.log("teardown")');
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    const { setup, teardown } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe(null);
    expect(teardown).toBe(null);
  });

  it('handles directories named setup.sh (should not match)', () => {
    fs.mkdirSync(path.join(tmpDir, 'setup.sh'));
    fs.writeFileSync(path.join(tmpDir, 'a.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.spec.js'), '');

    // Directories are correctly filtered out by isFile() check
    const { setup } = discoverSetupTeardown(tmpDir);
    expect(setup).toBe(null);
  });
});

describe('per-racer setup/teardown discovery edge cases', () => {
  it('handles racer names with hyphens', () => {
    fs.writeFileSync(path.join(tmpDir, 'my-app-v1.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'my-app-v1.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'my-app-v2.spec.js'), '');

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'my-app-v1');
    expect(setup).toBe('my-app-v1.setup.sh');
  });

  it('handles racer names with dots', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.v1.0.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'app.v1.0.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'app.v2.0.spec.js'), '');

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'app.v1.0');
    expect(setup).toBe('app.v1.0.setup.sh');
  });

  it('handles racer names with underscores', () => {
    fs.writeFileSync(path.join(tmpDir, 'my_app.setup.js'), 'console.log("setup")');
    fs.writeFileSync(path.join(tmpDir, 'my_app.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'other_app.spec.js'), '');

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'my_app');
    expect(setup).toBe('my_app.setup.js');
  });

  it('multiple racers can have independent setup/teardown', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.setup.sh'), '#!/bin/bash\necho "alpha"');
    fs.writeFileSync(path.join(tmpDir, 'alpha.teardown.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'beta.setup.js'), 'console.log("beta")');
    fs.writeFileSync(path.join(tmpDir, 'beta.teardown.js'), 'console.log("teardown")');
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const alpha = discoverRacerSetupTeardown(tmpDir, 'alpha');
    const beta = discoverRacerSetupTeardown(tmpDir, 'beta');

    expect(alpha.setup).toBe('alpha.setup.sh');
    expect(alpha.teardown).toBe('alpha.teardown.sh');
    expect(beta.setup).toBe('beta.setup.js');
    expect(beta.teardown).toBe('beta.teardown.js');
  });

  it('settings.racers for one racer does not affect another', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'beta.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const settings = {
      racers: {
        alpha: { setup: './custom-alpha.sh' },
      },
    };

    const alpha = discoverRacerSetupTeardown(tmpDir, 'alpha', settings);
    const beta = discoverRacerSetupTeardown(tmpDir, 'beta', settings);

    expect(alpha.setup).toBe('./custom-alpha.sh');
    expect(beta.setup).toBe('beta.setup.sh'); // Uses convention, not affected by alpha's settings
  });

  it('handles missing racers key in settings', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const settings = { parallel: true, network: 'slow-3g' }; // No racers key

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'alpha', settings);
    expect(setup).toBe('alpha.setup.sh');
  });

  it('handles empty racers object in settings', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const settings = { racers: {} };

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'alpha', settings);
    expect(setup).toBe('alpha.setup.sh');
  });

  it('handles racer not in settings.racers', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.setup.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const settings = {
      racers: {
        gamma: { setup: './gamma-setup.sh' }, // Different racer
      },
    };

    const { setup } = discoverRacerSetupTeardown(tmpDir, 'alpha', settings);
    expect(setup).toBe('alpha.setup.sh');
  });
});

describe('combined global and per-racer discovery', () => {
  it('global and per-racer scripts are discovered independently', () => {
    fs.writeFileSync(path.join(tmpDir, 'setup.sh'), '#!/bin/bash\necho "global"');
    fs.writeFileSync(path.join(tmpDir, 'teardown.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'alpha.setup.sh'), '#!/bin/bash\necho "alpha"');
    fs.writeFileSync(path.join(tmpDir, 'beta.teardown.sh'), '#!/bin/bash');
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const global = discoverSetupTeardown(tmpDir);
    const alpha = discoverRacerSetupTeardown(tmpDir, 'alpha');
    const beta = discoverRacerSetupTeardown(tmpDir, 'beta');

    expect(global.setup).toBe('setup.sh');
    expect(global.teardown).toBe('teardown.sh');
    expect(alpha.setup).toBe('alpha.setup.sh');
    expect(alpha.teardown).toBe(null);
    expect(beta.setup).toBe(null);
    expect(beta.teardown).toBe('beta.teardown.sh');
  });

  it('settings can configure both global and per-racer', () => {
    fs.writeFileSync(path.join(tmpDir, 'alpha.spec.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'beta.spec.js'), '');

    const settings = {
      setup: './global-setup.sh',
      teardown: { command: './global-teardown.sh', timeout: 30000 },
      racers: {
        alpha: {
          setup: { command: './alpha-setup.sh', timeout: 10000 },
          teardown: './alpha-teardown.sh',
        },
        beta: {
          setup: './beta-setup.sh',
        },
      },
    };

    const global = discoverSetupTeardown(tmpDir, settings);
    const alpha = discoverRacerSetupTeardown(tmpDir, 'alpha', settings);
    const beta = discoverRacerSetupTeardown(tmpDir, 'beta', settings);

    expect(global.setup).toBe('./global-setup.sh');
    expect(global.teardown).toEqual({ command: './global-teardown.sh', timeout: 30000 });
    expect(alpha.setup).toEqual({ command: './alpha-setup.sh', timeout: 10000 });
    expect(alpha.teardown).toBe('./alpha-teardown.sh');
    expect(beta.setup).toBe('./beta-setup.sh');
    expect(beta.teardown).toBe(null);
  });
});

describe('script execution integration', () => {
  it('shell script can write to file system', async () => {
    const markerFile = path.join(tmpDir, 'marker.txt');
    const setupScript = path.join(tmpDir, 'setup.sh');

    await runShellScript(setupScript, `#!/bin/bash\necho "executed" > "${markerFile}"`);

    expect(fs.existsSync(markerFile)).toBe(true);
    expect(fs.readFileSync(markerFile, 'utf-8').trim()).toBe('executed');
  });

  it('node script can write to file system', async () => {
    const markerFile = path.join(tmpDir, 'marker.txt');
    const setupScript = path.join(tmpDir, 'setup.js');

    await runNodeScript(setupScript, `
      const fs = require('fs');
      fs.writeFileSync('${markerFile.replace(/\\/g, '\\\\')}', 'executed');
    `);

    expect(fs.existsSync(markerFile)).toBe(true);
    expect(fs.readFileSync(markerFile, 'utf-8').trim()).toBe('executed');
  });

  it('script receives RACE_DIR environment variable', async () => {
    const markerFile = path.join(tmpDir, 'env-marker.txt');
    const setupScript = path.join(tmpDir, 'setup.sh');

    await runShellScript(
      setupScript,
      `#!/bin/bash\necho "$RACE_DIR" > "${markerFile}"`,
      { env: { ...process.env, RACE_DIR: tmpDir } }
    );

    expect(fs.readFileSync(markerFile, 'utf-8').trim()).toBe(tmpDir);
  });

  it('failing script returns non-zero exit code', async () => {
    const setupScript = path.join(tmpDir, 'setup.sh');

    const exitCode = await runShellScript(setupScript, '#!/bin/bash\nexit 1', { expectFailure: true });

    expect(exitCode).toBe(1);
  });

  it('scripts run in correct working directory', async () => {
    const markerFile = path.join(tmpDir, 'cwd-marker.txt');
    const setupScript = path.join(tmpDir, 'setup.sh');

    await runShellScript(setupScript, `#!/bin/bash\npwd > "${markerFile}"`);

    // Use realpath to handle macOS /var -> /private/var symlink
    expect(fs.readFileSync(markerFile, 'utf-8').trim()).toBe(fs.realpathSync(tmpDir));
  });
});

describe('execution order verification', () => {
  it('setup scripts run and complete before main process continues', async () => {
    const logFile = path.join(tmpDir, 'order.log');
    const setupScript = path.join(tmpDir, 'setup.sh');

    // Setup writes "setup" then sleeps briefly
    await runShellScript(setupScript, `#!/bin/bash
echo "setup-start" >> "${logFile}"
sleep 0.1
echo "setup-end" >> "${logFile}"
`);

    // Write "main" after setup completes
    fs.appendFileSync(logFile, 'main\n');

    const log = fs.readFileSync(logFile, 'utf-8');
    const lines = log.trim().split('\n');

    expect(lines).toEqual(['setup-start', 'setup-end', 'main']);
  });

  it('multiple scripts run in sequence', async () => {
    const logFile = path.join(tmpDir, 'order.log');
    const script1 = path.join(tmpDir, 'script1.sh');
    const script2 = path.join(tmpDir, 'script2.sh');

    // Run scripts in sequence using helper
    await runShellScript(script1, `#!/bin/bash\necho "script1" >> "${logFile}"`);
    await runShellScript(script2, `#!/bin/bash\necho "script2" >> "${logFile}"`);

    const log = fs.readFileSync(logFile, 'utf-8');
    const lines = log.trim().split('\n');

    expect(lines).toEqual(['script1', 'script2']);
  });
});
