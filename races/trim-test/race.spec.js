// Shared trim-test script.
// Per-racer timing and visual settings are injected via race.vars.

const timerUrl = new URL('races/trim-test/timer.html', 'file://' + process.cwd() + '/');
timerUrl.searchParams.set('color', race.vars.color || '#e74c3c');
timerUrl.searchParams.set('label', race.vars.label || race.name.toUpperCase());
await page.goto(timerUrl.href);

// Let the page settle and clock start ticking
await page.waitForTimeout(200);

// --- Staggered recording start ---
await page.waitForTimeout(Number(race.vars.recordingDelayMs || 100));
await page.raceRecordingStart();
await page.evaluate(() => window.__setPhase('recording'));

// Padding before measurement
await page.waitForTimeout(300);

// --- Race measurement 1 ---
await page.raceStart('Render');
await page.evaluate(ms => window.__setPhase('racing', ms), Number(race.vars.renderMs || 600));
await page.waitForTimeout(Number(race.vars.renderMs || 600));
page.raceEnd('Render');

// Gap between measurements
await page.evaluate(() => window.__setPhase('recording'));
await page.waitForTimeout(200);

// --- Race measurement 2 ---
await page.raceStart('Reload');
await page.evaluate(ms => window.__setPhase('racing', ms), Number(race.vars.reloadMs || 400));
await page.waitForTimeout(Number(race.vars.reloadMs || 400));
page.raceEnd('Reload');

// Padding after measurement
await page.evaluate(() => window.__setPhase('done'));
await page.waitForTimeout(300);
await page.raceRecordingEnd();
