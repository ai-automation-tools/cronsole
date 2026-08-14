import { useEffect, useRef, useState } from 'react';
import { Filter, Search, Star, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The Templates tab's filter controls, in one bar.
 *
 * It replaces four permanently-open chip rows — Target, OS, Category, Tags —
 * stacked under the search box. With 66 templates the Tags row alone ran to two
 * lines, so the filters were taller than the first template card and the page
 * opened on its own controls.
 *
 * **The rule inherited from the dashboard's `TaskFilterMenu`: collapsing the
 * controls must not collapse what they are withholding.** Two things keep that
 * true here, and neither is decoration:
 *
 *  - Every **active** facet stays outside the drawer as a removable pill. You
 *    can read `Target: Windows` over a short list and know why it is short.
 *  - The trigger carries the **active count**, so "filters are set" can never be
 *    hidden by "the drawer is shut".
 *
 * This tab gets off lighter than the dashboard did: every facet here defaults to
 * *All*, so a closed drawer over an unfiltered list is withholding nothing. The
 * dashboard's harder cases — a default nobody chose that hides 189 rows — do not
 * exist on this screen. If a facet ever gains a non-All default, it belongs
 * outside the drawer with its count, the way the dashboard's system and status
 * lenses are.
 */
export interface TemplateFacet {
  id: string;
  /** Shown on the group heading and on the active pill: "Target", "Tag". */
  label: string;
  icon?: LucideIcon;
  values: string[];
  counts: Map<string, number>;
  selected: string;
  onSelect: (value: string) => void;
  /** Display text for a raw facet value. */
  labelFor: (value: string) => string;
  /** Appended after the label — the creatability marker on Target chips. */
  markerFor?: (value: string) => string;
  /** Tooltip for a value, e.g. why a target is marked. */
  titleFor?: (value: string) => string | undefined;
}

const Chip = ({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
      active
        ? 'bg-primary border-primary text-primary-foreground'
        : 'bg-background border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground'
    }`}
  >
    {children}
  </button>
);

interface Props {
  search: string;
  onSearch: (value: string) => void;
  kind: 'all' | 'starters' | 'patterns';
  onKind: (value: 'all' | 'starters' | 'patterns') => void;
  favoritesOnly: boolean;
  onFavoritesOnly: (value: boolean) => void;
  favoriteCount: number;
  facets: TemplateFacet[];
  /** True when anything at all is narrowing the list, search included. */
  hasActiveFilters: boolean;
  onClear: () => void;
  /** Templates currently shown, and the total, for the result line. */
  shown: number;
  total: number;
}

export const TemplateFilterBar = ({
  search,
  onSearch,
  kind,
  onKind,
  favoritesOnly,
  onFavoritesOnly,
  favoriteCount,
  facets,
  hasActiveFilters,
  onClear,
  shown,
  total
}: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // Only facets with something to choose between are worth a group. A facet
  // whose every template shares one value is a heading over a single chip.
  const usable = facets.filter(f => f.values.length > 1);
  const active = usable.filter(f => f.selected !== 'All');

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => onSearch(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onSearch('')}
            placeholder="Search templates…"
            aria-label="Search templates"
            className="w-full bg-surface border border-border rounded-lg pl-9 pr-8 py-1.5 text-sm outline-none focus:border-primary transition-colors"
          />
          {search && (
            <button
              onClick={() => onSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground"
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 bg-surface border border-border p-0.5 rounded-lg shrink-0">
          {(['all', 'starters', 'patterns'] as const).map(k => (
            <button
              key={k}
              onClick={() => onKind(k)}
              aria-pressed={kind === k}
              className={`px-2.5 py-1 rounded-md text-xs font-bold capitalize transition-all ${
                kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <button
          onClick={() => onFavoritesOnly(!favoritesOnly)}
          title={favoritesOnly ? 'Show all templates' : 'Show favorites only'}
          aria-pressed={favoritesOnly}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
            favoritesOnly
              ? 'bg-warning/15 text-warning-text border-warning/40'
              : 'bg-surface text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          <Star size={13} className={favoritesOnly ? 'fill-current' : ''} />
          Favorites
          {favoriteCount > 0 && <span className="text-subtle-foreground">{favoriteCount}</span>}
        </button>

        {usable.length > 0 && (
          <div className="relative shrink-0" ref={ref}>
            <button
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              aria-haspopup="true"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                active.length
                  ? 'bg-primary/10 text-foreground border-primary/40'
                  : 'bg-surface text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              <Filter size={13} />
              Filters
              {active.length > 0 && (
                <span className="px-1.5 rounded-md bg-primary text-primary-foreground text-[10px]">{active.length}</span>
              )}
            </button>

            {open && (
              <div className="absolute right-0 mt-2 w-[22rem] max-h-[60vh] overflow-y-auto bg-surface border border-border rounded-xl shadow-2xl z-50 p-3 space-y-3">
                {usable.map(facet => {
                  const Icon = facet.icon;
                  return (
                    <div key={facet.id} className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground flex items-center gap-1">
                        {Icon && <Icon size={10} />} {facet.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip active={facet.selected === 'All'} onClick={() => facet.onSelect('All')}>
                          All
                        </Chip>
                        {facet.values.map(value => (
                          <Chip
                            key={value}
                            active={facet.selected === value}
                            onClick={() => facet.onSelect(value)}
                          >
                            <span title={facet.titleFor?.(value)}>
                              {facet.labelFor(value)}
                              {facet.markerFor?.(value)}
                            </span>
                            <span
                              className={`ml-1.5 text-[10px] ${
                                facet.selected === value ? 'text-primary-foreground/80' : 'text-subtle-foreground'
                              }`}
                            >
                              {facet.counts.get(value) ?? 0}
                            </span>
                          </Chip>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <button
            onClick={onClear}
            className="shrink-0 text-xs font-bold text-subtle-foreground hover:text-foreground flex items-center gap-1"
            title="Clear all filters"
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* What the drawer is holding, stated outside it. A shut drawer may hide
          the controls; it may not hide the constraint. */}
      {(active.length > 0 || hasActiveFilters) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-subtle-foreground">
            {shown} of {total}
          </span>
          {active.map(facet => (
            <button
              key={facet.id}
              onClick={() => facet.onSelect('All')}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/30 text-foreground font-semibold hover:border-primary/60 transition-colors"
              title={`Clear ${facet.label.toLowerCase()} filter`}
            >
              <span className="text-subtle-foreground font-normal">{facet.label}:</span>
              {facet.labelFor(facet.selected)}
              <X size={11} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
