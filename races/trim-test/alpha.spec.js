// Alpha — Recording delay: 100ms, Race duration: ~600ms
// The timer on screen shows elapsed ms since page load, making it easy
// to verify that the trimmed video starts/ends at the right timestamps.

const timerUrl = new URL('races/trim-test/timer.html', 'file://' + process.cwd() + '/');
timerUrl.searchParams.set('color', '#e74c3c');
timerUrl.searchParams.set('label', 'ALPHA');
await page.goto(timerUrl.href);

// Let the page settle and clock start ticking
await page.waitForTimeout(200);

// --- Staggered recording start: 100ms delay ---
await page.waitForTimeout(100);
await page.raceRecordingStart();
await page.evaluate(() => window.__setPhase('recording'));

// Padding before measurement
await page.waitForTimeout(300);

// --- Race measurement: ~600ms ---
await page.raceStart('Render');
await page.evaluate(() => window.__setPhase('racing', 600));
await page.waitForTimeout(600);
page.raceEnd('Render');

// Padding after measurement
await page.evaluate(() => window.__setPhase('done'));
await page.waitForTimeout(300);
await page.raceRecordingEnd();
