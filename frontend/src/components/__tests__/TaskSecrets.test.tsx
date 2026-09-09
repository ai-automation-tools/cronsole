import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Task } from '../../types';

vi.mock('../../api', () => ({
  api: { patch: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast: toastMock }) }));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));

vi.mock('../../hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useSettings')>();
  const settings = () => ({ ...actual.DEFAULT_SETTINGS, timezone: 'utc' });
  return {
    ...actual,
    getSettings: settings,
    useSettings: () => ({ settings: settings(), update: vi.fn(), replaceAll: vi.fn(), reset: vi.fn() })
  };
});

import { EditTaskModal } from '../EditTaskModal';
import { TaskSecretsFields } from '../edit/TaskSecretsFields';
import { emptyNativeJobValues } from '../../utils/taskEditing';
import { api } from '../../api';

/**
 * Per-job secrets in the browser — ADR 0003.
 *
 * Three claims are worth a test here, and they are the three the design turns
 * on rather than the three that are easiest to assert:
 *
 * 1. **Nothing renders a value.** There is no route that returns one, so the
 *    only way a value could appear on screen is if the UI kept the one it just
 *    sent. It must not.
 * 2. **Referenced, stored and missing stay three facts.** A stored secret
 *    nothing uses is *unused*, not a problem; a referenced secret nothing stores
 *    is a task that will not run. Merging them would have to be wrong about one.
 * 3. **"Cannot read" is never rendered as "none".** An undecryptable store and
 *    an empty one produce the same list and mean opposite things.
 */

const nativeTask: Task = {
  id: 'native-1',
  name: 'Post to Discord',
  externalId: 'native_abc123',
  platform: 'TASKHUB_NATIVE',
  status: 'ACTIVE',
  category: 'Cronsole',
  schedule: '0 3 * * *',
  updatedAt: '2026-08-21T11:00:00Z',
  metadata: {
    job: {
      jobType: 'HTTP',
      url: 'https://example.com/hook',
      method: 'POST',
      headers: { Authorization: 'Bearer ${secret.API_TOKEN}' }
    }
  }
};

const windowsTask: Task = {
  id: 'task-1',
  name: 'Nightly Backup',
  externalId: '\\Cronsole\\Nightly Backup',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'Cronsole',
  schedule: '0 3 * * *',
  updatedAt: '2026-08-21T11:00:00Z',
  metadata: {
    actions: [{ type: 'Exec', path: 'powershell.exe', arguments: '-File C:\\x.ps1' }],
    runLevel: 'LUA'
  }
};

const secretsState = (over: Partial<{
  stored: string[]; referenced: string[]; missing: string[]; unreadable: boolean;
}> = {}) => ({
  stored: [],
  referenced: [],
  missing: [],
  unreadable: false,
  secretsUpdatedAt: null,
  ...over
});

const renderModal = (task: Task) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <EditTaskModal task={task} onClose={onClose} />
    </QueryClientProvider>
  );
  return { onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
  vi.mocked(api.post).mockResolvedValue({ data: { score: 1, warnings: [] } });
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
});

