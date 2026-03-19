// ⚛️ React - The Component King
// Created by Facebook in 2013. Virtual DOM pioneer.
// Race: Load the official React documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Webpage loaded and stable');

await page.goto('https://react.dev/', { waitUntil: 'load' });

await page.raceWaitForVisualStability();

page.raceEnd('Webpage loaded and stable');

page.raceMessage('Components assembled!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
