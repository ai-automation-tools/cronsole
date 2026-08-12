import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const addMutate = vi.fn();
const removeMutate = vi.fn();
const editMutate = vi.fn();
let routines: any[] = [];

vi.mock('../../hooks/useClaudeRoutines', () => ({
  useClaudeRoutines: () => ({ data: routines, isLoading: false }),
  useAddClaudeRoutine: () => ({ mutateAsync: addMutate, isPending: false }),
  useEditClaudeRoutine: () => ({ mutateAsync: editMutate, isPending: false }),
  useRemoveClaudeRoutine: () => ({ mutateAsync: removeMutate, isPending: false })
}));

import { ClaudeRoutinesPanel } from '../ClaudeRoutinesPanel';

/**
 * This panel is the only place in Cronsole a user types a live third-party
 * secret, and the only platform whose connection cannot be discovered. Both are
 * easy to erode with a well-meaning "improvement", so both are pinned.
 */

beforeEach(() => {
  routines = [];
  addMutate.mockReset().mockResolvedValue({ routine: { id: 'trig_1', hasToken: true, taskCount: 0 }, replaced: false, warnings: [] });
  removeMutate.mockReset().mockResolvedValue({ removed: 'trig_1', orphanedTasks: 0 });
  editMutate.mockReset().mockResolvedValue({
    routine: { id: 'trig_1', hasToken: true, taskCount: 0 },
    idChanged: true, previousId: 'old', tasksRepointed: 1, warnings: []
  });
});

describe('correcting a routine costs no token', () => {
  // The real case: a routine connected with its NAME pasted into the id field.
  const bad = [{ id: 'Refresh sidebar links', name: 'Refresh sidebar links', hasToken: true, taskCount: 1 }];

  it('offers an edit next to remove', () => {
    routines = bad;
    render(<ClaudeRoutinesPanel />);
    expect(screen.getByRole('button', { name: /Edit Refresh sidebar links/i })).toBeInTheDocument();
  });

  it('never asks for the token again', () => {
    // The absence IS the feature: disconnect-and-reconnect discards the stored
    // credential, and claude.ai shows a token once — so fixing a typo the cheap
    // way would force the expensive recovery.
    routines = bad;
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Edit Refresh sidebar links/i }));

    expect(screen.getByText(/The stored token is kept/i)).toBeInTheDocument();
    // The add form's token field must not be on screen while editing.
    expect(screen.queryByLabelText('API token')).not.toBeInTheDocument();
  });

  it('sends only what changed, and says the task moves with the id', async () => {
    routines = bad;
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Edit Refresh sidebar links/i }));

    expect(screen.getByText(/1 tracked task will move with the id/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), {
      target: { value: 'trig_01PDsoqCPPUpFUzJryoeTY6J' }
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(editMutate).toHaveBeenCalledWith({
        routineId: 'Refresh sidebar links',
        id: 'trig_01PDsoqCPPUpFUzJryoeTY6J'
      })
    );
    // The name was untouched, so it must not be sent as a change.
    expect(editMutate.mock.calls[0][0]).not.toHaveProperty('name');
  });

  it('does not call the API when nothing was changed', async () => {
    routines = bad;
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Edit Refresh sidebar links/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(screen.queryByText(/The stored token is kept/i)).not.toBeInTheDocument());
    expect(editMutate).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.restoreAllMocks());

describe('the token is write-only', () => {
  it('says a token is stored without rendering a maskable value', () => {
    // Not a row of dots: dots imply there is something to reveal, and there
    // isn't — the server never returns the token, and claude.ai cannot
    // re-display it either. Regenerating is the only recovery.
    routines = [{ id: 'trig_1', name: 'Nightly', hasToken: true, taskCount: 0 }];
    render(<ClaudeRoutinesPanel />);

    expect(screen.getByText('Token stored')).toBeInTheDocument();
    expect(screen.queryByText(/•{3,}|\*{3,}/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reveal|show token/i })).not.toBeInTheDocument();
  });

  it('masks the token field while it is being typed', () => {
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add a routine/i }));
    expect(screen.getByLabelText('API token')).toHaveAttribute('type', 'password');
    // The id is not a secret and stays readable — masking it would only make a
    // paste impossible to check.
    expect(screen.getByLabelText('Routine id or fire URL')).toHaveAttribute('type', 'text');
  });
});

