import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast: toastMock }) }));

// Pin the schedule zone so nothing here depends on PST/PDT at run time.
vi.mock('../../hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useSettings')>();
  const settings = () => ({ ...actual.DEFAULT_SETTINGS, timezone: 'utc' });
  return {
    ...actual,
    getSettings: settings,
    useSettings: () => ({ settings: settings(), update: vi.fn(), replaceAll: vi.fn(), reset: vi.fn() })
  };
});

vi.mock('../../hooks/usePlatformMatrix', () => ({
  usePlatformMatrix: () => ({ data: { platforms: [] } })
}));

import { CreateTaskModal } from '../CreateTaskModal';
import { api } from '../../api';

/**
 * Claude is the odd one out in this modal: the other two platforms **create** a
 * task, and Claude can only **connect** one that already exists at claude.ai.
 * Every assertion here is about the modal not blurring that — a "New Task" flow
 * that silently means something else for one option is how someone ends up
 * believing Cronsole made a routine it cannot make.
 */

const renderModal = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreateTaskModal onClose={vi.fn()} />
    </QueryClientProvider>
  );
};

const selectClaude = () => fireEvent.click(screen.getByRole('button', { name: /^Claude$/i }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockResolvedValue({ data: { warnings: [] } });
});

describe('platform choice', () => {
  it('offers Claude alongside the two platforms Cronsole can create on', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /^Cronsole$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Windows$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Claude$/i })).toBeInTheDocument();
  });

  it('defaults to Cronsole-native, so the create flow is unchanged', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'New Task' })).toBeInTheDocument();
  });
});

describe('Claude connects, it does not create', () => {
  it('renames the whole action rather than reusing "New Task"', () => {
    renderModal();
    selectClaude();
    expect(screen.getByRole('heading', { name: 'Connect a routine' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Routine/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create .*Task/i })).not.toBeInTheDocument();
  });

  it('says plainly what Cronsole cannot do', () => {
    renderModal();
    selectClaude();
    expect(screen.getByText(/cannot create, schedule or pause a routine/i)).toBeInTheDocument();
  });

  it('offers no schedule field, and explains why instead', () => {
    // A cron box here could only set a value Cronsole has nowhere to send —
    // the routine's cadence lives at claude.ai and is unreadable through the
    // single endpoint Anthropic exposes.
    renderModal();
    selectClaude();
    expect(screen.queryByText(/Schedule \(cron/i)).not.toBeInTheDocument();
    expect(screen.getByText(/The schedule stays at claude\.ai/i)).toBeInTheDocument();
  });

  it('drops the fields that belong to the create flows', () => {
    renderModal();
    selectClaude();
    expect(screen.queryByText(/^Category$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Job type/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Command/i)).not.toBeInTheDocument();
  });

  it('masks the token and leaves the id readable', () => {
    renderModal();
    selectClaude();
    expect(screen.getByLabelText('API token')).toHaveAttribute('type', 'password');
    // The id is not a secret, and masking it would make a paste impossible to check.
    expect(screen.getByLabelText('Routine id or fire URL')).not.toHaveAttribute('type', 'password');
  });
});

describe('submitting a Claude routine', () => {
  it('requires the id and token but not a name', () => {
    renderModal();
    selectClaude();
    const submit = screen.getByRole('button', { name: /Connect Routine/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: 'trig_1' } });
    expect(submit).toBeDisabled();

    // No name typed — it falls back to the id server-side.
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'sk-ant-oat01-x' } });
    expect(submit).toBeEnabled();
  });

  it('stores the routine and then imports it, so it reaches the dashboard', async () => {
    // Two calls on purpose: connecting stores a credential, and the ordinary
    // import path is what turns a declared routine into a task row. Having the
    // routines endpoint write a Task itself would give Claude a private
    // task-creation path no other platform uses.
    renderModal();
    selectClaude();
    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: ' trig_1 ' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: ' sk-ant-oat01-x ' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Nightly ' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect Routine/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/tools/platforms/claude/routines', {
        id: 'trig_1',
        token: 'sk-ant-oat01-x',
        name: 'Nightly'
      })
    );
    // Scoped to Claude — a bare sync would pull in Windows folders nobody asked for.
    expect(api.post).toHaveBeenCalledWith('/tasks/sync', { categories: ['Claude'] });
  });

  it('tells the user the routine still runs on its own schedule', async () => {
    renderModal();
    selectClaude();
    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: 'trig_1' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'sk' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect Routine/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatch(/still runs on its own schedule at claude\.ai/i);
  });

  it('surfaces a server shape warning instead of reporting a clean success', async () => {
    // It saved anyway, so silence would leave a likely-wrong paste to fail at
    // the first run with nothing pointing back here.
    vi.mocked(api.post).mockResolvedValueOnce({ data: { warnings: ['"weird" does not look like a routine id'] } });
    renderModal();
    selectClaude();
    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: 'weird' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'sk' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect Routine/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toMatch(/does not look like a routine id/i);
    expect(toastMock.mock.calls[0][1]).toBe('error');
  });
});
