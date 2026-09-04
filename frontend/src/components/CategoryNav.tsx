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
 * every category stacked. Below `md` it becomes the same horizontal
 * scrollable strip `SourceTabs` uses, minus counts: these are destinations,
 * not populations, so there is nothing to report a size for.
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

      {/* Scrolls rather than wraps below 375px — a control that reflows onto
          two rows stops reading as one control (the SourceTabs rule). */}
      <div className="md:hidden overflow-x-auto -mx-4 px-4 pb-1">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/40 border border-border w-max">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === active ? 'page' : undefined}
              title={item.hint}
              onClick={() => onSelect(item.id)}
              className={`${itemClass(item.id === active)} px-3 py-2 whitespace-nowrap text-xs`}
            >
              <item.Icon size={14} className="shrink-0" />
              {item.label}
              {item.count !== undefined && <span className={countClass(item.id === active)}>{item.count}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};
