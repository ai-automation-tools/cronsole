import { expect, test } from '@playwright/test';
import { apiDelete, apiGet, apiPatch, apiPost, type ApiTask, windowsTasksAsAgentTasks } from './helpers/api';
import { e2eAgentTask, MockCronsoleAgent } from './helpers/mockAgent';

test.describe.serial('mock Windows agent flows', () => {
  let agent: MockCronsoleAgent;

  test.beforeEach(async () => {
    const existingTasks = await apiGet<ApiTask[]>('/tasks');
    const mockTask = e2eAgentTask();
    agent = new MockCronsoleAgent([
      ...windowsTasksAsAgentTasks(existingTasks).filter((task) => task.path !== mockTask.path),
      mockTask
    ]);
    await agent.connect();
  });

  test.afterEach(() => {
    agent.disconnect();
  });

  test('syncs a deterministic agent task and runs it from the dashboard', async ({ page }) => {
    await page.goto('/');

    const statusPanel = page.locator('aside').filter({ hasText: 'System Status' });
    await expect(statusPanel.getByText('Windows')).toBeVisible();
    await expect(statusPanel.getByText('Online').first()).toBeVisible();

    await page.getByRole('button', { name: 'Import tasks' }).click();
    await expect(page.getByRole('heading', { name: 'Import & Sync' })).toBeVisible();
    const importModal = page.locator('.fixed.inset-0').filter({ hasText: 'Import & Sync' });
    await expect(importModal.getByText('E2E', { exact: true })).toBeVisible();

    await apiPost('/tasks/sync', { categories: ['E2E'] });
    await page.getByRole('button', { name: 'Discard' }).click();
    // An explicit view, not a bare reload. A bare URL means "the user's opening
    // dashboard", which resolves to Favorites as soon as they have starred
    // anything — so on a machine with favorites this reload showed two starred
    // tasks and none of them was the one just imported. The test needs a view
    // that is about the task, not about the tester's stars.
    await page.goto('/?view=my-jobs');
    await expect(page.getByText('E2E Mock Nightly Backup')).toBeVisible();

    await page.getByPlaceholder(/Search tasks/).fill('E2E Mock Nightly Backup');
    await page.getByTitle('Run Task').first().click();

    // Confirm the run in the custom confirmation dialog (replaced native confirm()).
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toContainText('E2E Mock Nightly Backup');
    await confirmDialog.getByRole('button', { name: 'Run' }).click();

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
    // Task name is prefilled with the template name; give this task its own
    // (also dodges the duplicate-name 409 if a PowerShell Script task is tracked).
    await modal
      .locator('label', { hasText: 'Task name' })
      .locator('..')
      .locator('input')
      .fill('E2E Applied Task');
    await modal
      .locator('label', { hasText: 'Script file path' })
      .locator('..')
      .locator('input')
      .fill('C:\\CronsoleE2E\\template-run.ps1');
    await page.getByRole('button', { name: /Create Task/ }).click();

    await expect(page.getByRole('status')).toContainText(
      'Task created on Windows from "PowerShell Script".'
    );
    await expect.poll(() => agent.creates.map((create) => create.name)).toContain('E2E Applied Task');
    expect(agent.creates.at(-1)?.action?.executable).toBe('powershell.exe');
    expect(agent.creates.at(-1)?.action?.args).toContain('C:\\CronsoleE2E\\template-run.ps1');

    // The applied task is tracked immediately (duplicate-name guard). Delete it
    // through the real signed task:delete path so repeat runs don't 409 — this
    // also covers the delete round-trip end to end.
    const tasks = await apiGet<ApiTask[]>('/tasks');
    const applied = tasks.find((t) => t.externalId === '\\Cronsole\\E2E Applied Task');
    expect(applied).toBeTruthy();
    await apiDelete(`/tasks/${applied!.id}`);
    expect(agent.deletes.map((d) => d.taskPath)).toContain('\\Cronsole\\E2E Applied Task');
    const after = await apiGet<ApiTask[]>('/tasks');
    expect(after.some((t) => t.externalId === '\\Cronsole\\E2E Applied Task')).toBe(false);
  });

  test('edits a Windows task schedule through the real signed command', async () => {
    // Make sure the deterministic E2E task is tracked, then edit its schedule.
    await apiPost('/tasks/sync', { categories: ['E2E'] });
    const tasks = await apiGet<ApiTask[]>('/tasks');
    const target = tasks.find((t) => t.externalId === '\\E2E\\Mock Nightly Backup');
    expect(target).toBeTruthy();

    const updated = await apiPatch<ApiTask>(`/tasks/${target!.id}/schedule`, { schedule: '0 8 * * *' });
    expect(updated.schedule).toBe('0 8 * * *');
    // The signed task:update_schedule reached the agent for the real task path.
    expect(agent.scheduleUpdates.map((u) => u.taskPath)).toContain('\\E2E\\Mock Nightly Backup');

    // The stored schedule reflects the change after platform confirmation.
    const after = await apiGet<ApiTask[]>('/tasks');
    expect(after.find((t) => t.id === target!.id)?.schedule).toBe('0 8 * * *');

    // Restore so repeat runs are stable.
    await apiPatch(`/tasks/${target!.id}/schedule`, { schedule: '15 9 * * *' });
  });

  test('edits a Windows task command & settings through the real signed command', async () => {
    // Make sure the deterministic E2E task is tracked, then edit its action.
    await apiPost('/tasks/sync', { categories: ['E2E'] });
    const tasks = await apiGet<ApiTask[]>('/tasks');
    const target = tasks.find((t) => t.externalId === '\\E2E\\Mock Nightly Backup');
    expect(target).toBeTruthy();

    const updated = await apiPatch<ApiTask>(`/tasks/${target!.id}/actions`, {
      command: 'powershell.exe -File C:\\CronsoleE2E\\edited.ps1',
      workingDirectory: 'C:\\CronsoleE2E',
      description: 'Edited by E2E',
      runLevel: 'highest'
    });
    // Optimistic metadata reflects the new command after platform confirmation.
    const updatedMeta = updated.metadata as Record<string, unknown>;
    expect(updatedMeta.command).toBe('powershell.exe -File C:\\CronsoleE2E\\edited.ps1');
    expect(updatedMeta.runLevel).toBe('Highest');

    // The signed task:update reached the agent, structured into { executable, args }
    // server-side (no shell) for the real task path.
    expect(agent.actionUpdates.map((u) => u.taskPath)).toContain('\\E2E\\Mock Nightly Backup');
    const lastUpdate = agent.actionUpdates.at(-1)!;
    expect(lastUpdate.action?.executable).toBe('powershell.exe');
    expect(lastUpdate.action?.args).toContain('C:\\CronsoleE2E\\edited.ps1');
    expect(lastUpdate.workingDirectory).toBe('C:\\CronsoleE2E');
    expect(lastUpdate.runLevel).toBe('highest');

    // Restore so repeat runs are stable.
    await apiPatch(`/tasks/${target!.id}/actions`, {
      command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\CronsoleE2E\\backup.ps1',
      workingDirectory: 'C:\\CronsoleE2E',
      description: 'Deterministic task for Playwright mock-agent coverage',
      runLevel: 'least'
    });
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
    await expect(page.getByRole('button', { name: 'Import tasks' })).toBeVisible();
  });
});
