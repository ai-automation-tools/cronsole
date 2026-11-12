import { test, expect } from '@playwright/test';
import { apiPost, apiDelete, type ApiTask } from './helpers/api';

/**
 * Keyboard and name checks that need a real browser: focus, Enter on a button,
 * and the accessible name a screen reader would read.
 */

const NAME = 'e2e keyboard row probe';

test('a list row opens from the keyboard', async ({ page }) => {
  const { task: made } = await apiPost<{ task: ApiTask }>('/tasks/native', {
    name: NAME,
    category: 'e2e',
    schedule: '0 9 * * *',
    job: { jobType: 'SCRIPT', interpreter: 'node', body: 'console.log(1)' }
  });

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'List', exact: true }).click();

    // The row itself opens on a click, which a keyboard cannot do. The name is the route.
    const name = page.getByRole('button', { name: NAME, exact: true });
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  } finally {
    await apiDelete(`/tasks/${made.id}/native`);
  }
});

test('Settings controls have names', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Settings', { exact: true }).first().click();

  // Placeholders are not names: they vanish as soon as you type.
  await expect(page.getByRole('textbox', { name: 'Current password' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Settings' }).getByText('Dashboard', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Default platform filter' })).toBeVisible();
});
