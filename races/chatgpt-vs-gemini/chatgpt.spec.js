const { test } = require('@playwright/test');

test('ChatGPT - meaning of life', async ({ page }) => {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.raceRecordingStart();
  await page.waitForTimeout(1500);

  await page.raceStart('Search: meaning of life');

  // Type the prompt into the ChatGPT textarea
  const textarea = page.getByPlaceholder(/ask/i).or(page.locator('textarea')).first();
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  await textarea.click();
  await textarea.fill('What is the meaning of life?');
  await page.keyboard.press('Enter');

  // Wait for a response to appear
  await page.locator('[data-message-author-role="assistant"]').first().waitFor({ state: 'visible', timeout: 30000 });
  // Wait a bit for content to stream in
  await page.waitForTimeout(3000);

  page.raceEnd('Search: meaning of life');
  await page.waitForTimeout(1500);

  await page.raceRecordingEnd();
});
