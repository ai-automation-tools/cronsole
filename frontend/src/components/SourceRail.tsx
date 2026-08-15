import { useMemo, useState } from 'react';
import {
  ChevronRight, Layers, Monitor, Zap, Bot, Globe, Terminal, EyeOff, Star,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { sourcePlatform } from '../platform';
import { HelpButton } from './HelpButton';
import { sourceTopicId } from '../data/help';
import {
  buildSourceTree,
  expandedSourceFor,
  isRailNodeSelected,
  ALL_SOURCES,
  FAVORITES_KEY,
  type RailNode
} from '../utils/sourceTree';
import type { Task } from '../types';
import type { TaskFilters } from '../utils/taskFilters';

/**
 * **Where a task lives** — the dashboard's navigation, as a tree.
 *
 * This is the second level of the app's chrome: the top toolbar answers *what am
 * I doing* (Dashboard / Templates / Platforms / Tools), and this answers *which
 * system, and which folder inside it*. What is left over — *which slice* —
 * belongs to the view bar and the filters, which are now the only horizontal
 * controls above the list rather than two of four competing rows.
 *
 * It replaces `SourceBar`, and it absorbs two things that used to sit elsewhere:
 *
 * **The category facet**, which was buried inside the Filters drawer. On a
 * machine with 354 Windows tasks across a dozen Task Scheduler folders, the
 * folder is the axis you actually navigate by, and it was behind a popover.
 *
 * **Per-platform health**, which the old sidebar printed as a separate "System
 * Status" panel listing exactly these platforms with exactly these dots. A
 * status readout beside the thing it describes needs no panel of its own, and
 * one place reporting a fact cannot disagree with another place reporting it.
 *
 * The rail is *navigation*, which inverts one rule the old source bar followed.
 * `SourceBar` refused to show a source with no tasks, on the reasoning that a
 * control should never lead somewhere empty — right for a filter chip. As
 * navigation the opposite holds: a connected platform with nothing imported has
 * to be reachable, because its empty state is the only place that can tell you to
 * import from it. See `buildSourceTree` for the existence-vs-count split.
 */

/**
 * Icon per source key, then per platform, then a globe.
 *
 * Keyed on the full source key first so a subtype can differ from its platform —
 * a native HTTP job and a native script are the same platform and should not
 * look identical in the one control that separates them.
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

interface SourceRailProps {
  /**
   * The rail population — every task passing the lenses the rail does *not* own.
   * See `SourceTreeInput.population` for why source, category and the system
   * lens must all be left out of it.
   */
  population: Task[];
  filters: TaskFilters;
  onSelect: (patch: Partial<TaskFilters>) => void;
  /**
   * Icons-only mode.
   *
   * The folder level is **dropped**, not shrunk. At 72px a Task Scheduler folder
   * name has nowhere to go, and a tree whose second level is a column of
   * tooltips is worse than one that admits it needs width — so collapsing keeps
   * exactly what survives without text: the platforms, their health, and their
   * counts. Picking one expands the rail again, because the folder you were
   * heading for is the reason you clicked.
   */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export const SourceRail = ({
  population,
  filters,
  onSelect,
  collapsed = false,
  onToggleCollapsed
}: SourceRailProps) => {
  const { data: connections } = useConnections();

  const tree = useMemo(
    () =>
      buildSourceTree({
        population,
        filters,
        // Only platforms with a real connection. An unconfigured one has never
        // been asked anything, so listing it would put a permanent dead row in
        // the navigation — the same reason HealthStrip filters on `state`.
        connectedPlatforms: (connections ?? []).filter(c => c.state).map(c => c.platform)
      }),
    [population, filters, connections]
  );

  const health = useMemo(
    () => new Map((connections ?? []).filter(c => c.state).map(c => [c.platform, c])),
    [connections]
  );

  /**
   * Which branches are open.
   *
   * Stored as **overrides**, not as the set itself, so the default — "the branch
   * the current filters live in is open" — is *derived during render* rather than
   * synced into state by an effect. That matters beyond lint: an effect would
   * have to re-open the branch after every filter change, and the filters object
   * is new on every poll and invalidation (troubleshooting #52), so the effect's
   * dependency had to be a hand-picked string to avoid re-running forever. There
   * is no dependency to pick if there is no effect.
   *
   * The override also carries a meaning the additive version could not express:
   * `false` is *"I closed this on purpose"*, which now survives a re-render
   * instead of being immediately undone by the auto-open.
   *
   * Expansion is presentation and deliberately **not** in the URL: a bookmark
   * reproduces which tasks you are looking at, and a link that also restored a
   * disclosure would make two URLs that mean the same thing.
   */
  const branch = expandedSourceFor(filters);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());

  const isOpen = (key: string) => overrides.get(key) ?? key === branch;
  const toggle = (key: string) =>
    setOverrides(prev => new Map(prev).set(key, !isOpen(key)));

  return (
    <nav
      aria-label="Task sources"
      data-testid="source-rail"
      className="flex flex-col gap-1 text-sm"
    >
      {/* Section header with a rule that runs to the edge — it labels the tree
          below it rather than floating above it as another small grey thing.
          Collapsed, the label and the `?` go and the toggle centres: a 72px
          column has room for one control, and it should be the way back out. */}
      <div
        className={`flex items-center pb-2 mb-1 border-b border-border/70 ${
          collapsed ? 'justify-center' : 'gap-1.5 px-2'
        }`}
      >
        {!collapsed && (
          <>
            <Layers size={11} className="text-subtle-foreground shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-subtle-foreground">
              Sources
            </span>
            <span className="ml-auto flex items-center">
              <HelpButton topic={filters.source === ALL_SOURCES ? 'sources' : sourceTopicId(filters.source)} />
            </span>
          </>
        )}
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sources' : 'Collapse sources'}
            title={collapsed ? 'Expand sources' : 'Collapse sources'}
            aria-expanded={!collapsed}
            className="flex h-6 w-6 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        )}
      </div>

      <ul className="space-y-0.5">
        {tree.map(node => {
          // The two scope rows — everything, and starred — are not platforms.
          // They lead the rail and are separated from it by a rule, because
          // "which system?" and "which slice of all of them?" are different
          // questions and a reader should not have to infer the boundary.
          const isScope = node.key === ALL_SOURCES || node.key === FAVORITES_KEY;
          const open = isOpen(node.key);
          const conn = health.get(node.key);

          return (
            <li
              key={node.key}
              className={node.key === FAVORITES_KEY ? 'mb-2 pb-2 border-b border-border/70' : ''}
            >
              <Row
                node={node}
                selected={isRailNodeSelected(node, filters)}
                depth={0}
                collapsed={collapsed}
                Icon={
                  node.key === ALL_SOURCES
                    ? Layers
                    : node.key === FAVORITES_KEY
                      ? Star
                      : iconFor(node.key)
                }
                iconTone={node.key === FAVORITES_KEY ? 'warning' : undefined}
                dot={conn ? healthMeta(conn.state) : null}
                expandable={!collapsed && !isScope && !!node.children?.length}
                open={open}
                onToggle={() => toggle(node.key)}
                onSelect={onSelect}
              />

              {!collapsed && open && node.children && (
                /*
                  The guide rail. Depth was expressed only as left padding, so
                  fifteen folders under Windows read as a flat list that happened
                  to start further right — you could not see where a branch began
                  or ended. A hairline down the group is what makes it a tree.
                */
                <ul className="mt-px ml-[15px] pl-1.5 border-l border-border space-y-px">
                  {node.children.map(child => (
                    <ChildRow
                      key={child.key}
                      node={child}
                      filters={filters}
                      isOpen={isOpen}
                      onToggle={toggle}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

/**
 * A level-2 row: a folder, a job type, or the `\Microsoft\` disclosure group.
 *
 * The group is the one row here that is **not** a selection — it has no patch,
 * so it renders as an expander only. That is deliberate: selecting it would mean
 * writing `system: 'only'` from the rail, making it a third controller of a lens
 * that already has two.
 */
const ChildRow = ({
  node,
  filters,
  isOpen,
  onToggle,
  onSelect
}: {
  node: RailNode;
  filters: TaskFilters;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  onSelect: (patch: Partial<TaskFilters>) => void;
}) => {
  const open = isOpen(node.key);
  const isGroup = !node.patch;

  return (
    <li>
      <Row
        node={node}
        selected={isRailNodeSelected(node, filters)}
        depth={1}
        Icon={isGroup ? EyeOff : null}
        dot={null}
        expandable={isGroup && !!node.children?.length}
        open={open}
        onToggle={() => onToggle(node.key)}
        onSelect={onSelect}
      />
      {open && node.children && (
        <ul className="mt-px ml-[15px] pl-1.5 border-l border-border/70 space-y-px">
          {node.children.map(leaf => (
            <li key={leaf.key}>
              <Row
                node={leaf}
                selected={isRailNodeSelected(leaf, filters)}
                depth={2}
                Icon={null}
                dot={null}
                expandable={false}
                open={false}
                onToggle={() => {}}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

/**
 * Indentation per level. A literal per depth, so nothing computes a class name.
 *
 * Small numbers, because the guide rails now carry the depth: each nested list
 * indents itself and draws a hairline, so the row only needs breathing room from
 * that line rather than enough padding to imply a level on its own.
 */
const PAD = ['pl-1.5', 'pl-1.5', 'pl-1.5'];

const Row = ({
  node,
  selected,
  depth,
  collapsed = false,
  Icon,
  iconTone,
  dot,
  expandable,
  open,
  onToggle,
  onSelect
}: {
  node: RailNode;
  selected: boolean;
  depth: number;
  /** Icons-only. Only ever true at depth 0 — the folder level is dropped. */
  collapsed?: boolean;
  Icon: typeof Monitor | null;
  /** Overrides the icon's accent — Favorites wears the same amber as its star. */
  iconTone?: 'warning';
  dot: { label: string; dot: string; text: string } | null;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  onSelect: (patch: Partial<TaskFilters>) => void;
}) => {
  const selectable = !!node.patch;
  /*
    Level 1 is a *destination*; levels 2 and 3 are contents of one.

    Giving them the same row treatment is what made the rail read flat even after
    the guide rails landed: a Task Scheduler folder and the entire Windows
    platform were the same 30px of the same weight. Top-level rows are taller,
    carry their icon in a tile, and set their label larger — so the eye lands on
    "which system" first and reads folders as detail underneath it.
  */
  const top = depth === 0;

  /*
    Collapsed: one centred tile, the count as a corner badge, the name in a
    tooltip. Rendered as its own branch rather than as the expanded row with
    pieces hidden — the two share almost no layout, and threading four
    `collapsed ?` conditionals through the wide row is how one of them ends up
    wrong at 72px where nobody looks.
  */
  if (collapsed) {
    return (
      <button
        onClick={() => selectable && onSelect(node.patch!)}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
        title={`${node.label} — ${node.count} task${node.count === 1 ? '' : 's'}${
          dot ? ` · ${dot.label}` : ''
        }`}
        /*
          Icon over count, stacked and centred — not a number tucked into the
          corner. `357` in a corner badge ran to the tile's edge and fought the
          glyph beside it; stacked, three digits fit and the column of counts
          still scans vertically the way the expanded rail's does.
        */
        className={`group relative flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
          selected
            ? 'border-primary/40 bg-primary/20 text-primary'
            : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        }`}
      >
        {Icon && (
          <Icon
            size={17}
            className={iconTone === 'warning' && !selected ? 'text-warning-text' : ''}
            {...(iconTone === 'warning' ? { fill: 'currentColor' } : {})}
          />
        )}
        {dot && (
          <span
            aria-hidden
            className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-surface ${dot.dot}`}
          />
        )}
        {/* The count survives the collapse: it is the one number that says
            whether a source is worth clicking, and losing it would make the
            collapsed rail a row of anonymous glyphs. */}
        <span
          className={`text-[10px] tabular-nums leading-none ${
            selected ? 'text-foreground font-bold' : 'text-subtle-foreground'
          }`}
        >
          {node.count}
        </span>
      </button>
    );
  }

  return (
    /*
      One fixed-height row, and the selected state is unmistakable.

      A `bg-primary/12` tint was the whole of it before, which at depth 2 in a
      list of fifteen folders is barely a shade. The accent bar on the leading
      edge is what actually reads — it is the same "you are here" grammar the top
      toolbar uses on its active tab, rotated to match a vertical list.

      `h-[30px]` is fixed rather than derived from content: a row that grows
      because its label wrapped would shift every row under it, and this list
      re-renders on a 45s poll.
    */
    <div
      className={`group relative flex items-center gap-1 rounded-lg pr-1.5 transition-colors duration-100 ${
        top ? 'h-11' : 'h-[30px]'
      } ${
        selected
          ? top
            ? 'bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
            : 'bg-primary/15 text-foreground'
          : 'hover:bg-muted/50'
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-primary transition-all duration-150 ${
          top ? 'w-[3px]' : 'w-[3px]'
        } ${selected ? (top ? 'h-6 opacity-100' : 'h-4 opacity-100') : 'h-0 opacity-0'}`}
      />

      {expandable ? (
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
          className={`flex shrink-0 items-center justify-center ml-0.5 rounded text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
            top ? 'h-5 w-5' : 'h-[18px] w-[18px]'
          }`}
        >
          <ChevronRight
            size={top ? 13 : 12}
            className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </button>
      ) : (
        // Reserve the chevron's width so sibling labels stay on one left edge —
        // a row that shifts sideways depending on whether it has children makes
        // the tree's depth unreadable at a glance.
        <span className={`shrink-0 ${top ? 'w-[24px]' : 'w-[22px]'}`} aria-hidden />
      )}

      <button
        // A selectable row filters; a disclosure group only opens. Both are
        // buttons and neither pretends to be the other — the group never claims
        // a selected state it cannot be in, and clicking its label does the one
        // thing it can do rather than nothing at all.
        onClick={() => (selectable ? onSelect(node.patch!) : onToggle())}
        aria-expanded={selectable ? undefined : open}
        aria-current={selected ? 'true' : undefined}
        // Named explicitly rather than left to the text content. The count sits
        // in its own span, so a content-derived name reads "AI-Tools 8" — and a
        // folder called "2" would be indistinguishable from its own tally.
        aria-label={`${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
        // A long folder name truncates; the full one has to stay reachable, or
        // three folders sharing a prefix become the same row.
        title={
          node.withheld
            ? `${node.count} tasks the OS owns. The dashboard hides these by default — open the group to look inside one folder.`
            : node.label
        }
        className={`flex h-full min-w-0 flex-1 items-center gap-1.5 ${PAD[depth]} text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-md ${
          selected
            ? 'text-foreground'
            : selectable
              ? 'text-muted-foreground hover:text-foreground'
              : 'text-subtle-foreground hover:text-foreground'
        }`}
      >
        {/*
          At level 1 the icon sits in a tile. It gives the destination an object
          to be — a bare 13px glyph beside a label is the same visual weight as
          the folder rows below it, which is what made "the whole Windows
          platform" and "one folder inside it" read as siblings.

          The health dot is docked to the tile's corner rather than following the
          icon as a separate element: it belongs to the platform, so it should
          look attached to it, and a corner badge cannot shift the label.
        */}
        {Icon && (
          top ? (
            <span
              className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                selected
                  ? 'border-primary/40 bg-primary/20 text-primary'
                  : 'border-border bg-muted/60 text-muted-foreground group-hover:text-foreground'
              }`}
            >
              <Icon
                size={15}
                className={iconTone === 'warning' && !selected ? 'text-warning-text' : ''}
                {...(iconTone === 'warning' ? { fill: 'currentColor' } : {})}
              />
              {dot && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex items-center"
                  title={`${node.label} — ${dot.label}`}
                >
                  <span className={`h-2 w-2 rounded-full ring-2 ring-background ${dot.dot}`} />
                </span>
              )}
            </span>
          ) : (
            <Icon
              size={13}
              className={`shrink-0 transition-colors ${selected ? 'text-primary' : ''}`}
            />
          )
        )}

        <span
          className={`truncate ${
            top
              ? `text-[13px] tracking-[-0.01em] ${selected ? 'font-bold' : 'font-semibold'}`
              : `text-[13px] ${selected ? 'font-bold' : 'font-medium'}`
          }`}
        >
          {node.label}
        </span>

        {/*
          The withheld state as a badge rather than a parenthetical in the label.

          It has to stay visible — this is the one row whose job is saying what is
          being held back — and as text it made the label long enough to wrap,
          which left a two-line row ragged among single-line ones. A badge states
          the same fact in a fixed slot and cannot push the row's height around.
        */}
        {node.withheld && (
          <span className="shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide bg-muted text-subtle-foreground">
            hidden
          </span>
        )}

        {/*
          Counts form a **column**, not a row of pills: right-aligned, tabular,
          and set in one dim weight so fifteen of them scan vertically. The pill
          chrome each one used to carry made the numbers compete with the folder
          names they belong to.
        */}
        <span
          className={`ml-auto shrink-0 pl-1 tabular-nums text-right ${
            top ? 'text-[12px]' : 'text-[11px]'
          } ${
            selected
              ? 'text-foreground font-bold'
              : top
                ? 'text-muted-foreground font-semibold'
                : 'text-subtle-foreground'
          }`}
        >
          {node.count}
        </span>
      </button>
    </div>
  );
};

export default SourceRail;
