import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Task } from '../../types';

vi.mock('../../api', () => ({ api: { patch: vi.fn(), get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast: toastMock }) }));

import { EditNativeJobModal, type NativeJobInitial } from '../EditNativeJobModal';
import { api } from '../../api';

/**
 * Editing a Cronsole-native job — the one edit with **no platform round trip**,
 * which is what makes it feel safe and is exactly why the risks are quiet.
 *
 * Three of them are pinned here. The job is **replaced, not patched**, so a
 * field from the other job type must never ride along (the two types share no
 * fields, and a stray `url` inside an EXEC job is unread by the executor and
 * unexplainable to whoever finds it). A **type switch discards data**, so it is
 * announced before the click rather than reported after. And an EXEC job runs
 * **wherever the backend runs**, which on a Dockerized stack is not the user's
 * filesystem — a path that resolves in Explorer can fail as "executable not
 * found".
 */

const task: Task = {
  id: 'native-1',
  name: 'Ping health',
  externalId: 'native_abc123',
  platform: 'TASKHUB_NATIVE',
  status: 'ACTIVE',
  category: 'Cronsole',
  updatedAt: '2026-08-12T11:00:00Z',
  metadata: {}
};

const httpInitial: NativeJobInitial = {
  jobType: 'HTTP',
  url: 'https://example.com/health',
  method: 'GET',
  headers: '',
  body: '',
  command: '',
  workingDirectory: ''
};

const execInitial: NativeJobInitial = {
  ...httpInitial,
  jobType: 'EXEC',
  url: '',
  command: 'node digest.js',
  workingDirectory: 'D:\\jobs'
};

const renderModal = (initial: NativeJobInitial, executionHost?: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditNativeJobModal task={task} initial={initial} executionHost={executionHost} onClose={vi.fn()} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.patch).mockResolvedValue({ data: task });
});

describe('editing an HTTP job', () => {
  it('sends the whole spec to the native job route', async () => {
    renderModal(httpInitial);
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: 'https://example.com/v2' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Job/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/native-1/job', {
        job: { jobType: 'HTTP', url: 'https://example.com/v2', method: 'POST' }
      })
    );
  });

  it('accepts headers as "Name: value" lines, not only JSON', async () => {
    // Pasting a header out of an API's docs should not require reformatting it
    // into JSON first; JSON is still accepted because that is what the API
    // stores and what an export round-trips.
    renderModal(httpInitial);
    fireEvent.change(screen.getByLabelText('Headers'), {
      target: { value: 'Authorization: Bearer abc\nContent-Type: application/json' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Job/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      job: { headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' } }
    });
  });

  it('refuses unreadable headers instead of silently sending none', async () => {
    // Dropping them would produce a task that runs and 401s at 3am, which is
    // worse than a form that will not submit.
    renderModal(httpInitial);
    fireEvent.change(screen.getByLabelText('Headers'), { target: { value: 'this is not a header' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Job/i }));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][1]).toBe('error');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('will not submit without a URL', () => {
    renderModal({ ...httpInitial, url: '' });
    expect(screen.getByRole('button', { name: /Save Job/i })).toBeDisabled();
  });
});

describe('editing a script job', () => {
  it('sends the command line for the server to tokenize', async () => {
    // Sent as a line, not as {executable, args[]}: one definition of "how a
    // command line becomes argv" lives on the server, shared with the create and
    // Windows paths, and the browser never holds a copy that can drift.
    renderModal(execInitial);
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: '  node other.js  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Job/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/native-1/job', {
        job: { jobType: 'EXEC', command: 'node other.js', workingDirectory: 'D:\\jobs' }
      })
    );
  });

  it('says where the job will actually run', () => {
    renderModal(execInitial, 'inside the Cronsole backend container');
    expect(screen.getByText(/inside the Cronsole backend container/)).toBeInTheDocument();
    expect(screen.getByText(/not on the machine you are browsing from/i)).toBeInTheDocument();
  });

  it('says a shell is not implied', () => {
    renderModal(execInitial);
    expect(screen.getByText(/no shell/i)).toBeInTheDocument();
  });
});

describe('switching job type', () => {
  it('warns that the other type\'s fields are discarded, before the click', () => {
    // A warning that arrives with the result arrives too late to change the
    // decision — the same rule the bulk recategorize dialog follows.
    renderModal(httpInitial);
    expect(screen.queryByText(/will be discarded/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Run a program/i }));
    const warning = screen.getByText(/will be discarded/i);
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toMatch(/URL, method, headers and body/);
    expect(warning.textContent).toMatch(/keeps its name, schedule and history/);
  });

  it('sends only the new type\'s fields, never a leftover from the old', async () => {
    // The core of replace-not-patch. A `url` surviving into an EXEC job is a
    // field the executor never reads and a reader cannot explain.
    renderModal(httpInitial);
    fireEvent.click(screen.getByRole('button', { name: /Run a program/i }));
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'node digest.js' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Job/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const sent = (vi.mocked(api.patch).mock.calls[0][1] as { job: Record<string, unknown> }).job;
    expect(sent).toEqual({ jobType: 'EXEC', command: 'node digest.js' });
    expect(sent).not.toHaveProperty('url');
    expect(sent).not.toHaveProperty('method');
  });
});
