import { test, expect } from '@playwright/test';

// Runs against a preview build (pnpm preview:dev / preview image), where the
// credentials provider accepts any email + password without Turnstile.
test.describe('Chat Interaction', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in via the credentials callback in the page's own context so the
    // session cookie is shared (the `request` fixture uses a separate context).
    const csrfToken = await page
      .request.get('/api/auth/csrf')
      .then((response) => response.json())
      .then((body) => (body as { csrfToken: string }).csrfToken);
    await page.request.post('/api/auth/callback/credentials?callbackUrl=/chat', {
      form: {
        csrfToken,
        email: 'e2e@example.com',
        password: 'password1234',
      },
    });
  });

  test('should render chat input area', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByLabel(/text to analyze/i)).toBeVisible();
    await expect(page.getByLabel(/analyze text/i)).toBeVisible();
  });
});
