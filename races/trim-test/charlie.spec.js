// Charlie — Recording delay: 300ms, Render: ~1000ms, Reload: ~600ms
// The timer on screen shows elapsed ms since page load, making it easy
// to verify that the trimmed video starts/ends at the right timestamps.

const timerUrl = new URL('races/trim-test/timer.html', 'file://' + process.cwd() + '/');
timerUrl.searchParams.set('color', '#27ae60');
timerUrl.searchParams.set('label', 'CHARLIE');
await page.goto(timerUrl.href);

// Let the page settle and clock start ticking
await page.waitForTimeout(200);

// --- Staggered recording start: 300ms delay ---
await page.waitForTimeout(300);
await page.raceRecordingStart();
await page.evaluate(() => window.__setPhase('recording'));

// Padding before measurement
await page.waitForTimeout(300);

// --- Race measurement: ~1000ms ---
await page.raceStart('Render');
await page.evaluate(() => window.__setPhase('racing', 1000));
await page.waitForTimeout(1000);
page.raceEnd('Render');

// Gap between measurements
await page.evaluate(() => window.__setPhase('recording'));
await page.waitForTimeout(200);

// --- Race measurement 2: ~600ms ---
await page.raceStart('Reload');
await page.evaluate(() => window.__setPhase('racing', 600));
await page.waitForTimeout(600);
page.raceEnd('Reload');

// Padding after measurement
await page.evaluate(() => window.__setPhase('done'));
await page.waitForTimeout(300);
await page.raceRecordingEnd();
