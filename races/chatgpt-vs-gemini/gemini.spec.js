const { test } = require('@playwright/test');

test('Gemini - meaning of life', async ({ page }) => {
  await page.goto('https://gemini.google.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.raceRecordingStart();
  await page.waitForTimeout(1500);

  await page.raceStart('Search: meaning of life');

  // Type the prompt into the Gemini input
  const input = page.locator('[contenteditable="true"]').or(page.locator('textarea')).first();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.click();
  await input.fill('What is the meaning of life?');
  await page.keyboard.press('Enter');

  // Wait for a response to appear
  await page.locator('.model-response-text, .response-container, [class*="response"], message-content').first().waitFor({ state: 'visible', timeout: 30000 });
  // Wait a bit for content to stream in
  await page.waitForTimeout(3000);

  page.raceEnd('Search: meaning of life');
  await page.waitForTimeout(1500);

  await page.raceRecordingEnd();
});
