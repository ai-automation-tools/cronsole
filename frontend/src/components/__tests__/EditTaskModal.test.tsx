import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Task } from '../../types';

vi.mock('../../api', () => ({ api: { patch: vi.fn(), get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast: toastMock }) }));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));

// Pin the schedule zone to UTC so cron fields don't shift with the date the suite
// runs (PST vs PDT). The conversion itself is covered in utils/timezone.test.ts.
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
import { api } from '../../api';

/**
 * The **one** task editor, which replaced four scattered edit affordances.
 *
 * Folding them together is a UI change; what it must not fold together is the
 * writes. A task's editable parts are three different routes with three
 * different failure modes — a label write this process owns, a schedule rebuild
 * that on Windows is an elevated agent round trip, and a command rewrite that
 * can be refused by the platform. So the assertions here are mostly about the
 * seam: only changed sections are sent, each is sent to its own route, and a
 * partial failure is reported per section rather than collapsed into one verdict.
 *
 * The Cronsole-native job rules are pinned here too, unchanged from the modal
 * this absorbed: the job is **replaced, not patched** (the two types share no
 * fields, and a stray `url` inside an EXEC job is unread by the executor and
 * unexplainable to whoever finds it), a **type switch discards data** and says so
 * before the click, and an EXEC job runs **wherever the backend runs**.
 */

const nativeTask: Task = {
  id: 'native-1',
  name: 'Ping health',
  externalId: 'native_abc123',
  platform: 'TASKHUB_NATIVE',
  status: 'ACTIVE',
  category: 'Cronsole',
  schedule: '0 3 * * *',
  updatedAt: '2026-08-12T11:00:00Z',
  metadata: { job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' } }
};

const execTask: Task = {
  ...nativeTask,
  metadata: {
    job: { jobType: 'EXEC', executable: 'node', args: ['digest.js'], workingDirectory: 'D:\\jobs' }
  }
};

const windowsTask: Task = {
  id: 'task-1',
  name: 'Nightly Backup',
  externalId: '\\Edge-Radar\\Nightly Backup',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'Edge-Radar',
  schedule: '0 3 * * *',
  updatedAt: '2026-08-12T11:00:00Z',
  metadata: {
    actions: [{ type: 'Exec', path: 'powershell.exe', arguments: '-File C:\\x.ps1', workingDirectory: 'C:\\scripts' }],
    description: 'Old desc',
    runLevel: 'LUA'
  }
};

const claudeTask: Task = {
  id: 'task-2',
  name: 'Weekly planner',
  externalId: 'trig_01ABCDEF',
  platform: 'CLAUDE_CODE',
  status: 'ACTIVE',
  category: 'Claude',
  updatedAt: '2026-08-12T11:00:00Z',
  metadata: {}
};

const renderModal = (task: Task, opts: { executionHost?: string; onClose?: () => void } = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = opts.onClose ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <EditTaskModal task={task} executionHost={opts.executionHost} onClose={onClose} />
    </QueryClientProvider>
  );
  return { onClose };
};

const saveButton = () => screen.getByRole('button', { name: /Save changes/i });

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
  // ScheduleFields debounces a conversion preview against the backend.
  vi.mocked(api.post).mockResolvedValue({ data: { score: 1, warnings: [] } });
});

/**
 * Type a literal cron.
 *
 * The schedule control opens on the *picker* for any expression it can hold
 * (`0 3 * * *` is Daily at 03:00), so a raw expression is entered behind the
 * Cron tab. Switching registers writes nothing by itself — that is the property
 * these tests would catch if it broke, since a rewritten schedule would show up
 * as an extra PATCH below.
 */
const typeCron = (from: string, to: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Cron' }));
  fireEvent.change(screen.getByDisplayValue(from), { target: { value: to } });
};

describe('one gesture, three routes', () => {
  it('sends nothing until something changes', () => {
    renderModal(nativeTask);
    expect(saveButton()).toBeDisabled();
  });

  it('sends only the section that changed', async () => {
    // The core of the fan-out. An unchanged schedule must not be rewritten just
    // because the user renamed the task — on Windows that is an agent round trip
    // and a real trigger rebuild.
    renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Ping health v2' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/tasks/native-1', {
      name: 'Ping health v2',
      category: 'Cronsole'
    });
  });

  it('routes each part to its own endpoint in one save', async () => {
    renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    typeCron('0 3 * * *', '0 8 * * *');
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: 'https://example.com/v2' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(3));
    const urls = vi.mocked(api.patch).mock.calls.map(c => c[0]);
    expect(urls).toEqual(['/tasks/native-1', '/tasks/native-1/schedule', '/tasks/native-1/job']);
  });

  it('stores the schedule as UTC cron, never the zone it was typed in', async () => {
    renderModal(nativeTask);
    typeCron('0 3 * * *', '0 8 * * *');
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/native-1/schedule', { schedule: '0 8 * * *' })
    );
  });

  it('closes and reports success only when every part landed', async () => {
    const { onClose } = renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][1]).toBe('success');
  });
});

