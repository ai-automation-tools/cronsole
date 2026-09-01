import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast: toastMock }) }));

// Pinned to UTC so the zone round trip is the identity here and the assertions
// below are about *what was sent*, not about which side of a DST boundary the
// suite happens to run on.
vi.mock('../../hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useSettings')>();
  const settings = () => ({ ...actual.DEFAULT_SETTINGS, timezone: 'utc' });
  return {
    ...actual,
    getSettings: settings,
    useSettings: () => ({ settings: settings(), update: vi.fn(), replaceAll: vi.fn(), reset: vi.fn() })
  };
});

vi.mock('../../hooks/useGeminiConnection', () => ({
  useGeminiToolPresets: () => ({ data: { presets: [], max: 10 } })
}));

import { RecreateTriggerModal } from '../RecreateTriggerModal';
import { api } from '../../api';
import type { Task } from '../../types';

/**
 * **The dialog's whole contract is what it does NOT send.**
 *
 * Gemini's task definition is immutable, so every edit here is a rebuild — and
 * the rebuild fills the fields it was not given from the platform's own copy of
 * the trigger. That only stays true if this form keeps quiet about the fields
 * nobody touched: resending an untouched prompt would revert an edit made in
 * Google's console since the last sync, and resending an untouched schedule
 * would rewrite a trigger through a zone round trip that is not guaranteed to
 * be byte-identical. Nothing in the type system says so, so it is pinned here.
 */

const task: Task = {
  id: 'task-1',
  name: 'Morning brief',
  category: 'Gemini',
  platform: 'GEMINI_TRIGGERS',
  status: 'ACTIVE',
  externalId: 'trg_abc',
  updatedAt: '2026-08-31T00:00:00Z',
  schedule: '0 9 * * *',
  metadata: { prompt: 'Summarise the AI news' }
};

const renderModal = (over: Partial<Task> = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecreateTriggerModal task={{ ...task, ...over }} onClose={vi.fn()} />
    </QueryClientProvider>
  );
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: /^Recreate/i }));
// Selected by URL, not by index: the form also preflights the prompt as you
// type (POST /tools/prompt-preflight), and an index would silently start
// asserting about the wrong request the day any other call is added.
const body = () => {
  const call = vi.mocked(api.post).mock.calls.find(([url]) =>
    String(url).includes('rotate-credentials')
  );
  if (!call) throw new Error('the recreate request was never sent');
  return call[1] as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockResolvedValue({ data: { oldRemoved: true } });
});

describe('what a recreate sends', () => {
  it('sends neither prompt nor schedule when nothing was touched', async () => {
    renderModal();
    submit();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(body()).not.toHaveProperty('prompt');
    expect(body()).not.toHaveProperty('schedule');
    // The tool list is always sent — a replacement of the whole grant, which is
    // how a retyped token reaches the platform.
    expect(body()).toHaveProperty('agentTools');
  });

  it('sends the prompt once it differs, and still not the schedule', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Prompt/i), {
      target: { value: 'Summarise the AI news and funding rounds' }
    });
    submit();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(body().prompt).toBe('Summarise the AI news and funding rounds');
    expect(body()).not.toHaveProperty('schedule');
  });

  it('sends the schedule as stored UTC once it differs', async () => {
    renderModal();
    // Through the picker, which is the register a daily cron opens in — and the
    // path a user actually takes.
    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '06:30' } });
    submit();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(body().schedule).toBe('30 6 * * *');
    expect(body()).not.toHaveProperty('prompt');
  });

  it('treats a re-typed identical prompt as untouched', async () => {
    // Whitespace-only differences are not an edit. Sending one would rebuild the
    // trigger to say exactly what it already says.
    renderModal();
    fireEvent.change(screen.getByLabelText(/Prompt/i), {
      target: { value: '  Summarise the AI news  ' }
    });
    submit();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(body()).not.toHaveProperty('prompt');
  });

  it('reports a surviving original as a failure, not a note', async () => {
    // Both triggers alive means the schedule now fires twice, which is the one
    // outcome that must never read as a plain success.
    vi.mocked(api.post).mockResolvedValue({ data: { oldRemoved: false, message: 'Both exist' } });
    renderModal();
    submit();

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Both exist', 'error'));
  });
});
