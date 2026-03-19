// Bravo — Late recording start: 2000ms delay before raceRecordingStart().
// Longer delay than alpha to test cue capture at different video positions.

const timerUrl = new URL('races/trim-test/timer.html', 'file://' + process.cwd() + '/');
timerUrl.searchParams.set('color', '#3498db');
timerUrl.searchParams.set('label', 'BRAVO');
await page.goto(timerUrl.href);

// Simulate slow page load — recording has not started yet
await page.waitForTimeout(2000);

await page.raceRecordingStart();
await page.waitForTimeout(200);

await page.raceStart('Task');
await page.waitForTimeout(500);
page.raceEnd('Task');

await page.waitForTimeout(200);
await page.raceRecordingEnd();