describe('partial failure — the reason this is per section', () => {
  const failSchedule = () =>
    vi.mocked(api.patch).mockImplementation(async (url: string) => {
      if (url.endsWith('/schedule')) throw { response: { data: { error: 'Agent offline' } } };
      return { data: {} } as never;
    });

  it('keeps what succeeded, marks what failed, and stays open', async () => {
    failSchedule();
    const { onClose } = renderModal(windowsTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    typeCron('0 3 * * *', '0 8 * * *');
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    // The failure names the thing to go and fix, not the raw "Agent offline".
    expect(screen.getByText(/CronsoleAgent scheduled task is running/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 parts saved/i)).toBeInTheDocument();
    // Staying open is the point: the retry has to be possible without retyping.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retries only what is still outstanding', async () => {
    // A section that saved is re-baselined, so it is no longer dirty and the
    // second press must not write it again — re-sending a successful rename is
    // harmless, but re-sending a successful *action* rewrite is not.
    failSchedule();
    renderModal(windowsTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    typeCron('0 3 * * *', '0 8 * * *');
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    vi.mocked(api.patch).mockClear();
    vi.mocked(api.patch).mockResolvedValue({ data: {} });

    fireEvent.click(saveButton());
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.patch).mock.calls[0][0]).toBe('/tasks/task-1/schedule');
  });

  it('says plainly when nothing was saved at all', async () => {
    vi.mocked(api.patch).mockRejectedValue({ response: { data: { error: 'Boom' } } });
    renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText(/Nothing was saved/i)).toBeInTheDocument());
    expect(screen.getByText(/exactly as it was/i)).toBeInTheDocument();
  });
});

describe('a part this platform cannot change', () => {
  it('states the reason in words rather than disabling a control', () => {
    // A disabled button with a title= is unreadable on the phone this app is
    // required to work on, and the reason is the useful half.
    renderModal(claudeTask);
    expect(screen.getByText(/defined at claude\.ai/i)).toBeInTheDocument();
    expect(screen.getByText(/only available for Cronsole-native tasks and cron-expressible/i)).toBeInTheDocument();
  });

  it('still offers the labels, because those are editable everywhere', async () => {
    renderModal(claudeTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Planner' } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-2', { name: 'Planner', category: 'Claude' })
    );
  });

  it('explains an uneditable Windows trigger instead of hiding the section', () => {
    renderModal({ ...windowsTask, schedule: undefined });
    expect(screen.getByText(/boot, logon, event, or on-demand only/i)).toBeInTheDocument();
  });

  it('refuses a multi-action Windows task with the reason', () => {
    renderModal({
      ...windowsTask,
      metadata: { actions: [{ path: 'a.exe' }, { path: 'b.exe' }] }
    });
    expect(screen.getByText(/multiple actions/i)).toBeInTheDocument();
  });

  it('says the agent has not reported a command yet', () => {
    renderModal({ ...windowsTask, metadata: {} });
    expect(screen.getByText(/hasn't reported this task's command yet/i)).toBeInTheDocument();
  });
});

describe('labels are Cronsole labels, never the machine', () => {
  it('says the Task Scheduler name is unaffected, before the save', () => {
    renderModal(windowsTask);
    // The path leaf has to be *in the note*, not merely somewhere on screen —
    // the header already says the task's name, and matching that would pass
    // even if the note printed nothing.
    const note = screen.getByText(/Task Scheduler keeps calling it/i);
    expect(note.textContent).toMatch(/Task Scheduler keeps calling it\s+Nightly Backup/);
  });

  it('says a recategorize does not move the task on the machine', () => {
    renderModal(windowsTask);
    expect(screen.getByText(/does not move it/i)).toBeInTheDocument();
  });

  it('claims no second name for a platform that has none', () => {
    // A Claude id is an opaque trig_… and a native row IS the task, so deriving
    // a platform name from the id would print one over every routine.
    renderModal(claudeTask);
    expect(screen.queryByText(/Task Scheduler keeps calling it/i)).not.toBeInTheDocument();
  });

  it('will not save a task with no name', () => {
    renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: '  ' } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/A task needs a name/i)).toBeInTheDocument();
  });
});

