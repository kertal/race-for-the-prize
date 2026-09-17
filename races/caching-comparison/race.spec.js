// 🤫 HushHushDB — what caching costs, and what it pays back
//
// https://kertal.github.io/hush-hush-db/ downloads a dataset and can keep it in
// IndexedDB so the next visit needs no network. Three modes race the same
// script, picked per racer in settings.json:
//
//   encrypted-cache (session) — AES-GCM in IndexedDB, key in sessionStorage
//   plain-cache     (plain)   — same data, stored as plaintext
//   no-cache        (nocache) — nothing stored, every visit re-downloads
//
// Everyone opens the plain start screen and waits there until the page is up.
// Recording starts then, and the race starts the way a reader would start it:
// pick the mode, pick the dataset, press Start Demo.
//
//   Fetch and store — download, encrypt, write. The app renders only after the
//                     write, so this is the price of caching, paid up front.
//   Return to data  — back to the start screen, then Start Demo again. The
//                     cache modes read their data back (decrypting on the way);
//                     no-cache comes up empty and downloads it all again.
//
// Neither step reloads the document: the app swaps screens with pushState, so
// the tab and its sessionStorage (where encrypted-cache keeps its key) survive
// the round trip.
//
// The cold load is untimed — same shell for everyone, and measuring it only
// added variance. The two selection clicks are inside the first measurement,
// because choosing is how the race starts.
//
// Across the matrix in settings.json the two axes tell different stories.
// Slower network is worse for no-cache, which re-downloads every visit; slower
// CPU is worse for encrypted-cache, which pays for crypto on every visit.
//
// SOURCE is "bundled-9" for all three racers: ~1.16 MB down, expanded ×8 to
// ~9 MB in the browser — enough traffic to separate the modes on the network
// axis, and enough data for the crypto to show on the CPU one. Swap in
// "bundled" (~1 MB, no expansion) to go faster, or a live API source
// ("usgs-week", "open-meteo", "randomuser") to race a real backend.

const url = 'https://kertal.github.io/hush-hush-db/';

// Drop the status line's " · rendered in N ms total" tail so the message fits
// one terminal row.
const status = async () => (await page.textContent('#status-line')).split(' · ')[0];

// Close the measurement even when the page work throws, so a timed-out click
// still reports how far it got.
const measure = async (name, work) => {
  await page.raceStart(name);
  try {
    await work();
  } finally {
    page.raceEnd(name);
  }
};

// Two Start Demo buttons share one handler; the first needs no scrolling.
const startDemo = () => page.locator('.start-demo').first().click();

// Watch for a re-render of #records-body — the only signal that says the load
// happened at all. The previous rows stay in the DOM (the app hides the card
// rather than emptying the table), so waiting on rows alone matches instantly.
// #records-body ships in the static markup, so this can be armed from the start
// screen; arm it before raceStart to keep the watching out of the phase.
const watchRender = () =>
  page.evaluate(() => {
    window.__raceWatch?.disconnect();
    window.__raceRendered = false;
    window.__raceWatch = new MutationObserver(() => {
      window.__raceRendered = true;
    });
    window.__raceWatch.observe(document.getElementById('records-body'), { childList: true });
  });

// Finish line: re-rendered, showing, idle and non-empty. data-loading-state
// alone can't tell "done" from "not started" — it stays "idle" through any load
// shorter than the app's 150 ms anti-flicker grace, and an unthrottled cache
// read is well under that.
const rendered = () =>
  page.waitForFunction(() => {
    const panel = document.getElementById('dataset-panel');
    return (
      window.__raceRendered &&
      !panel.hidden &&
      panel.dataset.loadingState === 'idle' &&
      document.querySelectorAll('#records-body tr').length > 0
    );
  });

// Cold page, empty cache. The dataset choices are built by script, so wait for
// this racer's own radio rather than for the screen alone.
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#setup-screen:not([hidden])');
await page.waitForSelector(`#setup-source-modes input[value="${race.vars.SOURCE}"]`);
await page.waitForTimeout(1000);

await page.raceRecordingStart();
await page.waitForTimeout(1000);
try {
  await watchRender();
  await measure('Fetch and store', async () => {
    // One press does the rest: the app opens the mode, finds the cache empty
    // and fetches by itself — there is no separate fetch click to make.
    await page.check(`input[name="key-mode"][value="${race.vars.MODE}"]`);
    await page.check(`#setup-source-modes input[value="${race.vars.SOURCE}"]`);
    await startDemo();
    await rendered();
  });

  page.raceMessage(await status());
  await page.waitForTimeout(2000);

  // Back out through the app's own link — no document load, and both radios
  // stay pointed at what is still running underneath. The pause is untimed,
  // only there so the departure shows up in the video.
  await page.click('#back-button');
  await page.waitForSelector('#setup-screen:not([hidden])');
  await page.waitForTimeout(2000);

  // Start Demo reopens the mode against what the first visit stored; no-cache
  // finds nothing and pays the download again.
  await watchRender();
  await measure('Return to data', async () => {
    await startDemo();
    await rendered();
  });

  page.raceMessage(await status());
  await page.waitForTimeout(2000);
} finally {
  await page.raceRecordingEnd();
}
