import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Cpu,
  Eye,
  EyeOff,
  Filter,
  Folder,
  LayoutDashboard,
  User,
  X,
  Zap
} from 'lucide-react';
import { platformLabel } from '../platform';
import {
  activeFilterCount,
  withheldBy,
  type StatusFilter,
  type SystemFilter,
  type TaskFilters
} from '../utils/taskFilters';

/**
 * The dashboard's secondary filters, collapsed into one control.
 *
 * The first viewport used to stack fourteen controls above the first task. Most
 * were filters, and most of the time none of them is the thing you came to do —
 * so they live behind one trigger now.
 *
 * **The part that is not negotiable: collapsing the controls must not collapse
 * what they are withholding.** A closed drawer over a filtered list is the
 * invisible fence again with a nicer lid, and this codebase has paid for that
 * twice (`Active Only · 110 hidden`, and a dashboard that opened on Favorites
 * while claiming to show all 269). So the split is by *whether a lens speaks
 * for itself*:
 *
 *  - **Category and platform** become **pills**, outside the drawer. You can
 *    read "Backups" and know the rest is elsewhere; a count would add nothing.
 *  - **System and status** print what they are holding back, outside the
 *    drawer, always. They are *defaults* — nobody chose them today — and on a
 *    real machine they withhold 189 and 10 rows while looking like a neutral
 *    starting state. That is exactly the case where the user cannot be assumed
 *    to know.
 *  - The **trigger carries the active-filter count**, so the fact that filters
 *    are set can never be hidden by the fact that they are closed.
 *
 * `withheldBy` and `activeFilterCount` are pure and pinned by tests, so the
 * rule survives edits to this component.
 */
interface Props {
  filters: TaskFilters;
  setFilter: <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => void;
  /** Persisted alongside the system lens — see the dashboard's note on why. */
  onSystemLensChange: (next: SystemFilter) => void;
  categories: string[];
  categoryCounts: Map<string, number>;
  totalVisibleCount: number;
  platforms: string[];
  platformCounts: Map<string, number>;
  /** Tasks Windows itself owns, counted over everything the other lenses allow. */
  hiddenBySystemFilter: number;
  /** Tasks the status lens is holding back, in this view. */
  hiddenByActiveFilter: number;
}

const STATUS_LABEL: Record<StatusFilter, string> = {
  active: 'Active only',
  any: 'All statuses',
  disabled: 'Disabled only',
  missing: 'Missing only'
};

const SYSTEM_LABEL: Record<SystemFilter, string> = {
  personal: 'Yours only',
  include: 'Include Windows’ own',
  only: 'Windows’ own only'
};

