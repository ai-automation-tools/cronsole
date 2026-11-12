import { test, expect } from '@playwright/test';
import { apiGet, type ApiTask } from './helpers/api';

// Smoke test: proves the whole stack renders end-to-end through a real browser —
// the frontend boots, authenticates to the backend with the dev token, fetches
// tasks from Postgres, and client-side navigation works. Requires the dev stack
// to be up (pwsh scripts/cronsole.ps1 up).

test.describe('dashboard smoke', () => {
  test('loads the dashboard and renders live task data', async ({ page }) => {
    await page.goto('/');

    // The scope heading, which names what you are looking at ('All Tasks' on a
    // bare URL). It read 'Unified Task Dashboard' until the 2026-08-15 redesign.
    await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible();

    // The subtitle count only renders if the backend returned tasks, so this
    // single assertion covers frontend → backend → Postgres end to end.
    await expect(page.getByText(/Manage \d+ tasks across your ecosystem/)).toBeVisible();

    // The sidebar brand is always present.
    await expect(page.getByText('Cronsole').first()).toBeVisible();
  });

  test('an empty dashboard offers three ways in', async ({ page }) => {
    // Only a fresh install is empty (CI is one). A machine with tasks has nothing to check.
    test.skip((await apiGet<ApiTask[]>('/tasks')).length > 0, 'this install already tracks tasks');
    await page.goto('/');

    await expect(page.getByText('Dashboard is empty')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add tasks from this machine' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a Cronsole job' })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Explore sources' }).click();
    await expect(page).toHaveURL(/\/sources\?focus=available/);
  });

  test('navigates to the template library', async ({ page }) => {
    await page.goto('/');

    await page.getByText('Templates', { exact: true }).first().click();

    await expect(
      page.getByRole('heading', { name: 'Schedule Template Library' })
    ).toBeVisible();
  });

  test('favorites a template and filters by Favorites', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Templates', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Schedule Template Library' })).toBeVisible();

    const card = page
      .locator('div.group')
      .filter({ has: page.getByRole('heading', { name: 'PowerShell Script' }) })
      .first();

    // Star it — the toggle flips from "Add" to "Remove" (optimistic) and the real
    // POST /templates/:id/favorite persists it.
    await card.getByTitle('Add to favorites').click();
    await expect(card.getByTitle('Remove from favorites')).toBeVisible();

    // The Favorites filter shows only favorited templates; our card survives it.
    // By title: the source rail has a Favorites button too, so the name alone matches two.
    await page.getByTitle('Show favorites only').click();
    await expect(page.getByRole('heading', { name: 'PowerShell Script' })).toBeVisible();

    // Turn the filter off, then unfavorite to keep the shared dev user clean.
    await page.getByTitle('Show all templates').click();
    await card.getByTitle('Remove from favorites').click();
    await expect(card.getByTitle('Add to favorites')).toBeVisible();
  });
});
