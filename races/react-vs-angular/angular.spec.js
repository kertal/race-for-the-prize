// 🅰️ Angular - The Enterprise Champion
// Created by Google in 2016. Full-featured framework.
// Race: Load the official Angular documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Webpage loaded and stable');

await page.goto('https://angular.dev', { waitUntil: 'load' });

await page.raceWaitForVisualStability({ timeout: 10000 });

page.raceEnd('Webpage loaded and stable');

page.raceMessage('Modules loaded!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
