// Delta — Recording delay: 400ms, Race duration: ~1200ms
// The timer on screen shows elapsed ms since page load, making it easy
// to verify that the trimmed video starts/ends at the right timestamps.

const timerUrl = new URL('races/trim-test/timer.html', 'file://' + process.cwd() + '/');
timerUrl.searchParams.set('color', '#f1c40f');
timerUrl.searchParams.set('label', 'DELTA');
await page.goto(timerUrl.href);

// Let the page settle and clock start ticking
await page.waitForTimeout(200);

// --- Staggered recording start: 400ms delay ---
await page.waitForTimeout(400);
await page.raceRecordingStart();
await page.evaluate(() => window.__setPhase('recording'));

// Padding before measurement
await page.waitForTimeout(300);

// --- Race measurement: ~1200ms ---
await page.raceStart('Render');
await page.evaluate(() => window.__setPhase('racing', 1200));
await page.waitForTimeout(1200);
page.raceEnd('Render');

// Padding after measurement
await page.evaluate(() => window.__setPhase('done'));
await page.waitForTimeout(300);
await page.raceRecordingEnd();
