import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PlatformRunHistory } from '../PlatformRunHistory';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const getMock = vi.mocked(api.get);

beforeEach(() => vi.clearAllMocks());

const show = () => {
  // `retryDelay: 0`, not `retry: false`: the component sets its own `retry`
  // predicate (a 400 means unsupported and must never be retried), so the
  // real predicate has to run — only the waiting between attempts is removed.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformRunHistory taskId="t1" enabled />
    </QueryClientProvider>
  );
};

const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'completed',
  startedAt: '2026-08-25T16:09:10.176Z',
  endedAt: '2026-08-25T16:10:50.785Z',
  outputAvailable: true,
  ...over
});

/** A rejection shaped like axios's, so the 400 branch is exercised for real. */
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

describe('PlatformRunHistory', () => {
  it('renders nothing when the platform publishes no run history', async () => {
    // The route answers 400 by absence for every platform without the verb.
    // Five of six sources are in that state, so an apology block would be a
    // permanent fixture where the real history belongs.
    getMock.mockRejectedValue(httpError(400));
    const { container } = show();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('distinguishes a platform that failed from one with nothing to say', async () => {
    // A 502 is transient and must NOT read as "no runs" — that is the same
    // "looked at nothing vs found nothing" collapse the sync notes exist for.
    getMock.mockRejectedValue(httpError(502));
    show();
    expect(await screen.findByText(/Could not read run history/i)).toBeInTheDocument();
    expect(screen.queryByText(/reports no runs/i)).not.toBeInTheDocument();
  });

  it('says the platform reports no runs when it genuinely reports none', async () => {
    getMock.mockResolvedValue({ data: { runs: [] } } as never);
    show();
    expect(await screen.findByText(/reports no runs for this task yet/i)).toBeInTheDocument();
  });

  it('prints the platform status verbatim rather than mapping it', async () => {
    // `completed` is Gemini's success word and it must survive to the screen —
    // translating it into Cronsole's own vocabulary would be a second judgement
    // about an outcome the platform already named.
    getMock.mockResolvedValue({ data: { runs: [run()] } } as never);
    show();
    expect(await screen.findByText('completed')).toBeInTheDocument();
  });

  it('does not fetch output until a run is opened', async () => {
    // The transcript behind one run is ~90KB. Eager loading would spend a
    // megabyte to render four timestamps.
    getMock.mockResolvedValue({ data: { runs: [run()] } } as never);
    show();
    await screen.findByText('completed');
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalledWith(expect.stringContaining('/output'));
  });

  it('fetches and shows what the run produced, including what it did', async () => {
    getMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/output')
          ? { data: { available: true, output: { text: 'The digest', steps: ['google_search_call', 'write_file'], totalTokens: 199063 } } }
          : { data: { runs: [run()] } }
      ) as never
    );
    show();
    fireEvent.click(await screen.findByText('completed'));

    expect(await screen.findByText('The digest')).toBeInTheDocument();
    // The steps are the field that answers "but did it do what I asked?" — an
    // agent told to email a report finishes `completed` having only written a
    // file, and the status alone can never show that.
    expect(screen.getByText('write_file')).toBeInTheDocument();
    expect(screen.getByText(/199,063 tokens/)).toBeInTheDocument();
  });

  it('gives the reason when a run has no readable output', async () => {
    // "Still running", "produced nothing" and "aged out of the list" are three
    // different true statements, and the reason is the useful half.
    getMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/output')
          ? { data: { available: false, reason: 'This run is still going.' } }
          : { data: { runs: [run()] } }
      ) as never
    );
    show();
    fireEvent.click(await screen.findByText('completed'));
    expect(await screen.findByText('This run is still going.')).toBeInTheDocument();
  });

  it('offers no click on a run with nothing to open', async () => {
    getMock.mockResolvedValue({ data: { runs: [run({ status: 'in_progress', outputAvailable: false })] } } as never);
    show();
    expect((await screen.findByText('in progress')).closest('button')).toBeDisabled();
  });

  it('survives a response body with no runs array', async () => {
    // Defensive rather than theoretical: an older backend, a proxy error page,
    // or a partial deploy all produce this, and a crash here takes the whole
    // task modal down with it.
    getMock.mockResolvedValue({ data: {} } as never);
    show();
    expect(await screen.findByText(/reports no runs for this task yet/i)).toBeInTheDocument();
  });
});
