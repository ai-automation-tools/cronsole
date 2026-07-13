import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { ConfirmProvider } from '../ConfirmProvider';
import { useConfirm } from '../useConfirm';

function Consumer() {
  const confirm = useConfirm();
  const [result, setResult] = useState('none');
  return (
    <div>
      <button
        onClick={async () =>
          setResult(
            String(
              await confirm({
                title: 'Delete task?',
                message: 'Are you sure?',
                confirmText: 'Delete',
                tone: 'danger'
              })
            )
          )
        }
      >
        ask
      </button>
      <span data-testid="result">{result}</span>
    </div>
  );
}

const setup = () =>
  render(
    <ConfirmProvider>
      <Consumer />
    </ConfirmProvider>
  );

describe('ConfirmProvider / useConfirm', () => {
  it('opens an accessible alertdialog with the given title and message', async () => {
    setup();
    fireEvent.click(screen.getByText('ask'));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Delete task?')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('focuses the Cancel button first (so a stray Enter cancels)', async () => {
    setup();
    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('alertdialog');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    );
  });

  it('resolves true when the confirm action is clicked', async () => {
    setup();
    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when cancelled', async () => {
    setup();
    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
  });

  it('resolves false when Escape is pressed', async () => {
    setup();
    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('alertdialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
