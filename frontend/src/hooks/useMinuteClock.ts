import { useEffect, useState } from 'react';

/**
 * A clock that advances once a minute.
 *
 * The dashboard's date-sensitive filters ("due today", "overdue") need a single
 * instant that every predicate and every count in a render agrees on — reading
 * `new Date()` in each one lets the list and the number beside it straddle
 * midnight and disagree. But a fresh `Date` per render is a new object each
 * time, which would invalidate every downstream `useMemo` and re-filter 350
 * tasks on each keystroke.
 *
 * So the value is held in state and replaced on an interval: referentially
 * stable while the minute holds, and it advances on its own afterwards, so a
 * dashboard left open overnight does not keep answering "due today" about
 * yesterday. Reading the clock during render would be neither — and is a purity
 * violation besides, since it makes the render's output depend on when it ran.
 *
 * A minute is the resolution these filters need; they ask about calendar days.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return now;
}
