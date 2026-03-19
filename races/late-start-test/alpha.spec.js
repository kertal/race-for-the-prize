// Alpha — Late recording start: 1500ms delay before raceRecordingStart().
// Simulates a race that loads a slow page before starting the recording window.
// The green cue must be reliably captured even though it appears well into the video.

const timerUrl = new URL('races/trim-test/timer.html', 'file://' + process.cwd() + '/');
timerUrl.searchParams.set('color', '#e74c3c');
timerUrl.searchParams.set('label', 'ALPHA');
await page.goto(timerUrl.href);

// Simulate slow page load — recording has not started yet
await page.waitForTimeout(1500);

await page.raceRecordingStart();
await page.waitForTimeout(200);

await page.raceStart('Task');
await page.waitForTimeout(400);
page.raceEnd('Task');

await page.waitForTimeout(200);
await page.raceRecordingEnd();