describe('the Secrets section', () => {
  it('reads the three lists from the server rather than deriving them', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: secretsState({ stored: ['API_TOKEN', 'OLD_KEY'], referenced: ['API_TOKEN'], missing: [] })
    });
    renderModal(nativeTask);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tasks/native-1/secrets'));
    // Set AND used.
    expect(await screen.findByText('API_TOKEN')).toBeInTheDocument();
    // Set and referenced by nothing — leftovers, not a problem.
    expect(screen.getByText('OLD_KEY')).toBeInTheDocument();
    expect(screen.getByText(/Set · unused/)).toBeInTheDocument();
  });

  it('says a referenced secret is not set, and what that costs', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: secretsState({ stored: [], referenced: ['API_TOKEN'], missing: ['API_TOKEN'] })
    });
    renderModal(nativeTask);

    expect(await screen.findByText(/Not set/)).toBeInTheDocument();
    expect(screen.getByText(/refuse to start rather than run with a blank credential/i)).toBeInTheDocument();
  });

  it('writes one secret through its own route, and never echoes the value back', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: secretsState() });
    renderModal(nativeTask);
    await screen.findByLabelText(/^Name$/);

    fireEvent.change(screen.getByLabelText(/^Name$/), { target: { value: 'API_TOKEN' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: 'tok_live_9f3a2b' } });
    fireEvent.click(screen.getByRole('button', { name: /Add secret/i }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/tasks/native-1/secrets/API_TOKEN', { value: 'tok_live_9f3a2b' })
    );
    // Cleared on success: the field is the only place the value ever existed in
    // the browser, and leaving it there makes a write-only store look readable.
    await waitFor(() => expect(screen.getByLabelText(/^Value/)).toHaveValue(''));
    // And it is a password field, so it is not shoulder-readable while typed.
    expect(screen.getByLabelText(/^Value/)).toHaveAttribute('type', 'password');
  });

  it('is not part of Save changes — a secret write does not touch the job route', async () => {
    // The whole reason secrets live in their own row: `PATCH /:id/job` replaces
    // the job, so a secret carried inside it would die on every unrelated edit.
    vi.mocked(api.get).mockResolvedValue({ data: secretsState() });
    renderModal(nativeTask);
    await screen.findByLabelText(/^Name$/);

    fireEvent.change(screen.getByLabelText(/^Name$/), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: 'value1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Add secret/i }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeDisabled();
  });

  it('removes a stored secret through its own route', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: secretsState({ stored: ['OLD_KEY'] }) });
    renderModal(nativeTask);

    fireEvent.click(await screen.findByRole('button', { name: /Remove secret OLD_KEY/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/tasks/native-1/secrets/OLD_KEY'));
  });

  it('reports an undecryptable store as unreadable, not as no secrets', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: secretsState({ unreadable: true }) });
    renderModal(nativeTask);
    expect(await screen.findByText(/ENCRYPTION_KEY/)).toBeInTheDocument();
  });

  it('says it could not read them rather than showing an empty list', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('boom'));
    renderModal(nativeTask);
    expect(await screen.findByText(/could not read which secrets this task has/i)).toBeInTheDocument();
  });

  it('is absent for a platform whose definition Cronsole does not own', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: secretsState() });
    renderModal(windowsTask);
    // The Windows editor is up — its own section renders.
    expect(await screen.findByText(/What it runs/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Secrets$/)).not.toBeInTheDocument();
    // And the route is never even asked: a secret Cronsole held for a Windows
    // task would never reach the thing that runs it.
    expect(api.get).not.toHaveBeenCalledWith('/tasks/task-1/secrets');
  });
});

describe('the pending (create-time) mode', () => {
  const renderPending = (initial: { name: string; value: string }[] = []) => {
    const onPendingChange = vi.fn();
    render(
      <TaskSecretsFields
        job={{
          ...emptyNativeJobValues(),
          jobType: 'HTTP',
          url: 'https://example.com/${secret.HOOK}'
        }}
        mode="pending"
        pending={initial}
        onPendingChange={onPendingChange}
      />
    );
    return { onPendingChange };
  };

  it('collects locally and issues no request', () => {
    const { onPendingChange } = renderPending();
    fireEvent.change(screen.getByLabelText(/^Name$/), { target: { value: 'HOOK' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: 'w3bh00k' } });
    fireEvent.click(screen.getByRole('button', { name: /Add secret/i }));

    expect(onPendingChange).toHaveBeenCalledWith([{ name: 'HOOK', value: 'w3bh00k' }]);
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reads the references off the job being typed, since no task exists to ask about', () => {
    renderPending();
    expect(screen.getByText('HOOK')).toBeInTheDocument();
    expect(screen.getByText(/Not set/)).toBeInTheDocument();
  });

  it('refuses a value too short to redact, and states that as the reason', () => {
    const { onPendingChange } = renderPending();
    fireEvent.change(screen.getByLabelText(/^Name$/), { target: { value: 'HOOK' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: /Add secret/i }));

    expect(screen.getByText(/at least 4 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/mangle the log/i)).toBeInTheDocument();
    expect(onPendingChange).not.toHaveBeenCalled();
  });

  it('refuses a name the API would refuse, before spending a round trip on it', () => {
    const { onPendingChange } = renderPending();
    fireEvent.change(screen.getByLabelText(/^Name$/), { target: { value: 'my token' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: 'value1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Add secret/i }));

    expect(screen.getByText(/Letters, digits and underscores only/i)).toBeInTheDocument();
    expect(onPendingChange).not.toHaveBeenCalled();
  });

  it('replaces rather than duplicating a name already collected', () => {
    const { onPendingChange } = renderPending([{ name: 'HOOK', value: 'old-value' }]);
    fireEvent.change(screen.getByLabelText(/^Name$/), { target: { value: 'HOOK' } });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: 'new-value' } });
    fireEvent.click(screen.getByRole('button', { name: /Replace secret/i }));

    expect(onPendingChange).toHaveBeenCalledWith([{ name: 'HOOK', value: 'new-value' }]);
  });
});
