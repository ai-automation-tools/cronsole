import { test, expect, type Page } from '@playwright/test';
import { apiGet, apiPost, apiDelete, type ApiTask } from './helpers/api';

/**
 * The **Environment** field, end to end against a real backend.
 *
 * The unit suite can prove that `nativeJobPayload` emits `env` and that the form
 * holds it; it cannot prove the two agree with the API, because it never sends
 * anything. That gap is the reason this field went two versions with no control
 * at all — `buildNativeJob` had handled `env` the whole time — and it is the
 * same gap `mcp-server`'s stubbed suite has, for which the standing instruction
 * is to hand-drive the thing after touching a route it wraps. This is that,
 * mechanized.
 *
 * Both tests clean up after themselves, including on failure.
 */

async function dashboardReady(page: Page) {
  await expect(page.getByTestId('task-count-line')).toBeVisible();
  await expect(page.getByTestId('task-list')).toBeVisible();
}

const CREATE_NAME = 'e2e env editor probe';

test('an env typed into the form reaches metadata.job.env', async ({ page }) => {
  await page.goto('/');
  await dashboardReady(page);
  await page.getByRole('button', { name: 'New Task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cronsole', exact: true }).click();
  await dialog.getByRole('button', { name: 'Run a program' }).click();

  await dialog.getByLabel(/^Name/).fill(CREATE_NAME);
  await dialog.getByLabel(/Command/).fill('node -e "1"');

  const env = dialog.locator('#job-env');
  await expect(env).toBeVisible();
  await env.fill('API_BASE=https://example.com\n# a comment\nCONN=host=db;port=5432');

  await dialog.getByRole('button', { name: /Create Cronsole Task/ }).click();
  await expect(dialog).toBeHidden({ timeout: 15000 });

  // Read it back through the API rather than off the screen. The form could
  // render an environment it never sent; only the stored job settles that.
  let id: string | undefined;
  try {
    const tasks = await apiGet<ApiTask[]>('/tasks');
    const made = tasks.find(t => t.name === CREATE_NAME);
    expect(made, 'the task was created').toBeTruthy();
    id = made!.id;
    const job = (made!.metadata as Record<string, unknown>).job as Record<string, unknown>;
    // The `#` line dropped, and `host=db;port=5432` kept whole — everything
    // after the first `=` is the value, or any connection string loses half.
    expect(job.env).toEqual({ API_BASE: 'https://example.com', CONN: 'host=db;port=5432' });
  } finally {
    if (id) await apiDelete(`/tasks/${id}/native`);
  }
});

const EDIT_NAME = 'e2e script edit probe';

test('a script task can be edited, and its env round-trips', async ({ page }) => {
  const { task: made } = await apiPost<{ task: ApiTask }>('/tasks/native', {
    name: EDIT_NAME,
    category: 'e2e',
    schedule: '0 9 * * *',
    job: { jobType: 'SCRIPT', interpreter: 'node', body: 'console.log(1)', env: { OLD: 'one' } }
  });

  try {
    await page.goto('/');
    await dashboardReady(page);
    await page.getByText(EDIT_NAME).first().click();

    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: /^Edit/ }).first().click();

    const dialog = page.getByRole('dialog').last();
    // The env prefilled from the stored job.
    await expect(dialog.locator('#job-env')).toHaveValue('OLD=one');

    // #76: changing the script body used to leave Save inert, reporting
    // "A command is required." over a form with no command field.
    await dialog.locator('#job-script').fill('console.log(2)');
    await dialog.locator('#job-env').fill('OLD=one\nNEW=two');

    await expect(page.getByText('A command is required.')).toHaveCount(0);
    const save = dialog.getByRole('button', { name: /^Save/ });
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(async () => {
      const tasks = await apiGet<ApiTask[]>('/tasks');
      const t = tasks.find(x => x.id === made.id);
      const job = (t?.metadata as Record<string, unknown> | undefined)?.job as Record<string, unknown> | undefined;
      return { body: job?.body, env: job?.env };
    }, { timeout: 15000 }).toEqual({
      body: 'console.log(2)',
      env: { OLD: 'one', NEW: 'two' }
    });

  } finally {
    await apiDelete(`/tasks/${made.id}/native`);
  }
});
