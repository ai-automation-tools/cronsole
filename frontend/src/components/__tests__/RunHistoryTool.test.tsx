import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RunHistoryTool } from '../tools/RunHistoryTool';
import { openToolCard } from './helpers/toolCard';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const toast = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast }) }));

const renderTool = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RunHistoryTool />
    </QueryClientProvider>
  );
  openToolCard('run-history');
};

const lastCallParams = () => {
  const call = vi.mocked(api.get).mock.calls.at(-1);
  return (call?.[1] as { params?: Record<string, unknown> } | undefined)?.params ?? {};
};

describe('RunHistoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      data: { matched: { runs: 42, succeeded: 38, failed: 4, pending: 0 } }
    } as never);
  });

  // Without this, an empty export reads as "nothing ran" when it means
  // "Cronsole triggered nothing" — a report answering a different question than
  // the one it was asked.
  it('states what the history does and does not contain', async () => {
    renderTool();
    // Split across a <strong>, so match the emphasized claim and the caveat
    // separately rather than the sentence as one node.
    expect(await screen.findByText('Cronsole performed')).toBeInTheDocument();
    expect(screen.getByText(/isn't recorded here/i)).toBeInTheDocument();
    expect(screen.getByText(/not that nothing ran/i)).toBeInTheDocument();
  });

  it('previews how many runs the export will hold before you download it', async () => {
    renderTool();
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('narrows to failures when asked, and re-counts', async () => {
    renderTool();
    await screen.findByText('42');

    fireEvent.click(screen.getByRole('checkbox', { name: /failures and timeouts only/i }));

    await waitFor(() => expect(lastCallParams()).toMatchObject({ status: 'FAILURE,TIMEOUT' }));
  });

  it('changes the period', async () => {
    renderTool();
    await screen.findByText('42');

    fireEvent.change(screen.getByRole('combobox', { name: /period/i }), { target: { value: '7' } });

    await waitFor(() => {
      const params = lastCallParams() as { from?: string; to?: string };
      const spanDays = (new Date(params.to!).getTime() - new Date(params.from!).getTime()) / 86400000;
      expect(Math.round(spanDays)).toBe(7);
    });
  });

  it('disables the download when the filters match nothing', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { matched: { runs: 0, succeeded: 0, failed: 0, pending: 0 } }
    } as never);
    renderTool();

    await waitFor(() => expect(screen.getByRole('button', { name: /download csv/i })).toBeDisabled());
  });
});
