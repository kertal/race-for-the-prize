// 🅰️ Angular - The Enterprise Champion
// Created by Google in 2016. Full-featured framework.
// Race: Load the official Angular documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Load Framework');

await page.goto('https://angular.dev/', { waitUntil: 'load' });

// Wait for the main content to be visible and interactive
await page.waitForSelector('a[href="/tutorials"]', { state: 'visible' });

page.raceEnd('Load Framework');
page.raceMessage('Modules loaded!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