describe('removing is not deleting', () => {
  it('never offers to delete the routine itself', () => {
    // Cronsole has no API to delete or stop a Claude routine. A "Delete" label
    // would let someone believe they had stopped a nightly job that is still
    // firing — the invisible-fence failure in reverse.
    routines = [{ id: 'trig_1', name: 'Nightly', hasToken: true, taskCount: 0 }];
    render(<ClaudeRoutinesPanel />);

    expect(screen.getByRole('button', { name: /remove Nightly from Cronsole/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
  });

  it('says where the routine keeps running, and what removing it strands', async () => {
    routines = [{ id: 'trig_1', name: 'Nightly', hasToken: true, taskCount: 3 }];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ClaudeRoutinesPanel />);

    fireEvent.click(screen.getByRole('button', { name: /remove Nightly from Cronsole/i }));

    const message = confirm.mock.calls[0][0] as string;
    expect(message).toMatch(/keeps running at claude\.ai/i);
    // Counted before the click, not reported after it.
    expect(message).toMatch(/3 tracked tasks/);
    await waitFor(() => expect(removeMutate).toHaveBeenCalledWith('trig_1'));
  });

  it('does nothing when the confirmation is declined', () => {
    routines = [{ id: 'trig_1', name: 'Nightly', hasToken: true, taskCount: 0 }];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ClaudeRoutinesPanel />);

    fireEvent.click(screen.getByRole('button', { name: /remove Nightly from Cronsole/i }));
    expect(removeMutate).not.toHaveBeenCalled();
  });
});

describe('adding a routine', () => {
  it('explains that Cronsole cannot find routines by itself', () => {
    // The absence of a Sync button is not self-explanatory on a tab where every
    // other platform has one.
    render(<ClaudeRoutinesPanel />);
    expect(screen.getByText(/no API to list your routines/i)).toBeInTheDocument();
  });

  it('will not submit without both an id and a token', () => {
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add a routine/i }));

    const submit = screen.getByRole('button', { name: /add routine/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: 'trig_1' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'sk-ant-oat01-x' } });
    expect(submit).toBeEnabled();
  });

  it('sends what was typed, trimmed, and omits an empty name', async () => {
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add a routine/i }));
    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: '  trig_1  ' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: ' sk-ant-oat01-x ' } });
    fireEvent.click(screen.getByRole('button', { name: /add routine/i }));

    await waitFor(() =>
      expect(addMutate).toHaveBeenCalledWith({ id: 'trig_1', token: 'sk-ant-oat01-x' })
    );
  });

  it('surfaces a shape warning as advice, not a failure', async () => {
    addMutate.mockResolvedValue({
      routine: { id: 'weird', hasToken: true, taskCount: 0 },
      replaced: false,
      warnings: ['"weird" does not look like a routine id']
    });
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add a routine/i }));
    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: 'weird' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /add routine/i }));

    await waitFor(() => expect(screen.getByText(/does not look like a routine id/i)).toBeInTheDocument());
    expect(screen.getByText(/Saved anyway/i)).toBeInTheDocument();
  });

  it('shows the server error and keeps the form open on failure', async () => {
    addMutate.mockRejectedValue({ response: { data: { error: 'Could not read a routine id from that.' } } });
    render(<ClaudeRoutinesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add a routine/i }));
    fireEvent.change(screen.getByLabelText('Routine id or fire URL'), { target: { value: 'https://claude.ai/code/routines' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /add routine/i }));

    await waitFor(() => expect(screen.getByText(/Could not read a routine id/i)).toBeInTheDocument());
    // The typed token must survive the error — retyping a once-shown secret is
    // not something a user can necessarily do twice.
    expect(screen.getByLabelText('API token')).toHaveValue('x');
  });
});