export const TaskFilterMenu = ({
  filters,
  setFilter,
  onSystemLensChange,
  categories,
  categoryCounts,
  totalVisibleCount,
  platforms,
  platformCounts,
  hiddenBySystemFilter,
  hiddenByActiveFilter
}: Props) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. Not a Modal: this is a menu, and
  // trapping focus for a filter popover would be heavier than the job needs.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = activeFilterCount(filters);
  const withheld = withheldBy(filters, {
    system: hiddenBySystemFilter,
    status: hiddenByActiveFilter
  });

  const row =
    'w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-left';
  const rowOn = 'bg-primary/15 text-foreground';
  const rowOff = 'text-muted-foreground hover:bg-muted hover:text-foreground';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative" ref={wrapRef}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          title="Status, system, platform and category filters"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
            active > 0
              ? 'bg-primary/10 border-primary/40 text-foreground'
              : 'bg-surface border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'
          }`}
        >
          <Filter size={13} />
          Filters
          {active > 0 && (
            <span className="bg-primary text-primary-foreground rounded-md px-1.5 py-0.5 text-[10px] tabular-nums">
              {active}
            </span>
          )}
          <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>

        {open && (
          <div
            role="group"
            aria-label="Filters"
            className="absolute z-40 mt-2 w-64 bg-raised border border-border rounded-2xl shadow-2xl p-3 space-y-3"
          >
            <Section title="Status">
              {(['active', 'any', 'disabled', 'missing'] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setFilter('status', s)}
                  className={`${row} ${filters.status === s ? rowOn : rowOff}`}
                >
                  <span className="flex items-center gap-2">
                    {s === 'active' ? <EyeOff size={12} className="text-success-text" />
                      : s === 'any' ? <Eye size={12} className="text-warning-text" />
                        : <Filter size={12} className="text-isolate-text" />}
                    {STATUS_LABEL[s]}
                  </span>
                  {filters.status === s && <Check size={12} className="text-primary" />}
                </button>
              ))}
            </Section>

            {/* Only when the machine actually has OS-owned tasks — a lens for a
                problem you don't have is noise. */}
            {hiddenBySystemFilter > 0 && (
              <Section title="Ownership">
                {(['personal', 'include', 'only'] as SystemFilter[]).map(s => (
                  <button
                    key={s}
                    onClick={() => onSystemLensChange(s)}
                    className={`${row} ${filters.system === s ? rowOn : rowOff}`}
                  >
                    <span className="flex items-center gap-2">
                      {s === 'personal' ? <User size={12} className="text-system-text" /> : <Cpu size={12} className="text-info-text" />}
                      {SYSTEM_LABEL[s]}
                    </span>
                    {filters.system === s && <Check size={12} className="text-primary" />}
                  </button>
                ))}
              </Section>
            )}

            {platforms.length > 1 && (
              <Section title="Platform">
                <button onClick={() => setFilter('platform', 'All')} className={`${row} ${filters.platform === 'All' ? rowOn : rowOff}`}>
                  <span>All platforms</span>
                  {filters.platform === 'All' && <Check size={12} className="text-primary" />}
                </button>
                {platforms.map(p => (
                  <button key={p} onClick={() => setFilter('platform', p)} className={`${row} ${filters.platform === p ? rowOn : rowOff}`}>
                    <span className="flex items-center gap-2 truncate">
                      {p === 'TASKHUB_NATIVE' && <Zap size={11} className="text-native-text" />}
                      {platformLabel(p)}
                    </span>
                    <span className="text-[10px] tabular-nums text-subtle-foreground">{platformCounts.get(p) ?? 0}</span>
                  </button>
                ))}
              </Section>
            )}

            <Section title="Category">
              <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setFilter('category', cat)} className={`${row} ${filters.category === cat ? rowOn : rowOff}`}>
                    <span className="flex items-center gap-2 truncate">
                      {cat === 'All' ? <LayoutDashboard size={12} /> : <Folder size={12} />}
                      <span className="truncate">{cat}</span>
                    </span>
                    <span className="text-[10px] tabular-nums text-subtle-foreground shrink-0">
                      {cat === 'All' ? totalVisibleCount : categoryCounts.get(cat) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>

      {/* ---- Pills: the lenses that speak for themselves --------------------
          Outside the drawer because they are legible on their own — "Backups"
          tells you what you are looking at, and a count would add nothing. */}
      {filters.category !== 'All' && (
        <Pill icon={<Folder size={11} />} label={filters.category} onClear={() => setFilter('category', 'All')} />
      )}
      {filters.platform !== 'All' && (
        <Pill icon={<Zap size={11} />} label={platformLabel(filters.platform)} onClear={() => setFilter('platform', 'All')} />
      )}
      {(filters.status === 'disabled' || filters.status === 'missing') && (
        <Pill
          icon={<Filter size={11} />}
          label={STATUS_LABEL[filters.status]}
          tone="isolate"
          onClear={() => setFilter('status', 'any')}
        />
      )}
      {filters.system === 'only' && (
        <Pill icon={<Cpu size={11} />} label="Windows’ own only" tone="isolate" onClear={() => onSystemLensChange('personal')} />
      )}

      {/* ---- The withholding summary ---------------------------------------
          Outside the drawer, ALWAYS. These two lenses are defaults nobody chose
          today, and they hold back rows while looking like a neutral starting
          state — the one case where the user cannot be assumed to know. Each is
          also the control that undoes it. */}
      {withheld.map(w => (
        <button
          key={w.dimension}
          onClick={() =>
            w.dimension === 'system' ? onSystemLensChange('include') : setFilter('status', 'any')
          }
          title={
            w.dimension === 'system'
              ? `${w.count} tasks owned by Windows itself are hidden. They still exist and still run — this only affects what the dashboard shows. Click to include them.`
              : `${w.count} tasks are hidden because they are disabled, missing, or unknown. Click to show every status.`
          }
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-warning/10 border border-warning/30 text-warning-text hover:border-warning/60 transition-colors active:scale-95"
        >
          <EyeOff size={11} />
          <span className="tabular-nums">{w.count}</span> {w.label} hidden
        </button>
      ))}
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-0.5">
    <p className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground px-3 pt-1">{title}</p>
    {children}
  </div>
);

const Pill = ({
  icon,
  label,
  onClear,
  tone = 'primary'
}: {
  icon: React.ReactNode;
  label: string;
  onClear: () => void;
  tone?: 'primary' | 'isolate';
}) => (
  <span
    className={`flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-xl text-[11px] font-bold border ${
      tone === 'isolate'
        ? 'bg-isolate/10 border-isolate/40 text-isolate-text'
        : 'bg-primary/10 border-primary/40 text-foreground'
    }`}
  >
    {icon}
    <span className="max-w-[10rem] truncate">{label}</span>
    <button
      onClick={onClear}
      aria-label={`Clear ${label} filter`}
      title={`Clear ${label} filter`}
      className="p-0.5 rounded-md hover:bg-foreground/10 transition-colors"
    >
      <X size={11} />
    </button>
  </span>
);

export default TaskFilterMenu;
