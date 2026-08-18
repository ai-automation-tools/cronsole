import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { vi, describe, it, expect } from 'vitest';
import { ScheduleBuilder } from '../ScheduleBuilder';

/** Controlled the way every real caller wires it: value in, cron out. */
const Harness = ({ initial, onChange }: { initial: string; onChange: (n: string) => void }) => {
  const [value, setValue] = useState(initial);
  return (
    <ScheduleBuilder
      value={value}
      zoneLabel="PDT"
      onChange={next => {
        setValue(next);
        onChange(next);
      }}
    />
  );
};

const renderBuilder = (initial: string) => {
  const onChange = vi.fn();
  render(<Harness initial={initial} onChange={onChange} />);
  return onChange;
};

describe('ScheduleBuilder', () => {
  it('opens on the picker, reading the expression it was given', () => {
    renderBuilder('0 9 * * 1-5');
    expect(screen.getByLabelText('Repeat')).toHaveValue('weekly');
    expect(screen.getByLabelText('Time of day')).toHaveValue('09:00');
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'false');
  });

  /**
   * The property the whole design rests on. `0 9 * * 1-5` compiles back as
   * `0 9 * * 1,2,3,4,5` — same schedule, different string — so a component that
   * normalized on mount or on switching registers would mark every form dirty
   * and rewrite the stored expression of any task merely opened.
   */
  it('writes nothing until something is clicked', () => {
    const onChange = renderBuilder('0 9 * * 1-5');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cron' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('0 9 * * 1-5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Simple' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('compiles a time change to cron', () => {
    const onChange = renderBuilder('0 9 * * *');
    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '17:30' } });
    expect(onChange).toHaveBeenCalledWith('30 17 * * *');
  });

  it('ignores a half-typed time instead of writing a schedule with no time', () => {
    const onChange = renderBuilder('0 9 * * *');
    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Time of day')).toHaveValue('09:00');
  });

  it('keeps the clock time when the frequency changes', () => {
    const onChange = renderBuilder('45 14 * * *');
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
    expect(onChange).toHaveBeenCalledWith('45 14 * * 1,2,3,4,5');
  });

  it('toggles weekdays', () => {
    const onChange = renderBuilder('0 9 * * 1');
    fireEvent.click(screen.getByRole('button', { name: 'Saturday' }));
    expect(onChange).toHaveBeenLastCalledWith('0 9 * * 1,6');
  });

  // A weekly schedule with no day is not a schedule, and the cron it would
  // compile to is four fields — so the API would answer a checkbox with a
  // complaint about cron syntax.
  it('refuses to untick the last weekday', () => {
    const onChange = renderBuilder('0 9 * * 1');
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('builds a monthly schedule, and says what a short month does', () => {
    const onChange = renderBuilder('0 9 * * *');
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'monthly' } });
    expect(onChange).toHaveBeenLastCalledWith('0 9 1 * *');

    fireEvent.change(screen.getByLabelText('Day of the month'), { target: { value: '31' } });
    expect(onChange).toHaveBeenLastCalledWith('0 9 31 * *');
    expect(screen.getByText(/skipped, not clamped/i)).toBeInTheDocument();
  });

  it('folds plain hourly and every-N-hours into one control', () => {
    const onChange = renderBuilder('15 * * * *');
    expect(screen.getByLabelText('Repeat')).toHaveValue('hours');
    expect(screen.getByLabelText('Hours between runs')).toHaveValue(1);
    expect(screen.getByLabelText('Minute past the hour')).toHaveValue(15);

    fireEvent.change(screen.getByLabelText('Hours between runs'), { target: { value: '6' } });
    expect(onChange).toHaveBeenLastCalledWith('15 */6 * * *');
  });

  /**
   * Unavailable, never approximate. Snapping `0 9-17 * * 1-5` to the nearest
   * shape would silently narrow a schedule the user opened to read, and the
   * narrowing would look like something they did.
   */
  it('disables the picker for an expression that has no picker form', () => {
    renderBuilder('0 9-17 * * 1-5');
    expect(screen.getByRole('button', { name: 'Simple' })).toBeDisabled();
    expect(screen.getByDisplayValue('0 9-17 * * 1-5')).toBeInTheDocument();
    expect(screen.getByText(/no simple form/i)).toBeInTheDocument();
  });

  it('takes a preset in either register', () => {
    const onChange = renderBuilder('0 9 * * *');
    fireEvent.click(screen.getByRole('button', { name: /Hourly$/ }));
    expect(onChange).toHaveBeenLastCalledWith('0 * * * *');
  });

  // The zone is authored-in, not stored — so it has to be legible where the
  // clock time is picked, not only in the hint below the field.
  it('names the zone beside the clock', () => {
    renderBuilder('0 9 * * *');
    expect(screen.getAllByText('PDT').length).toBeGreaterThan(0);
  });
});
