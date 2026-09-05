import type { LucideIcon } from 'lucide-react';

export interface CategoryNavItem<Id extends string> {
  id: Id;
  label: string;
  Icon: LucideIcon;
  /** Optional population count, rendered beside the label (the Sources tab's
   *  "count is part of the label" rule) — omit it for destinations that
   *  govern nothing countable, like Settings' categories or Tools' tools. */
  count?: number;
  /** Tooltip — what this destination is, in one line. */
  hint?: string;
}

/**
 * A screen's own left-hand category nav — Settings' Account/Connections/…,
 * Tools' ten tools. Vertical and sticky at `md:` and up, so one category's
 * content fills the main area instead of the screen being one long scroll of
 * every category stacked. Below `md` it is still vertical, just not sticky
 * and not width-constrained: a full-width stacked list, one row per
 * category. A horizontal scrollable strip shipped here first (2026-09-04)
 * and cut every row off mid-item at the screen edge with no affordance
 * hinting there was more to swipe to — indistinguishable from a rendering
 * bug on a real phone. Every category fits in the normal page scroll
 * instead, at the cost of more vertical space than a strip would take.
 *
 * `?section=`/`?tool=` is real navigation (the `SourcesScreen` `?focus=`
 * contract), not local `useState` — a reload or a shared link lands on the
 * same category instead of always resetting to the first one. Each screen
 * owns its own query param name and read/fallback function; this component
 * only ever sees the resolved `active` id.
 */
export const CategoryNav = <Id extends string>({ items, active, onSelect, ariaLabel }: {
  items: readonly CategoryNavItem<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  ariaLabel: string;
}) => {
  const itemClass = (selected: boolean) =>
    `flex items-center gap-2.5 rounded-xl text-sm font-bold transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      selected
        ? 'bg-raised text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground hover:bg-raised/50'
    }`;

  const countClass = (selected: boolean) =>
    `text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md transition-colors duration-150 ${
      selected ? 'bg-foreground/10 text-foreground' : 'bg-foreground/5 text-subtle-foreground'
    }`;

  return (
    <>
      <nav aria-label={ariaLabel} className="hidden md:flex md:w-52 shrink-0 flex-col gap-1 sticky top-6 self-start">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === active ? 'page' : undefined}
            title={item.hint}
            onClick={() => onSelect(item.id)}
            className={`${itemClass(item.id === active)} px-3 py-2.5 text-left justify-between`}
          >
            <span className="flex items-center gap-2.5">
              <item.Icon size={16} className="shrink-0" />
              {item.label}
            </span>
            {item.count !== undefined && <span className={countClass(item.id === active)}>{item.count}</span>}
          </button>
        ))}
      </nav>

      {/* Below md: a full-width stacked list, same row shape as the desktop
          sidebar minus the sticky/width constraints — every category sits in
          the page's own scroll rather than behind an off-screen swipe. */}
      <div className="md:hidden flex flex-col gap-1 w-full">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === active ? 'page' : undefined}
            title={item.hint}
            onClick={() => onSelect(item.id)}
            className={`${itemClass(item.id === active)} w-full px-3 py-2.5 text-left justify-between`}
          >
            <span className="flex items-center gap-2.5">
              <item.Icon size={16} className="shrink-0" />
              {item.label}
            </span>
            {item.count !== undefined && <span className={countClass(item.id === active)}>{item.count}</span>}
          </button>
        ))}
      </div>
    </>
  );
};
