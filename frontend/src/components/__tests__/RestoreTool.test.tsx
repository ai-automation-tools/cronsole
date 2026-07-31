import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RestoreTool } from '../tools/RestoreTool';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn() }
}));

const toast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast })
}));

const planResponse = (overrides: Partial<{
  items: unknown[];
  foldersToCreate: string[];
  counts: Record<string, number>;
}> = {}) => ({
  data: {
    dryRun: true,
    plan: {
      items: [
        { relativePath: 'Work/Nightly.xml', taskPath: '\\Work\\Nightly', source: 'manifest', name: 'Nightly', action: 'create', foldersToCreate: ['\\Work'] },
        { relativePath: 'Cronsole/Ping.xml', taskPath: '\\Cronsole\\Ping', source: 'manifest', name: 'Ping', action: 'skip', reason: 'A task already exists at this path.', foldersToCreate: [] }
      ],
      foldersToCreate: ['\\Work'],
      counts: { files: 2, create: 1, overwrite: 0, skip: 1, refuse: 0 },
      ...overrides
    }
  }
});

/** Drop files onto the hidden "choose files" input, the way a picker would. */
const chooseFiles = (files: File[]) => {
  const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

const xmlFile = (name: string) =>
  new File([new Uint8Array([0xff, 0xfe, 0x3c, 0x00])], name, { type: 'text/xml' });

describe('RestoreTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockResolvedValue(planResponse() as never);
  });

  it('runs a dry run first and writes nothing until the user commits', async () => {
    // The load-bearing behavior: picking files must never be a write. Every
    // checkbox on this card widens what a click can destroy or create, so the
    // plan has to come first.
    render(<RestoreTool />);
    chooseFiles([xmlFile('Nightly.xml')]);

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls.every(call => (call[1] as { dryRun: boolean }).dryRun === true)).toBe(true);
  });

  it('shows what would change before offering the button that changes it', async () => {
    render(<RestoreTool />);
    chooseFiles([xmlFile('Nightly.xml')]);

    expect(await screen.findByText(/will change 1 task on this machine/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore 1 task/i })).toBeInTheDocument();
  });

  it('names every folder it would create, because that is a standing invariant being waived', async () => {
    render(<RestoreTool />);
    chooseFiles([xmlFile('Nightly.xml')]);

    expect(await screen.findByText(/1 folder will be created/i)).toBeInTheDocument();
    expect(screen.getByText('\\Work')).toBeInTheDocument();
  });

  it('defaults to not overwriting, and re-plans when that changes', async () => {
    render(<RestoreTool />);
    chooseFiles([xmlFile('Nightly.xml')]);
    await screen.findByText(/will change 1 task/i);

    const overwrite = screen.getByRole('checkbox', { name: /overwrite tasks that already exist/i });
    expect(overwrite).not.toBeChecked();

    vi.mocked(api.post).mockResolvedValue(
      planResponse({ counts: { files: 2, create: 1, overwrite: 1, skip: 0, refuse: 0 } }) as never
    );
    fireEvent.click(overwrite);

    // A stale plan next to a changed checkbox would be a screen that disagrees
    // with the button under it.
    await waitFor(() =>
      expect(vi.mocked(api.post).mock.calls.at(-1)?.[1]).toMatchObject({ overwrite: true, dryRun: true })
    );
    expect(await screen.findByText(/will change 2 tasks on this machine/i)).toBeInTheDocument();
  });

  it('warns when a destination was guessed from the filename', async () => {
    vi.mocked(api.post).mockResolvedValue(
      planResponse({
        items: [
          { relativePath: 'Nightly.xml', taskPath: '\\Nightly', source: 'filename', name: 'Nightly', action: 'create', foldersToCreate: [] }
        ],
        counts: { files: 1, create: 1, overwrite: 0, skip: 0, refuse: 0 },
        foldersToCreate: []
      }) as never
    );

    render(<RestoreTool />);
    chooseFiles([xmlFile('Nightly.xml')]);

    // Twice on purpose — once as a banner over the whole plan, once on the row
    // itself. The banner is what gets read; the row is what gets checked.
    expect(await screen.findByText(/carried no export manifest and no path inside the XML/i)).toBeInTheDocument();
    expect(screen.getByText(/Destination worked out from the filename/i)).toBeInTheDocument();
  });

  it('reports refusals rather than a bare failure', async () => {
    vi.mocked(api.post).mockResolvedValue(
      planResponse({
        items: [
          {
            relativePath: 'Microsoft/Defender.xml',
            taskPath: '\\Microsoft\\Defender',
            source: 'uri',
            name: 'Defender',
            action: 'refuse',
            reason: 'Refusing to restore under \\Microsoft\\ — Windows keeps its own scheduled tasks there.',
            foldersToCreate: []
          }
        ],
        counts: { files: 1, create: 0, overwrite: 0, skip: 0, refuse: 1 },
        foldersToCreate: []
      }) as never
    );

    render(<RestoreTool />);
    chooseFiles([xmlFile('Defender.xml')]);

    expect(await screen.findByText(/would change nothing on this machine/i)).toBeInTheDocument();
    expect(screen.getByText(/Windows keeps its own scheduled tasks there/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore 0 tasks/i })).toBeDisabled();
  });

  it('commits with the chosen options and reports the outcome per task', async () => {
    render(<RestoreTool />);
    chooseFiles([xmlFile('Nightly.xml')]);
    await screen.findByText(/will change 1 task/i);

    vi.mocked(api.post).mockResolvedValue({
      data: {
        dryRun: false,
        counts: { files: 2, created: 1, replaced: 0, skipped: 1, refused: 0, foldersCreated: ['\\Work'] },
        results: [
          { relativePath: 'Work/Nightly.xml', taskPath: '\\Work\\Nightly', name: 'Nightly', action: 'create', outcome: 'created', foldersCreated: ['\\Work'] },
          { relativePath: 'Cronsole/Ping.xml', taskPath: '\\Cronsole\\Ping', name: 'Ping', action: 'skip', outcome: 'exists', message: 'A task already exists at this path.', foldersCreated: [] }
        ]
      }
    } as never);

    fireEvent.click(screen.getByRole('button', { name: /restore 1 task/i }));

    await waitFor(() =>
      expect(vi.mocked(api.post).mock.calls.at(-1)?.[1]).toMatchObject({
        dryRun: false,
        overwrite: false,
        createFolders: true
      })
    );
    expect(await screen.findByText(/Restored 1 of 2 files/i)).toBeInTheDocument();
    // Restoring puts a task on the machine; it does not make Cronsole track it.
    expect(screen.getByText(/Import them from the Dashboard/i)).toBeInTheDocument();
  });
});
