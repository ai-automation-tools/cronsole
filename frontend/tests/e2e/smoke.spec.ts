import { test, expect } from '@playwright/test';

// Smoke test: proves the whole stack renders end-to-end through a real browser —
// the frontend boots, authenticates to the backend with the dev token, fetches
// tasks from Postgres, and client-side navigation works. Requires the dev stack
// to be up (pwsh scripts/taskhub.ps1 up).

test.describe('dashboard smoke', () => {
  test('loads the dashboard and renders live task data', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Unified Task Dashboard' })).toBeVisible();

    // The subtitle count only renders if the backend returned tasks, so this
    // single assertion covers frontend → backend → Postgres end to end.
    await expect(page.getByText(/Manage \d+ tasks across your ecosystem/)).toBeVisible();

    // The sidebar brand is always present.
    await expect(page.getByText('TaskHub').first()).toBeVisible();
  });

  test('navigates to the template library', async ({ page }) => {
    await page.goto('/');

    await page.getByText('Templates', { exact: true }).first().click();

    await expect(
      page.getByRole('heading', { name: 'Schedule Template Library' })
    ).toBeVisible();
  });
});
