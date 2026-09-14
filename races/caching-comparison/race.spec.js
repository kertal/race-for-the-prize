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
//   Fetch and store  — download, then encrypt and write. The app renders only
//                      after the write finishes, so this is the price of
//                      caching, paid up front.
//   Navigate to data — leave for the app's start page, pause, then come back to
//                      the result URL. A fresh document boots against whatever
//                      the first visit stored: the two cache modes read it back
//                      (decrypting on the way) and render on their own, while
//                      no-cache boots to an empty start line and has to press
//                      Fetch and download it all again. This is the payback,
//                      and it includes the real navigation the cache is there
//                      to survive.
//
// The cold page load ahead of them is deliberately untimed: it is the same app
// shell for all three racers, and measuring it only added variance (under
// slow-3g the three came within 3% of each other while swinging by whole
// tenths of a second between runs).
//
// The round trip stays in one tab, which matters for encrypted-cache: its key
// lives in sessionStorage, and a same-tab navigation keeps that while a new tab
// would not.
//
// Race it across the matrix in settings.json and the two axes tell different
// stories.
//
//   network — none (this machine's own connection), then 4g, fast-3g, slow-3g.
//             Slower is worse for no-cache, which has to download the dataset
//             again on every visit while the other two already have it.
//   cpuThrottle — a slowdown, not a speed-up: 1 leaves the CPU alone, 4 runs it
//             four times slower, the way a phone would. Slower is worse for
//             encrypted-cache, which pays for encryption once on the way in and
//             for decryption on every visit after that.
//
// SOURCE is the app's "x8" dataset, which downloads the same ~220 KB and then
// inflates it to ~9 MB in the browser. That keeps the network axis short while
// giving the crypto something big enough to measure. Swap it for "bundled"
// (~1 MB) if you want the run over faster, or one of the live API sources
// ("usgs-week", "open-meteo", "randomuser") to race against a real backend.

const root = 'https://kertal.github.io/hush-hush-db/';
const url = `${root}?mode=${race.vars.MODE}&source=${race.vars.SOURCE}`;

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

// Both phases end when the Result card is showing this phase's result and is
// not loading another. Two signals, because neither is enough alone:
//
//   #dataset-panel[data-loading-state] is the app's stated contract — "loading"
//   (skeleton, nothing displayed yet), "refreshing" (the previous result is
//   still on screen, dimmed, being replaced in place) or "idle". It flips back
//   to "idle" the moment the load ends, which makes it a clean finish line, but
//   it stays "idle" throughout a load shorter than the app's 150 ms
//   anti-flicker grace — so on its own it cannot tell "done" from "not started
//   yet", and an unthrottled cache read is well under that.
//
//   Rows in #records-body. Both phases start from a document that has never
//   rendered a result — the first one is a cold page, the second a fresh
//   navigation — so the rows appearing at all is what says the load happened.
//   (An in-place reload could not use this: the previous result's rows stay in
//   the DOM, dimmed, until the new ones replace them.)
const rendered = () =>
  page.waitForFunction(() => {
    const panel = document.getElementById('dataset-panel');
    return (
      !panel.hidden &&
      panel.dataset.loadingState === 'idle' &&
      document.querySelectorAll('#records-body tr').length > 0
    );
  });

await page.raceRecordingStart();
try {
  // Cold page, empty cache — the same starting line for everyone.
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#fetch-button');
  await page.waitForTimeout(1000);

  await measure('Fetch and store', async () => {
    await page.click('#fetch-button');
    await rendered();
  });

  page.raceMessage(await status());
  await page.waitForTimeout(1000);

  // Leave the result behind: the start page without ?mode= or ?source= is the
  // app's front door. The pause is untimed, like the cold load — it is only
  // there so the departure is visible in the video.
  await page.goto(root, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  // Back to the same URL. The cache modes boot straight into their stored
  // result; no-cache boots to the empty start line and must press Fetch again,
  // and that press is part of its price.
  await measure('Navigate to data', async () => {
    await page.goto(url, { waitUntil: 'load' });
    if (race.vars.MODE === 'nocache') {
      await page.click('#fetch-button');
    }
    await rendered();
  });

  page.raceMessage(await status());
  await page.waitForTimeout(2000);
} finally {
  await page.raceRecordingEnd();
}