describe('editing a Windows action', () => {
  it('sends the command line for the server to tokenize', async () => {
    renderModal(windowsTask);
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'powershell.exe -File C:\\y.ps1' } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-1/actions', {
        command: 'powershell.exe -File C:\\y.ps1',
        workingDirectory: 'C:\\scripts',
        description: 'Old desc',
        runLevel: 'least'
      })
    );
  });

  it('quotes a spaced executable so the prefill round-trips', async () => {
    // Without the quotes the backend tokenizes "C:\Program" as the executable.
    renderModal({
      ...windowsTask,
      metadata: {
        actions: [{ type: 'Exec', path: 'C:\\Program Files\\App\\app.exe', arguments: '--run', workingDirectory: '' }],
        description: '',
        runLevel: 'LUA'
      }
    });
    screen.getByDisplayValue('"C:\\Program Files\\App\\app.exe" --run');

    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'now described' } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-1/actions', {
        command: '"C:\\Program Files\\App\\app.exe" --run',
        workingDirectory: '',
        description: 'now described',
        runLevel: 'least'
      })
    );
  });
});

describe('editing a Cronsole-native job', () => {
  it('sends the whole spec, not a patch', async () => {
    renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: 'https://example.com/v2' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/native-1/job', {
        job: { jobType: 'HTTP', url: 'https://example.com/v2', method: 'POST' }
      })
    );
  });

  it('accepts headers as "Name: value" lines, not only JSON', async () => {
    renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText('Headers'), {
      target: { value: 'Authorization: Bearer abc\nContent-Type: application/json' }
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      job: { headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' } }
    });
  });

  it('blocks the save on unreadable headers instead of silently sending none', async () => {
    // Dropping them produces a task that runs and 401s at 3am, which is worse
    // than a form that will not submit.
    renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText('Headers'), { target: { value: 'this is not a header' } });

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/Headers must be JSON/i)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('will not submit without a URL', () => {
    renderModal({ ...nativeTask, metadata: { job: { jobType: 'HTTP', method: 'GET' } } });
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: '' } });
    expect(saveButton()).toBeDisabled();
  });

  it('sends the command line for a script job', async () => {
    renderModal(execTask);
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: '  node other.js  ' } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/tasks/native-1/job', {
        job: { jobType: 'EXEC', command: 'node other.js', workingDirectory: 'D:\\jobs' }
      })
    );
  });

  it('says where the job will actually run', () => {
    renderModal(execTask, { executionHost: 'inside the Cronsole backend container' });
    expect(screen.getByText(/inside the Cronsole backend container/)).toBeInTheDocument();
    expect(screen.getByText(/not on the machine you are browsing from/i)).toBeInTheDocument();
  });

  it('says a shell is not implied', () => {
    renderModal(execTask);
    expect(screen.getByText(/no shell/i)).toBeInTheDocument();
  });

  it('warns that a type switch discards the other side, before the click', () => {
    renderModal(nativeTask);
    expect(screen.queryByText(/will be discarded/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run a program' }));
    const warning = screen.getByText(/will be discarded/i);
    expect(warning.textContent).toMatch(/URL, method, headers and body/);
    expect(warning.textContent).toMatch(/keeps its name, schedule and history/);
  });

  it('sends only the new type\'s fields, never a leftover from the old', async () => {
    renderModal(nativeTask);
    fireEvent.click(screen.getByRole('button', { name: 'Run a program' }));
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: 'node digest.js' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const sent = (vi.mocked(api.patch).mock.calls[0][1] as { job: Record<string, unknown> }).job;
    expect(sent).toEqual({ jobType: 'EXEC', command: 'node digest.js' });
    expect(sent).not.toHaveProperty('url');
    expect(sent).not.toHaveProperty('method');
  });
});

describe('closing with unsaved work', () => {
  it('asks before discarding, and stays open if declined', async () => {
    confirmMock.mockResolvedValue(false);
    const { onClose } = renderModal(nativeTask);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes without a prompt when nothing was touched', async () => {
    const { onClose } = renderModal(nativeTask);
    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
