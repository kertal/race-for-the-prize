// 📦 HTMX - The Hypermedia Hero
// Created by Big Sky Software. HTML over the wire, minimal JavaScript.
// Race: Load the official HTMX documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Webpage loaded and stable');

await page.goto('https://htmx.org/', { waitUntil: 'load' });
await page.raceWaitForVisualStability();

page.raceEnd('Webpage loaded and stable');

page.raceMessage('HTML extended!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
