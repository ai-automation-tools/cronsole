import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

// The second field updates parent state, and the parent passes an inline onClose.
// Focus used to jump back to the first field after one character.
const Harness = () => {
  const [value, setValue] = useState('');
  return (
    <Modal onClose={() => {}}>
      <input aria-label="first" />
      <input aria-label="second" value={value} onChange={e => setValue(e.target.value)} />
    </Modal>
  );
};

describe('Modal', () => {
  it('keeps focus in the field being typed in when the parent re-renders', () => {
    render(<Harness />);
    const second = screen.getByLabelText('second');
    second.focus();
    fireEvent.change(second, { target: { value: 'a' } });
    expect(second).toHaveValue('a');
    expect(second).toHaveFocus();
  });
});
