// 📦 HTMX - The Hypermedia Hero
// Created by Big Sky Software. HTML over the wire, minimal JavaScript.
// Race: Load the official HTMX documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Load Framework');

await page.goto('https://htmx.org/', { waitUntil: 'load' });

// Wait for the main hero content to be visible
await page.waitForSelector('h1', { state: 'visible' });

page.raceEnd('Load Framework');
page.raceMessage('HTML extended!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
