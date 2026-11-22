import { describe, expect, it } from 'vitest';
import { nextRunText } from '../datetime';

const now = new Date('2026-11-13T12:00:00Z');
const at = (mins: number) => new Date(now.getTime() + mins * 60000);

describe('nextRunText', () => {
  it('counts down inside a day', () => {
    expect(nextRunText(at(92), 'UTC', now)).toMatch(/^In 1h 32m \(.+\)/);
    expect(nextRunText(at(5), 'UTC', now)).toMatch(/^In 5m \(/);
  });

  it('names the day beyond one, and says overdue once past', () => {
    expect(nextRunText(at(3 * 1440), 'UTC', now)).not.toMatch(/^In /);
    expect(nextRunText(at(-10), 'UTC', now)).toMatch(/^Overdue \(/);
  });
});
