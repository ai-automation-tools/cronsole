import { useRef, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The Sources tab's own navigation: connected · available · quick links.
 *
 * **This replaced a smooth scroll to an anchor** (2026-08-24). The rail's
 * *Explore* and *Manage* buttons used to arrive with `?focus=` and the screen
 * scrolled — which reads as the page moving on its own rather than as having
 * gone anywhere, and left every section on one column so a fresh install
 * scrolled past four long cards to reach a bookmark. The `?focus=` contract is
 * unchanged; it now selects a view instead of a scroll target, so a reload and
 * a shared link both land where they say they will.
 *
 * **The count is part of the label, and it governs exactly what the tab holds.**
 * A number beside a control describes the population that control governs
 * (CLAUDE.md §9) — so *Connected 3* is three connected sources, never three
 * sources of which some are connected.
 *
 * A tab may legitimately read `0`: "nothing is connected yet" is a destination
 * with something to say, and hiding the tab would make an empty install
 * indistinguishable from a broken one. That is the rail's rule for its own
 * nodes, and this is navigation for the same reason.
 *
 * **Vertical sidebar at `md:` and up** (2026-09-05) — the same shape as
 * `CategoryNav` (Settings, Tools), so the three tabbed screens read as one
 * pattern rather than two. This stays its own component instead of folding
 * into `CategoryNav` because the count-in-the-label and the roving-tabindex
 * keyboard nav are both real tablist semantics `CategoryNav`'s plain button
 * list does not carry — collapsing them would either drop the count or drop
 * `role="tab"`/arrow-key movement, and there is only one consumer to serve.
 */

export interface SourceTabDef<Id extends string> {
  id: Id;
  label: string;
  count: number;
  Icon: LucideIcon;
  /** The tooltip — what this view is for, in one line. */
  hint: string;
}

export const SourceTabs = <Id extends string>({ tabs, active, onSelect }: {
  tabs: readonly SourceTabDef<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
}) => {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Roving tabindex: the tablist is one stop, and the arrows move within it.
  // Without this a keyboard user tabs through every view before reaching the
  // panel — the reason a tablist is a single stop in the first place.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(t => t.id === active);
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };

  const tabClass = (selected: boolean) =>
    `flex items-center gap-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
      {/* Desktop: a sticky vertical sidebar, same shape as CategoryNav. The
          real tablist — one role="tab" per tab, only here, or the mobile
          strip below would double every accessible name. */}
      <div
        role="tablist"
        aria-label="Sources"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="hidden md:flex md:w-52 shrink-0 flex-col gap-1 sticky top-6 self-start"
      >
        {tabs.map(tab => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={el => { refs.current[tab.id] = el; }}
              role="tab"
              id={`source-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`source-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              title={tab.hint}
              onClick={() => onSelect(tab.id)}
              className={`${tabClass(selected)} px-3 py-2.5 text-left justify-between`}
            >
              <span className="flex items-center gap-2.5">
                <tab.Icon size={16} className="shrink-0" />
                {tab.label}
              </span>
              <span className={countClass(selected)}>{tab.count}</span>
            </button>
          );
        })}
      </div>

      {/* Below md: the same horizontal scrollable strip CategoryNav uses —
          plain buttons, not a second tablist. Scrolls rather than wraps below
          375px: a control that reflows onto two rows stops reading as one. */}
      <div className="md:hidden overflow-x-auto -mx-4 px-4 pb-1">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/40 border border-border w-max">
          {tabs.map(tab => {
            const selected = tab.id === active;
            return (
              <button
                key={`mobile-${tab.id}`}
                type="button"
                aria-current={selected ? 'page' : undefined}
                title={tab.hint}
                onClick={() => onSelect(tab.id)}
                className={`${tabClass(selected)} px-3 py-2 text-xs`}
              >
                <tab.Icon size={14} className="shrink-0" />
                {tab.label}
                <span className={countClass(selected)}>{tab.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
