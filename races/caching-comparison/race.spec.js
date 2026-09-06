// 🤫 HushHushDB — what caching costs, and what it pays back
//
// https://kertal.github.io/hush-hush-db/ downloads a dataset and can keep it in
// IndexedDB so the next visit needs no network at all. Three cache handling
// modes race the same script, picked per racer in settings.json:
//
//   encrypted-cache (mode=session) — AES-GCM in IndexedDB, key in sessionStorage
//   plain-cache     (mode=plain)   — same data, stored as plaintext
//   no-cache        (mode=nocache) — nothing is stored, every visit re-downloads
//
// The app reads ?mode= and ?source= on boot, so the URL puts each racer straight
// into its mode and skips the start screen.
//
// Both visits are measured, because encryption is not free on either side of the
// cache:
//
//   Fetch and store — download, then encrypt and write. The app renders only
//                     after the write finishes, so this is the price of
//                     caching, paid up front.
//   Reload to data  — the app's own "Reload Page" button: it drops the view and
//                     re-reads the cache, decrypting on the way, and refetches
//                     by itself when there is nothing stored. This is the
//                     payback.
//
// The cold page load ahead of them is deliberately untimed: it is the same app
// shell for all three racers, and measuring it only added variance (under
// slow-3g the three came within 3% of each other while swinging by whole
// tenths of a second between runs).
//
// Note that the second section re-renders in place rather than reloading the
// document, so it times the cache read cleanly but does not exercise the
// survives-a-real-reload half of the story. Swap the click for
// `page.reload({ waitUntil: 'load' })` to test that instead — the no-cache
// racer then needs its own `#fetch-button` click, since only this button
// refetches on its own.
//
// Race it across the matrix and the two axes tell different stories: slower
// networks punish no-cache, which has to download the dataset again, while
// higher CPU throttling punishes encrypted-cache, which pays for encryption
// once on the way in and for decryption on every visit after that.
//
// SOURCE is the app's "x8" dataset, which downloads the same ~220 KB and then
// inflates it to ~9 MB in the browser. That keeps the network axis short while
// giving the crypto something big enough to measure. Swap it for "bundled"
// (~1 MB) if you want the run over faster, or one of the live API sources
// ("usgs-week", "open-meteo", "randomuser") to race against a real backend.

const url = `https://kertal.github.io/hush-hush-db/?mode=${race.vars.MODE}&source=${race.vars.SOURCE}`;

// The app's status line ends with a " · rendered in N ms total" tail that just
// restates the numbers before it. Dropping it keeps the message short enough to
// stay readable on one terminal row.
const status = async () => (await page.textContent('#status-line')).split(' · ')[0];

// Time a phase, closing the measurement even when the page work throws. The
// runner rethrows a failing script before it finalizes, and raceEnd is what
// records a measurement — so without this a timed-out click would take the
// whole phase down with it instead of reporting how far it got.
const measure = async (name, work) => {
  await page.raceStart(name);
  try {
    await work();
  } finally {
    page.raceEnd(name);
  }
};

await page.raceRecordingStart();
try {
  // Cold page, empty cache — the same starting line for everyone.
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#fetch-button');
  await page.waitForTimeout(1000);

  await measure('Fetch and store', async () => {
    await page.click('#fetch-button');
    await page.waitForSelector('#records-body tr');
  });

  page.raceMessage(await status());
  await page.waitForTimeout(1000);

  await measure('Reload to data', async () => {
    await page.click('#reload-page-button');
    // The button's handler hides the table before it re-reads the cache, and
    // it does that synchronously while the click is dispatched — so by the
    // time the click resolves the panel is already gone and waiting for it to
    // come back really does time the read. Waiting on `#records-body tr` would
    // not: the rows from the previous render stay in the DOM and match
    // instantly.
    await page.waitForSelector('#dataset-panel:not([hidden])');
  });

  page.raceMessage(await status());
  await page.waitForTimeout(2000);
} finally {
  await page.raceRecordingEnd();
}
