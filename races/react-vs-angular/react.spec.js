// ⚛️ React - The Component King
// Created by Facebook in 2013. Virtual DOM pioneer.
// Race: Load the official React documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Load Framework');

await page.goto('https://react.dev/', { waitUntil: 'load' });

// Wait for the main hero content to be visible
await page.waitForSelector('h1', { state: 'visible' });

page.raceEnd('Load Framework');
page.raceMessage('Components assembled!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
