import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { Wrench } from 'lucide-react';
import { ToolCard } from '../tools/ToolCard';

/**
 * `ToolCard` is now just the header + body shell — no open/closed state of
 * its own. Whether it mounts at all, and whether it is visible once mounted,
 * is `ToolsScreen`'s job (one tool selected via its sidebar, kept mounted
 * hidden afterward). This pins the one thing that stayed the component's own
 * responsibility: render the header and the body it's given, every time.
 */
const Body = ({ onMount }: { onMount: () => void }) => {
  useEffect(onMount, [onMount]);
  return <div data-testid="body">body content</div>;
};

describe('ToolCard', () => {
  it('renders the icon, title, and description alongside the body', () => {
    const onMount = vi.fn();
    render(
      <ToolCard icon={Wrench} title="Schedule tester" description="Type a cron and see what happens.">
        <Body onMount={onMount} />
      </ToolCard>
    );

    expect(screen.getByText('Schedule tester')).toBeInTheDocument();
    expect(screen.getByText('Type a cron and see what happens.')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toBeVisible();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('renders titleAdornment and action when given', () => {
    render(
      <ToolCard
        icon={Wrench}
        title="Schedule tester"
        titleAdornment={<span data-testid="adornment">v2</span>}
        description="Type a cron and see what happens."
        action={<button data-testid="action">Back</button>}
      >
        <div />
      </ToolCard>
    );

    expect(screen.getByTestId('adornment')).toBeInTheDocument();
    expect(screen.getByTestId('action')).toBeInTheDocument();
  });
});
