import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { ToolCard } from '../tools/ToolCard';

/**
 * A stand-in tool body that reports when it mounts and holds a scrap of state.
 *
 * Both matter: the whole point of closing a card is that its body — and the
 * queries every real body fires on mount — has not run yet, and the whole point
 * of *keeping* it mounted afterwards is that closing a card must not throw away
 * what the user was in the middle of.
 */
const Body = ({ onMount }: { onMount: () => void }) => {
  const [text, setText] = useState('');
  useEffect(onMount, [onMount]);
  return (
    <div data-testid="body">
      <input aria-label="scratch" value={text} onChange={e => setText(e.target.value)} />
    </div>
  );
};

const renderCard = (id: string, onMount = vi.fn()) => {
  const { unmount } = render(
    <ToolCard id={id} icon={Wrench} title="Schedule tester" description="Type a cron and see what happens.">
      <Body onMount={onMount} />
    </ToolCard>
  );
  return { onMount, unmount, toggle: () => screen.getByTestId(`tool-disclosure-${id}`) };
};

// Every test uses its own id: the open/closed preference is a module-level
// settings store, so a shared id would leak one test's state into the next.
describe('ToolCard', () => {
  it('shows the name and description but nothing else, and never mounts the body, until it is opened', () => {
    const { onMount, toggle } = renderCard('closed-by-default');

    expect(screen.getByText('Schedule tester')).toBeInTheDocument();
    expect(screen.getByText('Type a cron and see what happens.')).toBeInTheDocument();
    expect(screen.queryByTestId('body')).not.toBeInTheDocument();
    expect(onMount).not.toHaveBeenCalled();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on the disclosure', () => {
    const { onMount, toggle } = renderCard('opens');

    fireEvent.click(toggle());

    expect(screen.getByTestId('body')).toBeVisible();
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides the body on close without unmounting it, so work in progress survives', () => {
    const { onMount, toggle } = renderCard('keeps-state');

    fireEvent.click(toggle());
    fireEvent.change(screen.getByLabelText('scratch'), { target: { value: '0 4 * * *' } });
    fireEvent.click(toggle());

    expect(screen.getByTestId('body')).not.toBeVisible();

    fireEvent.click(toggle());
    expect(screen.getByLabelText('scratch')).toHaveValue('0 4 * * *');
    // Still one mount: it was hidden, not rebuilt.
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('remembers that it was open, so a tab switch does not close it', () => {
    const first = renderCard('remembers');
    fireEvent.click(first.toggle());
    first.unmount();

    // A fresh mount of the same card — what returning to the Tools tab does.
    const second = renderCard('remembers', vi.fn());
    expect(second.toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(second.onMount).toHaveBeenCalledTimes(1);
  });
});
