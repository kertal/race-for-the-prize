/**
 * race-loader.js — race directory loading for the CLI.
 *
 * Discovers racer scripts in a race directory, loads and validates
 * settings.json (including the security validation of per-racer `script`
 * overrides), and builds the race context via the injected `buildContext`.
 *
 * These functions print user-facing errors and call process.exit, matching
 * the CLI's historical behavior; tests stub process.exit to observe them.
 */

import fs from 'fs';
import path from 'path';
import { c } from './colors.js';
import { applyOverrides, applyDefaults, discoverRacers, resolveSharedRacerNames, InvalidSettingError } from './config.js';

/**
 * Apply CLI overrides + defaults, exiting with code 2 on user-visible
 * InvalidSettingError. Anything else rethrows. Used by both directory mode
 * and URL mode so the error-handling stays in one place.
 */
export function applySettingsOrExit(base, boolFlags, kvFlags) {
  try {
    return applyDefaults(applyOverrides(base, boolFlags, kvFlags));
  } catch (e) {
    if (e instanceof InvalidSettingError) {
      console.error(`${c.red}Error: ${e.message}${c.reset}`);
      process.exit(2);
    }
    throw e;
  }
}

/**
 * Load race config for a given directory: discovers racers, loads settings,
 * builds the race context.
 *
 * @param {string} raceDir - absolute path to the race directory
 * @param {object} options
 * @param {Set<string>} options.boolFlags - parsed CLI boolean flags
 * @param {object} options.kvFlags - parsed CLI key=value flags
 * @param {string} options.rootDir - repo root (where runner.cjs lives)
 * @param {function} options.buildContext - buildRaceContext from race.js
 * @returns {{ ctx: object, settings: object, racerNames: string[] }}
 */
export function loadRaceDir(raceDir, { boolFlags, kvFlags, rootDir, buildContext }) {
  if (!fs.existsSync(raceDir)) {
    console.error(`${c.red}Error: Race directory not found: ${raceDir}${c.reset}`);
    process.exit(1);
  }

  let settings = {};
  const settingsPath = path.join(raceDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (e) {
      console.error(`${c.red}Error: Could not parse settings.json: ${e.message}${c.reset}`);
      console.error(`${c.dim}  File: ${settingsPath}${c.reset}`);
      process.exit(1);
    }
  }
  settings = applySettingsOrExit(settings, boolFlags, kvFlags);

  const allFiles = fs.readdirSync(raceDir).filter(f => !f.startsWith('.'));
  const specFiles = allFiles.filter(f => f.endsWith('.spec.js')).sort();
  const hasSharedSpecFile = specFiles.length === 1 && specFiles[0] === 'race.spec.js';
  const hasRacersConfig = settings.racers !== undefined;
  const hookPattern = /\.(setup|teardown)\.js$/;
  const candidateRacerJsFiles = allFiles
    .filter(f => f.endsWith('.js') && !f.endsWith('.spec.js') && !hookPattern.test(f) && f !== 'setup.js' && f !== 'teardown.js')
    .sort();
  const sharedSpecConfiguredRacerNames = hasSharedSpecFile && hasRacersConfig
    ? Object.keys(settings.racers || {})
    : [];
  const conflictingSharedSpecRacerJsFiles = hasSharedSpecFile && hasRacersConfig
    ? candidateRacerJsFiles.filter(f => sharedSpecConfiguredRacerNames.includes(path.basename(f, '.js')))
    : [];
  const hasOnlySharedSpec = hasSharedSpecFile && hasRacersConfig && conflictingSharedSpecRacerJsFiles.length === 0;

  if (hasSharedSpecFile && hasRacersConfig && conflictingSharedSpecRacerJsFiles.length > 0) {
    console.error(
      `${c.red}Error: Ambiguous race directory: found race.spec.js and racer script(s) matching settings.racers: ${conflictingSharedSpecRacerJsFiles.join(', ')}.${c.reset}`
    );
    console.error(
      `${c.dim}  Remove matching racer scripts to use shared-spec mode, or remove settings.racers to use file-based discovery.${c.reset}`
    );
    process.exit(1);
  }

  let racerNames;
  let effectiveRacerFiles;
  let scriptFiles;

  if (hasOnlySharedSpec && hasRacersConfig) {
    try {
      racerNames = resolveSharedRacerNames(settings);
    } catch (e) {
      if (e instanceof InvalidSettingError) {
        console.error(`${c.red}Error: ${e.message}${c.reset}`);
        process.exit(2);
      }
      throw e;
    }

    for (const name of racerNames) {
      if (Object.prototype.hasOwnProperty.call(settings.racers?.[name] || {}, 'script')) {
        console.error(`${c.red}Error: shared-spec mode does not support settings.racers.${name}.script; use race.spec.js for all racers${c.reset}`);
        process.exit(1);
      }
    }

    // Keep physical race files deduplicated for asset copy and player links.
    effectiveRacerFiles = ['race.spec.js'];
    // Runner still needs one script payload per racer.
    scriptFiles = racerNames.map(() => 'race.spec.js');
  } else {
    const { racerFiles, racerNames: discoveredNames, totalFound, dropped } = discoverRacers(raceDir);
    if (racerFiles.length < 2) {
      console.error(`${c.red}Error: Need at least 2 .spec.js (or .js) script files in ${raceDir}, found ${racerFiles.length}${c.reset}`);
      process.exit(1);
    }
    if (totalFound > 5) {
      console.error(`${c.yellow}Warning: Found ${totalFound} script files, using first five: ${racerFiles.join(', ')}${c.reset}`);
      console.error(`${c.dim}  Skipped: ${dropped.join(', ')}${c.reset}`);
    }

    racerNames = discoveredNames;

    // Compute effective racer files (may be overridden by settings.racers[name].script).
    // Security: restrict to a basename within raceDir; no separators, no parent traversal.
    effectiveRacerFiles = racerFiles.map((f, i) => {
      const name = racerNames[i];
      const script = settings.racers?.[name]?.script;
      // Only an absent setting falls back to the discovered file: a supplied
      // but falsy value ("" / false / 0) must reach the validation below
      // instead of being silently ignored.
      if (script === undefined) return f;
      const fail = (reason) => {
        console.error(`${c.red}Error: settings.racers.${name}.script ${reason}${c.reset}`);
        process.exit(1);
      };
      if (typeof script !== 'string' || script.trim() === '') fail('must be a non-empty string');
      if (path.basename(script) !== script || script.includes('..') || path.isAbsolute(script)) {
        fail(`must be a filename (no path separators): ${script}`);
      }
      const scriptPath = path.join(raceDir, script);
      let stat;
      try {
        // `script` is validated just above: basename only, no '..', not
        // absolute, so scriptPath cannot leave raceDir.
        stat = fs.lstatSync(scriptPath);
      } catch {
        fail(`not found: ${script}`);
      }
      // Reject symlinks and directories up front — readFileSync would fail later
      // with a less specific error, and symlinks could point outside raceDir.
      if (!stat.isFile()) {
        fail(`must be a regular file (symlinks and directories are not allowed): ${script}`);
      }
      return script;
    });
    scriptFiles = effectiveRacerFiles;
  }

  // `f` is either a filename discovered by readdir inside raceDir or a settings
  // override already validated as a basename (see the checks above), so the join
  // cannot leave the race directory the user named on the CLI.
  const scripts = scriptFiles.map(f => fs.readFileSync(path.join(raceDir, f), 'utf-8'));

  const ctx = buildContext({ racerNames, scripts, settings, rootDir, raceDir, racerFiles: effectiveRacerFiles });
  return { ctx, settings, racerNames };
}
