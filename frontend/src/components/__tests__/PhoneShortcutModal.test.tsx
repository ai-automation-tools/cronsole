import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import { PhoneShortcutModal } from '../PhoneShortcutModal';
import { api } from '../../api';
import type { Task } from '../../types';

vi.mock('../../api', () => ({
  api: { post: vi.fn() },
  API_ORIGIN: 'http://localhost:8080'
}));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const task = { id: 'task_1', name: 'Agent-Chat Weekly Roadmap', platform: 'WINDOWS_TASK_SCHEDULER' } as Task;

const renderModal = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PhoneShortcutModal task={task} onClose={() => {}} />
    </QueryClientProvider>
  );

describe('PhoneShortcutModal', () => {
  // The scope is the whole safety argument: a token without `runTaskId` would be
  // a full-account credential sitting in a phone shortcut.
  it('requests a token scoped to this task and shows the run URL for the phone address', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { token: 'tok.abc' } });
    renderModal();

    // Issued from the desktop, the default is loopback — warned about, then fixed.
    expect(screen.getByText(/localhost is the phone/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Address your phone uses/), { target: { value: 'https://my-pc.ts.net/' } });
    expect(screen.queryByText(/localhost is the phone/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /Create shortcut token/ }));

    await waitFor(() => expect(screen.getByText('https://my-pc.ts.net/api/tasks/task_1/run')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/auth/tokens', expect.objectContaining({ runTaskId: 'task_1', password: 'pw' }));
    expect(screen.getByText('Bearer tok.abc')).toBeInTheDocument();
    expect(screen.getByText(/the agent started it/)).toBeInTheDocument();
  });
});
