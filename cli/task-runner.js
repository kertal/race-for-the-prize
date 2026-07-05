/**
 * task-runner.js — setup/teardown script execution for the CLI.
 *
 * Runs shell (.sh) or Node (.js) scripts confined to the race directory,
 * with a timeout that escalates SIGTERM → SIGKILL and an optional HTTP
 * `waitFor` poller for service-readiness checks.
 */

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { c } from './colors.js';
import { startProgress } from './animation.js';
import { varsToEnv } from './config.js';

/**
 * Run a setup or teardown script.
 * Supports both shell scripts (.sh) and Node.js scripts (.js).
 * Can be a string (script path) or object { command, timeout, waitFor }.
 *
 * @param {string|object} script - Script path or config object
 * @param {string} label - Label for logging ('Setup' or 'Teardown')
 * @param {object|undefined} vars - Per-racer vars exposed to the script as RACE_VAR_* env vars
 * @param {object} options
 * @param {string} options.raceDir - race directory scripts are confined to (also cwd for the child)
 * @param {boolean} [options.verbose] - stream child stdout/stderr to the terminal
 * @returns {Promise<void>}
 */
export async function runScript(script, label, vars, { raceDir, verbose = false }) {
  if (!script) return;

  const config = typeof script === 'string' ? { command: script } : script;
  const { command, timeout = 300000, waitFor } = config;

  // Validate command is a non-empty string
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error(`${label} script config missing valid 'command' field`);
  }

  // Validate timeout bounds
  if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) {
    throw new Error(`${label} timeout must be a positive number`);
  }

  const scriptPath = path.resolve(raceDir, command);
  const ext = path.extname(scriptPath);

  // Security: ensure resolved path stays within the race directory
  const normalizedScript = path.normalize(scriptPath);
  const normalizedRaceDir = path.normalize(raceDir);
  if (!normalizedScript.startsWith(normalizedRaceDir + path.sep) && normalizedScript !== normalizedRaceDir) {
    throw new Error(`${label} script path must be within race directory: ${command}`);
  }

  // Validate script exists and is a regular file (not a directory or symlink)
  let stat;
  try {
    stat = fs.lstatSync(scriptPath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(`${c.yellow}Warning: ${label} script not found: ${scriptPath}${c.reset}`);
      return;
    }
    throw e;
  }

  // lstatSync returns stats for the link itself; isFile() is false for symlinks and directories
  if (!stat.isFile()) {
    throw new Error(`${label} script path is not a regular file: ${scriptPath}`);
  }

  if (ext !== '.sh' && ext !== '.js') {
    throw new Error(`${label} script has unsupported extension '${ext}' (expected .sh or .js)`);
  }

  // On Windows, warn if trying to run .sh without bash available
  if (ext === '.sh' && process.platform === 'win32') {
    try {
      execSync('bash --version', { stdio: 'ignore' }); // NOSONAR — bash resolved via PATH is intentional
    } catch {
      throw new Error(
        `${label} script '${command}' requires bash, which was not found. ` +
        `Install Git Bash or WSL, or use a .js script instead.`
      );
    }
  }

  const progress = startProgress(`Running ${label.toLowerCase()}…`);

  return new Promise((resolve, reject) => {
    const isShell = ext === '.sh';
    const args = [scriptPath];
    const cmd = isShell ? 'bash' : 'node';

    const child = spawn(cmd, args, {
      cwd: raceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RACE_DIR: raceDir, ...varsToEnv(vars) },
    });

    let stderr = '';
    let timedOut = false;
    let settled = false;
    let sigkillTimeoutId = null;

    child.stdout.on('data', d => { if (verbose) process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; if (verbose) process.stderr.write(d); });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Give process 5s to clean up after SIGTERM, then SIGKILL
      sigkillTimeoutId = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5000);
    }, timeout);

    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      if (sigkillTimeoutId) clearTimeout(sigkillTimeoutId);
      if (settled) return;
      settled = true;

      if (timedOut) {
        progress.done(`${label} timed out after ${timeout}ms`);
        reject(new Error(`${label} script timed out after ${timeout}ms`));
        return;
      }

      // Handle process killed by signal (code is null)
      if (code === null && signal) {
        progress.done(`${label} killed by ${signal}`);
        if (stderr) console.error(`${c.dim}${stderr}${c.reset}`);
        reject(new Error(`${label} script was killed by ${signal}`));
        return;
      }

      if (code === 0) {
        progress.done(`${label} completed`);

        // If waitFor is specified, poll for the condition
        if (waitFor) {
          if (typeof waitFor !== 'object' || Array.isArray(waitFor)) {
            reject(new Error(`${label} waitFor must be an object with a 'url' field`));
            return;
          }
          if (typeof waitFor.url !== 'string' || !waitFor.url.trim()) {
            reject(new Error(`${label} waitFor.url must be a non-empty string`));
            return;
          }
          if (waitFor.timeout !== undefined && (!Number.isFinite(waitFor.timeout) || waitFor.timeout <= 0)) {
            reject(new Error(`${label} waitFor.timeout must be a positive number`));
            return;
          }
          if (waitFor.interval !== undefined && (!Number.isFinite(waitFor.interval) || waitFor.interval <= 0)) {
            reject(new Error(`${label} waitFor.interval must be a positive number`));
            return;
          }
          const { url, timeout: waitTimeout = 30000, interval = 1000 } = waitFor;
          if (url) {
            const waitProgress = startProgress(`Waiting for ${url}…`);
            const startTime = Date.now();
            let waitSettled = false;

            const poll = async () => {
              if (waitSettled) return;
              const remaining = waitTimeout - (Date.now() - startTime);
              if (remaining <= 0) {
                if (waitSettled) return;
                waitSettled = true;
                waitProgress.done(`Timeout waiting for ${url}`);
                reject(new Error(`Timeout waiting for ${url} after ${waitTimeout}ms`));
                return;
              }

              try {
                const res = await fetch(url, {
                  signal: AbortSignal.timeout(Math.min(remaining, interval * 2)),
                });
                if (res.ok) {
                  if (waitSettled) return;
                  waitSettled = true;
                  waitProgress.done(`Service ready at ${url}`);
                  resolve();
                  return;
                }
              } catch {
                // Connection failed or timed out, will retry
              }

              if (!waitSettled) setTimeout(poll, interval);
            };
            poll();
            return;
          }
        }

        resolve();
      } else {
        progress.done(`${label} failed (exit code ${code})`);
        if (stderr) console.error(`${c.dim}${stderr}${c.reset}`);
        reject(new Error(`${label} script exited with code ${code}`));
      }
    });

    child.on('error', err => {
      clearTimeout(timeoutId);
      if (sigkillTimeoutId) clearTimeout(sigkillTimeoutId);
      if (settled) return;
      settled = true;
      progress.done(`${label} error: ${err.message}`);
      reject(err);
    });
  });
}
