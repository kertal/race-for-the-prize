/**
 * site-bundle.js — packs a finished multi-condition results directory into one
 * .zip the reader can host anywhere static.
 *
 * The performance matrix is already a small static site: index.html at the top,
 * one subdirectory per throttling condition holding that condition's player and
 * its recordings, every link between them relative. Zipping that tree as-is
 * makes it shareable — unzip it into a GitHub Pages branch and the matrix, its
 * cells, and the videos behind them all work unchanged.
 *
 * Two kinds of file are left out (see SKIP below): the ffmpeg.wasm converter,
 * which is a tool rather than a result and dwarfs everything else, and HAR
 * captures, which carry request headers nobody means to publish.
 *
 * The archive is built by the same zip.cjs the in-page export uses, handed a
 * zlib compressor — text-heavy results (HTML, JSON traces) shrink by an order
 * of magnitude, and videos, which deflate can't improve, stay stored.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { c } from './colors.js';
import { formatBytes } from './profile-analysis.js';

const require = createRequire(import.meta.url);
const { createZipBuilder } = require('./player-runtime/zip.cjs');

/** Suffix of the bundle written next to index.html, e.g. `results-…-site.zip`. */
export const BUNDLE_SUFFIX = '-site.zip';

/** Name of the publishing notes written into the bundle root. */
export const PUBLISHING_FILE = 'PUBLISHING.md';

/**
 * What never goes into a bundle meant to be published:
 *
 * - `ffmpeg/` is ~25 MB of ffmpeg.wasm per condition, there only so the player
 *   can convert video in the browser. A reader of a published page doesn't
 *   need it, and on a 1 GB Pages site it's the whole budget.
 * - `.har` files are full network captures — request and response headers,
 *   cookies included. Opt-in locally (`--har`), never published by accident.
 * - `.zip` keeps an earlier bundle from ending up inside the next one.
 *
 * Everything else is kept, traces included, so every link on the published
 * page still resolves.
 */
const SKIP_DIRS = new Set(['ffmpeg']);
const SKIP_EXTENSIONS = ['.har', '.zip'];

const isSkippedFile = name => SKIP_EXTENSIONS.some(ext => name.endsWith(ext));

/**
 * Recordings and images are already compressed — deflating them costs seconds
 * of CPU per race and gives back nothing, so they go in stored.
 */
const STORE_EXTENSIONS = ['.webm', '.mp4', '.mov', '.gif', '.png', '.jpg', '.woff2'];

/** The per-file compressor zip.cjs calls: raw deflate, or null to store as-is. */
const deflateUnlessAlreadyCompressed = (data, name) =>
  (STORE_EXTENSIONS.some(ext => name.endsWith(ext)) ? null : zlib.deflateRawSync(data));

/**
 * Every file of `baseDir` that belongs in the bundle, as posix-style paths
 * relative to it, sorted so a bundle of the same directory is byte-identical
 * across platforms (readdir order isn't).
 *
 * @param {string} baseDir - a results directory
 * @returns {string[]} relative paths, e.g. ['index.html', 'cpu1x/alpha/alpha.race.webm']
 */
export function planSiteBundle(baseDir) {
  const found = [];

  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() && !isSkippedFile(entry.name)) {
        found.push(rel);
      }
    }
  };

  walk(baseDir, '');
  return found.sort();
}

/**
 * The note that travels with the bundle, for whoever unzips it without having
 * run the race. `.nojekyll` beside it is what stops GitHub Pages from running
 * the tree through Jekyll, which would drop anything it considers private.
 */
function publishingNotes(rootName) {
  return `# Publishing these results

This folder is a static site: \`index.html\` is the performance matrix, and each
subdirectory holds one throttling condition's player and its recordings. Every
link between them is relative, so it works from any static host — and from
\`file://\`, by opening \`index.html\` directly.

## GitHub Pages

1. Copy this folder into the branch or folder you publish from, for example
   \`docs/${rootName}/\` on your default branch.
2. Commit and push, then enable Pages for that branch/folder under
   **Settings → Pages**.
3. Share \`https://<user>.github.io/<repo>/${rootName}/\`.

The \`.nojekyll\` file next to this one keeps Pages from running the site
through Jekyll — leave it in place.

## What's not here

The ffmpeg.wasm converter (the player's in-browser video export) and any HAR
captures are left out: the first is tens of megabytes of tooling, and the
second holds raw request and response headers. Both stay in the original
results directory.
`;
}

/**
 * Pack `baseDir` into a zip beside it and return what was written.
 *
 * Entries live under one top-level folder named after the results directory,
 * so unzipping lands a single folder rather than spraying files into the
 * reader's downloads.
 *
 * Call this *after* the directory holds everything it should — the bundle is a
 * snapshot of the files on disk at this moment.
 *
 * @param {string} baseDir - the results directory to pack
 * @returns {Promise<{name: string, path: string, bytes: number, size: string, files: number}>}
 *   `size` is the human-readable form both the terminal line and the page's
 *   download link show, formatted once here so they can't disagree.
 */
export async function writeSiteBundle(baseDir) {
  const rootName = path.basename(baseDir);
  const name = `${rootName}${BUNDLE_SUFFIX}`;
  const zipPath = path.join(baseDir, name);

  const files = planSiteBundle(baseDir);
  const builder = createZipBuilder({ compress: deflateUnlessAlreadyCompressed });

  // The two files the race never produced but a published copy needs, written
  // first so they head the listing.
  const encoder = new TextEncoder();
  builder.addFile(`${rootName}/.nojekyll`, new Uint8Array(0));
  builder.addFile(`${rootName}/${PUBLISHING_FILE}`, encoder.encode(publishingNotes(rootName)));

  for (const rel of files) {
    builder.addFile(`${rootName}/${rel}`, new Uint8Array(fs.readFileSync(path.join(baseDir, rel))));
  }

  const buffer = Buffer.from(await builder.toBlob().arrayBuffer());
  fs.writeFileSync(zipPath, buffer);
  return { name, path: zipPath, bytes: buffer.length, size: formatBytes(buffer.length), files: files.length + 2 };
}

/**
 * Bundle the results, reporting failures as a warning rather than an error:
 * a zip that couldn't be written (out of disk, unreadable file) must not cost
 * the race its results.
 *
 * @returns {Promise<{name: string, bytes: number}|null>} null when skipped or failed
 */
export async function tryWriteSiteBundle(baseDir) {
  try {
    return await writeSiteBundle(baseDir);
  } catch (e) {
    console.error(`${c.dim}Warning: Could not bundle results for sharing: ${e.message}${c.reset}`);
    return null;
  }
}
