import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('kaboom');
  return <p>fine</p>;
}

describe('ErrorBoundary', () => {
  it('shows the error instead of a blank page, and recovers when resetKey changes', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="a"><Boom fail /></ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('kaboom');
    expect(screen.queryByText('Reset preferences and reload')).toBeNull();

    rerender(<ErrorBoundary resetKey="b"><Boom fail={false} /></ErrorBoundary>);
    expect(screen.getByText('fine')).toBeInTheDocument();
    quiet.mockRestore();
  });
});
