import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TaskExportMenu } from '../TaskExportMenu';
import type { Task } from '../../types';

/**
 * The menu's whole job is telling two formats apart, so the tests are about the
 * words, not the plumbing. A menu that offered "XML" and "JSON" would be
 * accurate and useless — the extension is the half a reader cannot act on.
 */
const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    name: 'Nightly digest',
    platform: 'WINDOWS_TASK_SCHEDULER',
    category: 'Work',
    schedule: '0 4 * * *',
    status: 'ACTIVE',
    externalId: '\\Cronsole\\Nightly digest',
    ...over
  }) as Task;

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Export/ }));

describe('TaskExportMenu', () => {
  const onExport = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  it('names each option by what it is FOR, not by its file extension', () => {
    render(<TaskExportMenu task={task()} onExport={onExport} exporting={false} />);
    openMenu();

    expect(screen.getByText(/Restores onto any Windows PC/)).toBeInTheDocument();
    expect(screen.getByText(/Recreate this task on any install/)).toBeInTheDocument();
  });

  it('says what the portable format gives up, before the click', () => {
    // Lossy by design. A user who learns that after restoring onto a machine
    // has learned it too late — the task is already running as the wrong account.
    render(<TaskExportMenu task={task()} onExport={onExport} exporting={false} />);
    openMenu();

    expect(screen.getByText(/Drops platform-specific settings/)).toBeInTheDocument();
    expect(screen.getByText(/adds nothing to your template library/)).toBeInTheDocument();
  });

  it('describes "native" per platform, since it is not one thing', () => {
    const { unmount } = render(<TaskExportMenu task={task()} onExport={onExport} exporting={false} />);
    openMenu();
    expect(screen.getByText('Windows Task Scheduler XML')).toBeInTheDocument();
    unmount();

    render(<TaskExportMenu task={task({ platform: 'TASKHUB_NATIVE' })} onExport={onExport} exporting={false} />);
    openMenu();
    expect(screen.getByText('Cronsole task JSON')).toBeInTheDocument();
  });

  it('offers the portable format on a platform with no native definition, and says why', () => {
    // Claude: the routine lives at claude.ai, so there is nothing to fetch — but
    // the template still describes what it runs. The old button was hidden
    // entirely here, which left no way to ask.
    render(<TaskExportMenu task={task({ platform: 'CLAUDE_CODE' })} onExport={onExport} exporting={false} />);
    openMenu();

    expect(screen.getByText(/nothing native to download/)).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Portable template/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Task Scheduler XML/ })).not.toBeInTheDocument();
  });

  it('passes the format through and closes', () => {
    render(<TaskExportMenu task={task()} onExport={onExport} exporting={false} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Portable template/ }));

    expect(onExport).toHaveBeenCalledWith('template');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('sends "native" for the platform option', () => {
    render(<TaskExportMenu task={task()} onExport={onExport} exporting={false} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Task Scheduler XML/ }));

    expect(onExport).toHaveBeenCalledWith('native');
  });

  it('closes on Escape without letting the task modal see it', () => {
    // The menu is the innermost thing open; if the keypress propagated, the
    // modal underneath would close too and the user would lose the task.
    const onKey = vi.fn();
    document.addEventListener('keydown', onKey, true);
    render(<TaskExportMenu task={task()} onExport={onExport} exporting={false} />);
    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    document.removeEventListener('keydown', onKey, true);
  });
});
