/**
 * help.js — the terminal help screen.
 *
 * RaceForThePrize is published to npm with a `race-for-the-prize` bin, so the
 * command a reader should copy depends on how they started it: a global
 * install types the bare binary, a project dependency (or a one-off run) goes
 * through `npx`, and a git checkout still runs `node race.js`. `resolveInvocation`
 * works that out from argv, and `buildHelp` renders every example with it so
 * the help never tells anyone to run a file they don't have.
 */

import path from 'path';
import { createRequire } from 'module';
import { c } from './colors.js';
import { listSkins } from './skins.js';

/** The command name the package installs (`bin` in package.json). */
export const CLI_NAME = 'race-for-the-prize';

/** The published version, straight from package.json, for `--version`. */
export function packageVersion() {
  return createRequire(import.meta.url)('../package.json').version;
}

/**
 * Work out how this process was started, and therefore how its help should
 * spell the command.
 *
 * @param {string} [argv1] - process.argv[1] (the script or bin shim path)
 * @returns {string} the command to put in front of every example
 */
export function resolveInvocation(argv1 = process.argv[1]) {
  const local = 'node race.js';
  if (!argv1) return local;

  const posix = String(argv1).replace(/\\/g, '/');
  const base = path.posix.basename(posix).replace(/\.(js|cjs|mjs|cmd|ps1)$/, '');

  // `npx race-for-the-prize` stages the package in a cache dir; the shim is
  // gone once the command finishes, so npx is the only way to run it again.
  if (posix.includes('/_npx/')) return `npx ${CLI_NAME}`;
  // A project dependency: reachable through npx (or package.json scripts).
  if (posix.includes('/node_modules/')) return `npx ${CLI_NAME}`;
  // A global install puts the bin on PATH under its own name.
  if (base === CLI_NAME) return CLI_NAME;

  return local;
}

/**
 * Render the help screen.
 *
 * @param {string} [cmd] - command prefix for every example
 * @param {string[]} [skins] - built-in skin names
 * @returns {string} the full help text, ANSI-colored
 */
