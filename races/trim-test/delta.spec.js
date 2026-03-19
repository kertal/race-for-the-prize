// Delta — Recording delay: 400ms, Render: ~1200ms, Reload: ~700ms
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

// Gap between measurements
await page.evaluate(() => window.__setPhase('recording'));
await page.waitForTimeout(200);

// --- Race measurement 2: ~700ms ---
await page.raceStart('Reload');
await page.evaluate(() => window.__setPhase('racing', 700));
await page.waitForTimeout(700);
page.raceEnd('Reload');

// Padding after measurement
await page.evaluate(() => window.__setPhase('done'));
await page.waitForTimeout(300);
await page.raceRecordingEnd();
