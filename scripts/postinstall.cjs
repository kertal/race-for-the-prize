#!/usr/bin/env node
/**
 * Post-install hook: download the Chromium build Playwright needs.
 *
 * Skipped when the browser is already provisioned by the environment (CI images,
 * dev containers, this project's cloud sessions) so `npm install` doesn't
 * re-fetch ~150MB or fail in sandboxes with no network. Set either
 *   RFTP_SKIP_BROWSER_INSTALL=1   (project-specific), or
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1  (Playwright's standard opt-out)
 * to skip. Honors PLAYWRIGHT_BROWSERS_PATH implicitly via Playwright's CLI.
 */
'use strict';

const { execFileSync } = require('node:child_process');

if (process.env.RFTP_SKIP_BROWSER_INSTALL || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
  console.log('race-for-the-prize: skipping Chromium download (skip flag set).');
  process.exit(0);
}

try {
  execFileSync('playwright', ['install', 'chromium'], { stdio: 'inherit' });
} catch (err) {
  // Don't hard-fail the install — the user can run `npx playwright install
  // chromium` later. A failed browser download must not block `npm install`
  // (e.g. offline installs that only need the library for its unit tests).
  console.warn(
    'race-for-the-prize: could not download Chromium automatically ' +
    `(${err.message}). Run "npx playwright install chromium" before racing.`
  );
}