export function buildHelp(cmd = resolveInvocation(), skins = listSkins()) {
  const run = cmd || 'node race.js';
  const rule = `${c.dim}  ─────────────────────────────────────────────────────────────${c.reset}`;

  return `
${c.yellow}    ____                   ____              _   _            ____       _          ${c.reset}
${c.yellow}   / __ \\____ _________   / __/___  _____   / |_/ /_  ___   / __ \\_____(_)_______   ${c.reset}
${c.yellow}  / /_/ / __ \`/ ___/ _ \\ / /_/ __ \\/ ___/  / __/ __ \\/ _ \\ / /_/ / ___/ / ___/ _ \\  ${c.reset}
${c.yellow} / _, _/ /_/ / /__/  __// __/ /_/ / /     / /_/ / / /  __// ____/ /  / / /__/  __/  ${c.reset}
${c.yellow}/_/ |_|\\__,_/\\___/\\___//_/  \\____/_/      \\__/_/ /_/\\___//_/   /_/  /_/\\___/\\___/   ${c.reset}

${c.dim}  Race two browsers. Measure everything. Crown a winner.  🏎️ 💨${c.reset}

${c.bold}  Usage:${c.reset}
${rule}
  ${c.cyan}${run}${c.reset} ${c.cyan}<url> <url> [url...]${c.reset}   Race page loads head-to-head (2–5 URLs)
  ${c.cyan}${run}${c.reset} ${c.magenta}demo:${c.cyan}<name>${c.reset}            Race one of the demos shipped with the CLI
  ${c.cyan}${run}${c.reset} ${c.yellow}--init${c.reset} ${c.cyan}[dir]${c.reset}           Scaffold a race directory (default: my-race/)
  ${c.cyan}${run}${c.reset} ${c.cyan}<dir>${c.reset} ${c.yellow}[flags]${c.reset}          Run a scripted race

${c.bold}  Install:${c.reset}
${rule}
  ${c.bold}$${c.reset} ${c.cyan}npx ${CLI_NAME}@latest${c.reset} ${c.cyan}https://react.dev https://angular.dev${c.reset}
    ${c.dim}One-off run — nothing to install, nothing left behind.${c.reset}

  ${c.bold}$${c.reset} ${c.cyan}npm install -g ${CLI_NAME}${c.reset}
    ${c.dim}Then race from anywhere:  ${CLI_NAME} <dir>${c.reset}

  ${c.bold}$${c.reset} ${c.cyan}npm install -D ${CLI_NAME}${c.reset}
    ${c.dim}Keep races in your repo:  npx ${CLI_NAME} <dir>${c.reset}

  ${c.dim}Installing downloads Chromium. If it is missing, fetch it with:${c.reset}
  ${c.bold}$${c.reset} ${c.cyan}npx playwright install chromium${c.reset}

${c.bold}  Quick Race (URL mode):${c.reset}
${rule}
  Pass 2+ URLs and RaceForThePrize writes the specs for you:

     ${c.bold}$${c.reset} ${c.cyan}${run} https://react.dev https://angular.dev${c.reset}

${c.bold}  Demo Races:${c.reset}
${rule}
  No race of your own yet? Race one that ships with the CLI:

     ${c.bold}$${c.reset} ${c.cyan}${run} ${c.magenta}demo:${c.cyan}lauda-vs-hunt${c.reset}   ${c.dim}# ${run} demo — to list them all${c.reset}

  ${c.dim}The demo is copied to ./races/<name>/ first — it asks before writing,${c.reset}
  ${c.dim}and --yes skips the question. Edit the copy and race it again.${c.reset}

${c.bold}  Scripted Race:${c.reset}
${rule}
  ${c.bold}1.${c.reset} Scaffold a race directory, then edit the specs:

     ${c.bold}$${c.reset} ${c.cyan}${run} --init my-race${c.reset}

     ${c.cyan}my-race/${c.reset}
       ${c.green}racer-a.spec.js${c.reset}      ${c.dim}# Multi-spec mode: one file per racer${c.reset}
       ${c.blue}racer-b.spec.js${c.reset}      ${c.dim}# Racer 2${c.reset}
       ${c.dim}OR${c.reset}
       ${c.green}race.spec.js${c.reset}         ${c.dim}# Shared-spec mode: one file for all racers${c.reset}
       ${c.dim}settings.json${c.reset}        ${c.dim}# shared mode racers + optional race settings${c.reset}
       ${c.dim}setup.sh${c.reset}             ${c.dim}# Optional: global setup before race${c.reset}
       ${c.dim}teardown.sh${c.reset}          ${c.dim}# Optional: global teardown after race${c.reset}
       ${c.dim}racer-a.setup.sh${c.reset}     ${c.dim}# Optional: per-racer setup (runs before this racer)${c.reset}
       ${c.dim}racer-a.teardown.sh${c.reset}  ${c.dim}# Optional: per-racer teardown${c.reset}

  ${c.bold}2.${c.reset} Each script gets a Playwright ${c.cyan}page${c.reset} with race helpers:

     ${c.dim}await${c.reset} page.goto(${c.green}'https://...'${c.reset});
     ${c.dim}await${c.reset} page.raceRecordingStart();       ${c.dim}// optional: start video segment${c.reset}
     ${c.dim}await${c.reset} page.raceStart(${c.green}'Load Time'${c.reset});     ${c.dim}// start measurement${c.reset}
     ${c.dim}await${c.reset} page.click(${c.green}'.button'${c.reset});
     ${c.dim}await${c.reset} page.waitForSelector(${c.green}'.result'${c.reset});
     page.raceEnd(${c.green}'Load Time'${c.reset});             ${c.dim}// end measurement (sync)${c.reset}
     page.raceMessage(${c.green}'I win!'${c.reset});            ${c.dim}// send message to CLI${c.reset}
     ${c.dim}await${c.reset} page.raceRecordingEnd();         ${c.dim}// optional: end video segment${c.reset}
     race.name                              ${c.dim}// this racer's name${c.reset}
     race.vars                              ${c.dim}// per-racer vars from settings.json${c.reset}

     ${c.dim}If raceRecordingStart/End are omitted, recording wraps raceStart to raceEnd.${c.reset}

  ${c.bold}3.${c.reset} Run it!

     ${c.bold}$${c.reset} ${c.cyan}${run} ./my-race${c.reset}

${c.bold}  Flags:${c.reset}
${rule}
  ${c.yellow}--results${c.reset}              View recent results for a race directory
  ${c.yellow}--parallel${c.reset}             Run all browsers simultaneously
  ${c.yellow}--headless${c.reset}             Hide browsers
  ${c.yellow}--network${c.reset}=${c.green}slow-3g${c.reset}      Network: none, slow-3g, fast-3g, 4g
  ${c.yellow}--network${c.reset}=${c.green}slow-3g,4g${c.reset}   Race each network condition separately
  ${c.yellow}--cpu${c.reset}=${c.green}4${c.reset}                CPU slowdown: 4x slower (1=none)
  ${c.yellow}--cpu${c.reset}=${c.green}1,4${c.reset}              Race each CPU slowdown separately
  ${c.yellow}--runs${c.reset}=${c.green}3${c.reset}               Run multiple times, report median
  ${c.yellow}--pause${c.reset}                Pause between runs (press Enter to continue)
  ${c.yellow}--format${c.reset}=${c.green}mov${c.reset}           Output format: webm (default), mov, gif
  ${c.yellow}--skin${c.reset}=${c.green}light${c.reset}           Skin the results player: ${skins.join(', ')}, or a path to a .css file
  ${c.yellow}--slowmo${c.reset}=${c.green}2${c.reset}             Slow-motion side-by-side replay (2x, 3x, etc.)
  ${c.yellow}--overlay${c.reset}=${c.green}0${c.reset}            Disable overlays in recordings (1=enable, 0=disable)
  ${c.yellow}--recording${c.reset}=${c.green}0${c.reset}          Skip video recording, just measure (1=enable, 0=disable)
  ${c.yellow}--ffmpeg${c.reset}               Enable FFmpeg processing (trim, merge, convert)
  ${c.yellow}--har${c.reset}                  Record network HAR files alongside videos
  ${c.yellow}--wasm${c.reset}=${c.green}0${c.reset}               Skip copying ffmpeg.wasm files (~25 MB) to results
  ${c.yellow}--height${c.reset}=${c.green}900${c.reset}           Viewport/recording height in pixels (480–4320, default 720)
  ${c.yellow}--ignore-https-errors${c.reset}  Accept invalid/self-signed TLS certificates
  ${c.yellow}--wall-clock${c.reset}           Burn a ticking wall clock into the recording (perturbs metrics)
  ${c.yellow}--cue-markers${c.reset}          Flash visual cues at segment boundaries (calibration testing; perturbs metrics)
  ${c.yellow}--serve${c.reset}=${c.green}0${c.reset}              Don't start local results server (CI/headless; open index.html manually)
  ${c.yellow}--gemini${c.reset}               Gemini CLI sports reporter commentary after race
  ${c.yellow}--gemini-spec${c.reset}=${c.green}"prompt"${c.reset} With ${c.yellow}--init${c.reset}: generate specs via Gemini + Playwright HTML research
  ${c.yellow}--yes${c.reset}                  With ${c.magenta}demo:${c.cyan}<name>${c.reset}: copy the demo race without being asked
  ${c.yellow}--verbose${c.reset}              Print runner output as the race runs
  ${c.yellow}--help${c.reset}                 Show this help
  ${c.yellow}--version${c.reset}              Print the installed version

${c.dim}  All flags except --results work with both URL mode and directory mode.${c.reset}
${c.dim}  Try a demo:  ${run} demo:lauda-vs-hunt${c.reset}
${c.dim}  Version:     ${run} --version   (v${packageVersion()})${c.reset}
`;
}
