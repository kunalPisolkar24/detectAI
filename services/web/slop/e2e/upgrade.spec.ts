import { test, expect } from '@playwright/test';

test.describe('Upgrade Flow', () => {
  test('should show pricing plans', async ({ page }) => {
    await page.goto('/upgrade');
    await expect(page.getByRole('heading', { name: /choose the plan/i })).toBeVisible();
    await expect(page.getByText(/spark/i)).toBeVisible();
    await expect(page.getByText(/flare/i)).toBeVisible();
  });
});
