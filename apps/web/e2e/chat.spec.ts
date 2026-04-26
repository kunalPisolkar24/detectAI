import { test, expect } from '@playwright/test';

test.describe('Chat Interaction', () => {
  test('should render chat input area', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel(/text to analyze/i)).toBeVisible();
    await expect(page.getByLabel(/analyze text/i)).toBeVisible();
  });
});
