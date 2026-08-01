import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewBar } from '../ViewBar';
import { BUILTIN_VIEWS, type SavedView } from '../../utils/savedViews';
import { DEFAULT_FILTERS } from '../../utils/taskFilters';

const mine: SavedView = { id: 'v-mine', name: 'Nightly backups', filters: DEFAULT_FILTERS };

const setup = (over: Partial<Parameters<typeof ViewBar>[0]> = {}) => {
  const props = {
    views: [...BUILTIN_VIEWS, mine],
    activeViewId: 'my-jobs' as string | null,
    counts: new Map<string, number | null>(BUILTIN_VIEWS.map(v => [v.id, 3])),
    currentDescription: 'active only · hides system tasks',
    onSelect: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onReset: vi.fn(),
    ...over
  };
  render(<ViewBar {...props} />);
  return props;
};

// Anchored at the start on purpose: a user view renders a chip AND a delete
// button whose label also contains the view's name, so an unanchored /name/
// matches both.
const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('ViewBar', () => {
  it('renders every view and marks the active one', () => {
    setup();
    expect(chip('My jobs')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Failures')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Nightly backups')).toBeInTheDocument();
  });

  it('shows an en dash, not a zero, for a count it cannot yet evidence', () => {
    // The load-bearing assertion. `0` beside "Failures" asserts that nothing is
    // failing; the health scan simply has not landed. Those are different
    // claims and only one of them is true.
    setup({ counts: new Map([['failures', null], ['my-jobs', 12]]) });
    expect(chip("Failures")).toHaveTextContent('–');
    expect(chip("Failures")).not.toHaveTextContent('0');
    expect(chip("My jobs")).toHaveTextContent('12');
  });

  it('still shows a real zero when the count is known to be zero', () => {
    setup({ counts: new Map([['failures', 0]]) });
    expect(chip("Failures")).toHaveTextContent('0');
  });

  it('selects a view', () => {
    const props = setup();
    fireEvent.click(chip("Failures"));
    expect(props.onSelect).toHaveBeenCalledWith(BUILTIN_VIEWS.find(v => v.id === 'failures'));
  });

  it('shows Custom when no view matches', () => {
    const props = setup({ activeViewId: null });
    expect(screen.getByText('Custom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reset filters/ }));
    expect(props.onReset).toHaveBeenCalled();
  });

  it('hides Custom while a view matches', () => {
    setup({ activeViewId: 'my-jobs' });
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
  });

  it('offers Save view for an unnamed combination', () => {
    setup({ activeViewId: null });
    expect(screen.getByRole('button', { name: /Save view/ })).toBeInTheDocument();
  });

  it('does not offer Save view for a combination that already has a name', () => {
    // Saving a second copy of "Failures" under another name is how a view list
    // stops being worth reading.
    setup({ activeViewId: 'failures' });
    expect(screen.queryByRole('button', { name: /Save view/ })).not.toBeInTheDocument();
  });

  it('saves a named view and refuses a blank name', () => {
    const props = setup({ activeViewId: null });
    fireEvent.click(screen.getByRole('button', { name: /Save view/ }));

    const input = screen.getByLabelText('Name this view');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(props.onSave).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Weekend jobs' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSave).toHaveBeenCalledWith('Weekend jobs');
  });

  it('deletes only user views — built-ins have no delete control', () => {
    const props = setup();
    expect(screen.queryByRole('button', { name: /Delete the "Failures" view/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Delete the "Nightly backups" view/ }));
    expect(props.onDelete).toHaveBeenCalledWith(mine);
  });
});
