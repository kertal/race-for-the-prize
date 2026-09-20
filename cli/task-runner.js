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
import { isPathInside } from './paths.js';
import { c } from './colors.js';
import { startProgress } from './animation.js';
import { varsToEnv } from './config.js';

// How long to wait after a script exits for its stdio pipes to drain before
// settling anyway (see the 'exit' handler in runScript).
const PIPE_DRAIN_GRACE_MS = 100;

// How long a timed-out script gets between SIGTERM and SIGKILL.
const SIGKILL_GRACE_MS = 5000;

// How much of a script's stderr to keep for its failure report. The tail is
// the end a failure is diagnosed from.
const STDERR_LIMIT = 64 * 1024;

/**
 * The script's stderr, kept for the failure report — bounded at both ends.
 *
 * It holds only the last `limit` bytes, and stops accepting once closed. The
 * pipes outlive the script: a `waitFor` service inherits them and keeps
 * logging for as long as it runs, so without closing, a buffer nobody will
 * ever read would grow for the whole life of that service.
 *
 * @param {number} [limit]
 * @returns {{append: (chunk: *) => void, close: () => void, text: string}}
 */
export function createStderrBuffer(limit = STDERR_LIMIT) {
  let text = '';
  let dropped = false;
  let open = true;
  return {
    append(chunk) {
      if (!open) return;
      text += chunk;
      if (text.length > limit) {
        text = text.slice(-limit);
        dropped = true;
      }
    },
    close() { open = false; },
    get text() {
      return dropped && text ? `…(earlier output dropped)\n${text}` : text;
    },
  };
}

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

  // Security: ensure the resolved path stays within the race directory. Shared
  // with the static server so both confine the same way — notably a raceDir
  // with a trailing separator, or the filesystem root, still accepts its own
  // children.
  if (!isPathInside(raceDir, scriptPath)) {
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

    const stderr = createStderrBuffer();
    let timedOut = false;
    let exited = false;
    let settled = false;
    let sigkillTimeoutId = null;
    let drainTimeoutId = null;

    child.stdout.on('data', d => { if (verbose) process.stdout.write(d); });
    // Keep draining after settlement, so a service that inherited these pipes
    // is never blocked by a full buffer; the buffer itself closes below.
    child.stderr.on('data', d => {
      stderr.append(d);
      if (verbose) process.stderr.write(d);
    });

    // Lets go of the stdio pipes a background descendant inherited, so they
    // cannot keep this process alive once the script itself is done with.
    // Safe to repeat: unref on an already-unref'd or closed stream is a no-op.
    const releasePipes = () => { child.stdout.unref(); child.stderr.unref(); };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      if (exited) {
        // The script is long gone: only something it left behind, still
        // holding its output pipes, is keeping us here. Nothing to kill.
        onExit(child.exitCode, child.signalCode);
        return;
      }
      child.kill('SIGTERM');
      // Give the script 5s to clean up after SIGTERM, then SIGKILL — and
      // settle either way. A script that ignores both would otherwise leave
      // this promise pending for good.
      sigkillTimeoutId = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
        onExit(child.exitCode, child.signalCode);
      }, SIGKILL_GRACE_MS);
    }, timeout);

    // A script settles on 'close': it has exited and its stdio pipes have
    // drained, so background work it started (a copy still writing race
    // fixtures, say) has finished too. A script that declares `waitFor` is
    // different — it starts a service and leaves it running, and that service
    // holds the inherited pipes for as long as it lives, so 'close' would come
    // only when it dies. Its readiness is the URL, not the pipes: it settles
    // on 'exit', after a short grace for its own output to drain.
    // Once the timeout has fired, nothing this script left behind is work
    // worth waiting for either, so it stops waiting for `close` too.
    const settleOnExit = Boolean(waitFor);
    child.on('exit', (code, signal) => {
      exited = true;
      if (!settleOnExit && !timedOut) return;
      drainTimeoutId = setTimeout(() => onExit(code, signal), PIPE_DRAIN_GRACE_MS);
    });
    child.on('close', (code, signal) => {
      clearTimeout(drainTimeoutId);
      onExit(code, signal);
    });

    function onExit(code, signal) {
      clearTimeout(timeoutId);
      if (sigkillTimeoutId) clearTimeout(sigkillTimeoutId);
      if (settled) return;
      settled = true;
      // Whatever still holds these pipes is no longer this script's business:
      // stop buffering it, and stop letting it keep the CLI alive. Every
      // settlement path comes through here, so the release cannot be missed.
      stderr.close();
      releasePipes();

      if (timedOut) {
        progress.done(`${label} timed out after ${timeout}ms`);
        if (code !== null) {
          // Exited on its own (with `code`) but its output never closed.
          reject(new Error(
            `${label} script exited with code ${code} but something it started is still holding its output ` +
            `${timeout}ms later. For a background service, add "waitFor" to the ${label.toLowerCase()} config ` +
            `so readiness is checked by URL; otherwise redirect that process's output (> /dev/null 2>&1).`
          ));
          return;
        }
        reject(new Error(`${label} script timed out after ${timeout}ms`));
        return;
      }

      // Handle process killed by signal (code is null)
      if (code === null && signal) {
        progress.done(`${label} killed by ${signal}`);
        if (stderr.text) console.error(`${c.dim}${stderr.text}${c.reset}`);
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
        if (stderr.text) console.error(`${c.dim}${stderr.text}${c.reset}`);
        reject(new Error(`${label} script exited with code ${code}`));
      }
    }

    child.on('error', err => {
      clearTimeout(timeoutId);
      if (sigkillTimeoutId) clearTimeout(sigkillTimeoutId);
      if (drainTimeoutId) clearTimeout(drainTimeoutId);
      if (settled) return;
      settled = true;
      stderr.close();
      releasePipes();
      progress.done(`${label} error: ${err.message}`);
      reject(err);
    });
  });
}
