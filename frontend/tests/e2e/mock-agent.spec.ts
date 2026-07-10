import { expect, test } from '@playwright/test';
import { apiGet, apiPost, type ApiTask, windowsTasksAsAgentTasks } from './helpers/api';
import { e2eAgentTask, MockTaskHubAgent } from './helpers/mockAgent';

test.describe.serial('mock Windows agent flows', () => {
  let agent: MockTaskHubAgent;

  test.beforeEach(async () => {
    const existingTasks = await apiGet<ApiTask[]>('/tasks');
    const mockTask = e2eAgentTask();
    agent = new MockTaskHubAgent([
      ...windowsTasksAsAgentTasks(existingTasks).filter((task) => task.path !== mockTask.path),
      mockTask
    ]);
    await agent.connect();
  });

  test.afterEach(() => {
    agent.disconnect();
  });

  test('syncs a deterministic agent task and runs it from the dashboard', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('E2E Mock Nightly Backup');
      await dialog.accept();
    });

    await page.goto('/');

    const statusPanel = page.locator('aside').filter({ hasText: 'System Status' });
    await expect(statusPanel.getByText('Windows')).toBeVisible();
    await expect(statusPanel.getByText('Online').first()).toBeVisible();

    await page.getByRole('button', { name: /^Import$/ }).click();
    await expect(page.getByRole('heading', { name: 'Import & Sync' })).toBeVisible();
    const importModal = page.locator('.fixed.inset-0').filter({ hasText: 'Import & Sync' });
    await expect(importModal.getByText('E2E', { exact: true })).toBeVisible();

    await apiPost('/tasks/sync', { categories: ['E2E'] });
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.reload();
    await expect(page.getByText('E2E Mock Nightly Backup')).toBeVisible();

    await page.getByPlaceholder(/Search tasks/).fill('E2E Mock Nightly Backup');
    await page.getByTitle('Run Task').first().click();

    await expect(page.getByRole('status')).toContainText(
      '"E2E Mock Nightly Backup" triggered successfully.'
    );
    await expect
      .poll(() => agent.runs.map((run) => run.taskPath))
      .toContain('\\E2E\\Mock Nightly Backup');
  });

  test('applies a parameterized template through the real create socket command', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Templates', { exact: true }).first().click();

    const templateCard = page
      .locator('div.group')
      .filter({ has: page.getByRole('heading', { name: 'PowerShell Script' }) })
      .first();
    await templateCard.getByRole('button', { name: /Apply Template/ }).click();

    const modal = page.locator('.fixed.inset-0').filter({ hasText: 'Apply Template' });
    await expect(modal.getByText('Apply Template')).toBeVisible();
    await modal
      .locator('label', { hasText: 'Script file path' })
      .locator('..')
      .locator('input')
      .fill('C:\\TaskHubE2E\\template-run.ps1');
    await page.getByRole('button', { name: /Create Task/ }).click();

    await expect(page.getByRole('status')).toContainText(
      'Task created on Windows from "PowerShell Script".'
    );
    await expect.poll(() => agent.creates.map((create) => create.name)).toContain('PowerShell Script');
    expect(agent.creates.at(-1)?.action?.executable).toBe('powershell.exe');
    expect(agent.creates.at(-1)?.action?.args).toContain('C:\\TaskHubE2E\\template-run.ps1');
  });

  test('shows the agent as offline after the socket disconnects', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside').getByText('Online').first()).toBeVisible();

    agent.disconnect();
    await page.reload();

    await expect(page.locator('aside').getByText('Offline')).toBeVisible();
  });

  test('keeps the primary dashboard usable below 375px', async ({ page }) => {
    await page.setViewportSize({ width: 374, height: 812 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Unified Task Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import$/ })).toBeVisible();
  });
});
