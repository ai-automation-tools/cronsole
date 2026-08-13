import { Layers, Monitor, Zap, Bot, Globe, Terminal } from 'lucide-react';
import { sourceLabel, sourcePlatform } from '../platform';
import { HelpButton } from './HelpButton';
import { sourceTopicId } from '../data/help';

/**
 * **Where a task comes from** — the dashboard's first-level axis.
 *
 * Cronsole is growing past one scheduler: Windows today, Cronsole-native
 * alongside it, and AI systems and other operating systems after that. "Which
 * system is this task even from?" is the question you ask *before* "is it
 * failing?", so it gets the outermost control rather than a row inside the
 * Filters drawer, where platform used to live.
 *
 * Three things make this different from the other filters:
 *
 * **It is an outer lens, not a peer.** Picking a source does not drop the view
 * bar to "Custom" — `filtersEqual` ignores `platform` — so *Failures* stays lit
 * while you move between sources, and the two chips together read as one
 * sentence: failing tasks, Windows only. That is allowed precisely because both
 * are on screen at once; the rule it bends is about **hidden** constraints, and
 * a selected button one line above is not hidden.
 *
 * **It is derived from your tasks, not from a list of platforms.** A source
 * appears when you have something from it and disappears when you don't, so the
 * bar grows by itself as connectors land — and never shows a button that leads
 * to an empty list. The cost is that a platform you have not imported from yet
 * is not discoverable here; the **Platforms** tab is where that belongs.
 *
 * **Its counts are faceted.** Each number is what you would see after clicking,
 * given every *other* lens still in force — so it comes from
 * `applyTaskFiltersExcept(tasks, filters, 'platform')`, never from the raw list.
 * A count beside a control is a promise about what clicking it reveals.
 */

/**
 * Icon per source. Keyed on the full source key first so a subtype can differ
 * from its platform — a native HTTP job and a native script are the same
 * platform and should not look identical in the one control that separates them.
 * Falls back to the platform, then to a globe for a source we have not styled.
 */
const SOURCE_ICON: Record<string, typeof Monitor> = {
  WINDOWS_TASK_SCHEDULER: Monitor,
  'TASKHUB_NATIVE:HTTP': Globe,
  'TASKHUB_NATIVE:EXEC': Terminal,
  TASKHUB_NATIVE: Zap,
  CLAUDE_CODE: Bot
};

const iconFor = (key: string) =>
  SOURCE_ICON[key] ?? SOURCE_ICON[sourcePlatform(key)] ?? Globe;

/**
 * Selected styling per source, from the identity role tokens.
 *
 * Never a raw palette utility: `--native` / `--claude` are semantic identity
 * roles whose text form has to invert between themes while the accent does not
 * (see `index.css`). A literal here would fail AA in one theme or the other.
 */
const SOURCE_ON: Record<string, string> = {
  WINDOWS_TASK_SCHEDULER: 'bg-primary text-primary-foreground border-primary',
  TASKHUB_NATIVE: 'bg-native text-white border-native',
  CLAUDE_CODE: 'bg-claude text-white border-claude'
};

/** Selected styling: identity is a property of the platform, not the subtype. */
const onClassFor = (key: string) =>
  SOURCE_ON[key] ?? SOURCE_ON[sourcePlatform(key)] ?? FALLBACK_ON;

const FALLBACK_ON = 'bg-primary text-primary-foreground border-primary';
const OFF = 'bg-surface text-muted-foreground border-border hover:text-foreground hover:border-foreground/25';

interface SourceBarProps {
  /** Sources present in the current task list, already sorted. */
  sources: string[];
  /** Faceted count per source — what clicking it would show. */
  counts: Map<string, number>;
  /** Total across every source under the other lenses — the "All" count. */
  totalCount: number;
  /** `'All'` or a `PlatformType`. */
  selected: string;
  onSelect: (source: string) => void;
}

export const SourceBar = ({ sources, counts, totalCount, selected, onSelect }: SourceBarProps) => {
  // With one source there is no axis to choose along, and a lone button that
  // cannot change anything is furniture. It reappears the moment a second
  // source exists, which is also the moment it starts meaning something.
  if (sources.length < 2) return null;

  const button = (value: string, label: string, Icon: typeof Monitor, count: number) => {
    const active = selected === value;
    return (
      <button
        key={value}
        onClick={() => onSelect(value)}
        aria-pressed={active}
        title={value === 'All' ? 'Tasks from every source' : `Only tasks from ${label}`}
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 ${
          active ? onClassFor(value) : OFF
        }`}
      >
        <Icon size={13} />
        {label}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums ${
            active ? 'bg-black/20' : 'bg-muted text-subtle-foreground'
          }`}
        >
          {count}
        </span>
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Task source"
      /* Scrolls rather than wraps below `sm`, the same idiom as the saved-views
         bar — "Windows Task Scheduler" alone is most of a 375px screen. */
      className="flex items-center gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap -mx-4 px-4 sm:mx-0 sm:px-0 pb-1.5 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="flex items-center gap-1.5 shrink-0 text-[11px] font-bold uppercase tracking-wider text-subtle-foreground">
        <Layers size={12} /> Source
      </span>
      {button('All', 'All sources', Layers, totalCount)}
      {sources.map(key => button(key, sourceLabel(key), iconFor(key), counts.get(key) ?? 0))}
      {/*
        Help for the source you are *on*, not a generic page about sources — the
        question here is "what is this one, and what can Cronsole do with it?",
        which has a different answer per source. On `All` that resolves to the
        overview, which is the honest answer to the same question.

        Beside the chips rather than inside them: a `?` nested in a chip would be
        a button inside a button, and would steal the chip's click target.
      */}
      <HelpButton topic={selected === 'All' ? 'sources' : sourceTopicId(selected)} size="md" />
    </div>
  );
};

export default SourceBar;
