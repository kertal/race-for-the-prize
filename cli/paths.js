/**
 * Output-path naming convention for race results.
 *
 * Every racer's artifacts live in a `<name>/` subdirectory of the run dir and
 * follow the `<name>.race<ext>` / `<name>.full<ext>` / `<name>.trace.json` /
 * `<name>.har` pattern. These builders are the single source of truth for that
 * convention — used both when renaming files on disk (cli/results.js) and when
 * building player-relative URLs (race.js).
 */

import { FORMAT_EXTENSIONS } from './media-config.js';

/** Trimmed race video filename, e.g. `lauda.race.webm`. */
export function raceVideoFile(name, ext = FORMAT_EXTENSIONS.webm) {
  return `${name}.race${ext}`;
}

/** Full (untrimmed) recording filename, e.g. `lauda.full.webm`. */
export function fullVideoFile(name, ext = FORMAT_EXTENSIONS.webm) {
  return `${name}.full${ext}`;
}

/** Chrome trace filename, e.g. `lauda.trace.json`. */
export function traceFile(name) {
  return `${name}.trace.json`;
}

/** HAR archive filename, e.g. `lauda.har`. */
export function harFile(name) {
  return `${name}.har`;
}

/** Racer-relative path (forward slashes — used in player HTML), e.g. `lauda/lauda.race.webm`. */
export function racerRelative(name, file) {
  return `${name}/${file}`;
}
