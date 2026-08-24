import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ChevronRight, Layers, Monitor, EyeOff, Star,
  PanelLeftClose, PanelLeftOpen, Bookmark, Plus, Pin, X,
  Compass, SlidersHorizontal
} from 'lucide-react';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { usePlatformMatrix } from '../hooks/usePlatformMatrix';
import { useSettings } from '../hooks/useSettings';
import { railListedPlatforms } from '../utils/sourceVisibility';
import { sourceIcon } from '../platform';
import { HelpButton } from './HelpButton';
import { sourceTopicId } from '../data/help';
import {
  buildSourceTree,
  expandedSourceFor,
  isRailNodeSelected,
  railSectionOf,
  ALL_SOURCES,
  FAVORITES_KEY,
  type RailNode,
  type RailSection
} from '../utils/sourceTree';
import { pinForNode, type RailPin } from '../utils/railPins';
import { useCollections } from '../hooks/useCollections';
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

// One definition, in `platform.ts`, because the Sources tab draws the same
// glyphs on its cards. See `sourceIcon` for why it is not private here.
const iconFor = sourceIcon;

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
  /**
   * Open the collection manager. Optional so the rail still renders in tests and
   * in any caller that has no manager wired — a missing handler hides the "+"
   * rather than rendering a button that does nothing.
   */
  onManageCollections?: () => void;
  /**
   * Pinned rail locations. See `utils/railPins.ts` for why these are not
   * collections: a collection's membership is declared, a pinned folder's is
   * derived, and the rail must not blur the two.
   */
  pins?: RailPin[];
  /**
   * Pin or unpin a level-2 row. Optional on the same terms as
   * `onManageCollections` — no handler, no `+`.
   */
  onTogglePin?: (node: RailNode) => void;
  /**
   * Is the Collections band folded shut?
   *
   * Its own preference rather than a piece of `collapsed`: folding the band is
   * about *how much of your own stuff you want on screen*, while `collapsed` is
   * about the width of the whole rail. Someone with fifteen collections and
   * three platforms wants the first shut and the second open, and one flag
   * cannot say that.
   */
  collectionsCollapsed?: boolean;
  onToggleCollectionsCollapsed?: () => void;
  /**
   * Is the Pinned band folded shut?
   *
   * Its own flag rather than sharing the Collections one: the reason to shut
   * fifteen collections has nothing to do with the reason to shut three pins,
   * and a single toggle over two sections would make each one's chevron lie
   * about the other.
   */
  pinnedCollapsed?: boolean;
  onTogglePinnedCollapsed?: () => void;
  /**
   * Is the Sources tree folded shut?
   *
   * A third independent flag, for the same reason as the second. Someone who
   * works out of two collections and one pinned folder has no use for a dozen
   * platform rows underneath them, and no reason to lose the rail's width to
   * hide them.
   */
  sourcesCollapsed?: boolean;
  onToggleSourcesCollapsed?: () => void;
}

export const SourceRail = ({
  population,
  filters,
  onSelect,
  collapsed = false,
  onToggleCollapsed,
  onManageCollections,
  pins = [],
  onTogglePin,
  collectionsCollapsed = false,
  onToggleCollectionsCollapsed,
  pinnedCollapsed = false,
  onTogglePinnedCollapsed,
  sourcesCollapsed = false,
  onToggleSourcesCollapsed
}: SourceRailProps) => {
  const navigate = useNavigate();
  const { data: connections } = useConnections();
  const { data: collections } = useCollections();
  const { data: matrix } = usePlatformMatrix();
  const { settings } = useSettings();

  /**
   * Which platforms get a row even with no tasks of their own.
   *
   * The union of three facts — asked for, holds tasks, is connected — with one
   * definition in `utils/sourceVisibility.ts`, because the eye switch on every
   * Sources-tab card has to be answering this same question. A second copy here
   * is how "connected but hidden" starts meaning two things.
   *
   * Note the Sources tab's three *views* do **not** read this: they split on
   * `configured`. Listed and connected are different facts, and only this one
   * decides whether the rail draws a row.
   *
   * Connections are still read directly: they arrive on their own query, and a
   * rail that waits for the matrix would drop every empty-but-connected row for
   * the first paint after login.
   */
  const listedPlatforms = useMemo(
    () => railListedPlatforms(
      matrix?.platforms,
      (connections ?? []).filter(c => c.state).map(c => c.platform),
      settings.shownSources
    ),
    [matrix, connections, settings.shownSources]
  );

  const tree = useMemo(
    () =>
      buildSourceTree({
        population,
        filters,
        connectedPlatforms: listedPlatforms,
        collections: collections ?? [],
        pins
      }),
    [population, filters, listedPlatforms, collections, pins]
  );

  /**
   * The rail in three bands.
   *
   * Partitioned here rather than rendered from one flat list with dividers
   * computed per row, which is what this did before: the rule was "rule under
   * the last scope row, wherever that is", and every new row type meant
   * re-deriving where the boundary had moved. Three arrays cannot put a
   * separator in the wrong place.
   */
  const sections = useMemo(() => {
    const bands: Record<RailSection, RailNode[]> = {
      scope: [],
      collection: [],
      pinned: [],
      source: []
    };
    for (const node of tree) bands[railSectionOf(node.key)].push(node);
    return bands;
  }, [tree]);

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
      {/*
        The rail's own chrome, and nothing else.

        This bar used to carry the word "SOURCES" and the help `?` as well —
        which made it look like a heading for the whole rail while actually
        naming only the tree at the bottom. Once the rail grew scopes,
        Collections and Pinned above that tree, the label was describing a
        quarter of what sat under it. Both moved down to the section they name;
        what is left is the one control that belongs to the panel rather than to
        any section inside it.

        Rendered only when there is a toggle to hold. In the mobile drawer there
        is none — the drawer draws its own titled header with a close button — so
        this collapses to nothing instead of leaving an empty ruled strip, and
        the drawer stops saying "Sources" twice.
      */}
      {onToggleCollapsed && (
        <div
          className={`flex items-center pb-2 mb-1 border-b border-border/70 ${
            collapsed ? 'justify-center' : 'justify-end px-2'
          }`}
        >
          <button
            onClick={onToggleCollapsed}
            /* "sidebar", not "sources". This narrows the whole rail — scopes,
               Collections and Pinned included — and the word only meant the
               tree back when the tree was all there was. It would now also
               collide with the Sources section's own fold, leaving two
               different controls sharing one accessible name. */
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="flex h-6 w-6 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>
      )}

      {/* Scopes: everything, and starred. Two rows that name a slice of every
          system rather than one system — which is why they lead the rail and
          are ruled off from it. */}
      <ul className="space-y-0.5">
        {sections.scope.map(node => (
          <li key={node.key}>
            <Row
              node={node}
              selected={isRailNodeSelected(node, filters)}
              depth={0}
              collapsed={collapsed}
              Icon={node.key === ALL_SOURCES ? Layers : Star}
              iconTone={node.key === FAVORITES_KEY ? 'warning' : undefined}
              dot={null}
              expandable={false}
              open={false}
              onToggle={() => {}}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>

      {/*
        **Collections, then Pinned — two bands, ruled off from each other.**

        They were one band briefly, distinguished only by their icons. Splitting
        them is the honest end of the distinction that made a pin a separate type
        to begin with: one list wearing two glyphs asks the reader to hold "some
        of these hold what I put in them, some track a folder" in their head,
        while two headed sections say it without being read. Each folds on its
        own, because the reason to shut fifteen collections has nothing to do
        with the reason to shut three pins.
      */}
      <Band
        testId="collections-band"
        title="Collections"
        Icon={Bookmark}
        rows={sections.collection}
        rowIcon={Bookmark}
        railCollapsed={collapsed}
        folded={collectionsCollapsed}
        onToggleFolded={onToggleCollectionsCollapsed}
        filters={filters}
        onSelect={onSelect}
        /*
          Collections keep their empty state: the button below is how the first
          one gets made, so the band has to be there before you have any.
        */
        keepWhenEmpty
        footer={
          !collapsed && onManageCollections ? (
            /*
              Creating a collection sits at the foot of the band it creates into,
              not at the foot of the whole rail where it used to live — below
              fifteen platform rows, a scroll away from the only section it has
              anything to do with.
            */
            <button
              type="button"
              onClick={onManageCollections}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Plus size={13} className="shrink-0" />
              {collections?.length ? 'Manage collections' : 'New collection'}
            </button>
          ) : undefined
        }
      />

      {/*
        Pinned has **no** empty state, unlike Collections, and the asymmetry is
        the point rather than an oversight. A band earns permanent chrome when
        its empty state can teach you something you can act on *there* — which
        "New collection" does. Pinning happens on a folder in the tree, so an
        empty Pinned band could only point somewhere else, and a header with
        nothing under it and nothing to click is a worse teacher than the `+`
        itself. It appears when you have pinned something and goes when you
        unpin the last one.
      */}
      <Band
        testId="pinned-band"
        title="Pinned"
        Icon={Pin}
        rows={sections.pinned}
        rowIcon={Pin}
        railCollapsed={collapsed}
        folded={pinnedCollapsed}
        onToggleFolded={onTogglePinnedCollapsed}
        filters={filters}
        onSelect={onSelect}
        /*
          Unpin from the pinned row itself, not only from the tree row it
          mirrors. It is the surface you are looking at when you decide a pin has
          served its purpose — and the only one that still works once the folder
          is gone, which is exactly when a `0` row you cannot remove would be
          worst. Collections carry no equivalent: removing one destroys a set you
          built, and that belongs in the manager behind a confirmation.
        */
        rowAction={node => <UnpinButton node={node} onTogglePin={onTogglePin} />}
      />

      {/*
        The source tree — now a named, foldable section like the two above it,
        and, per the rule above, the owner of the separator over itself. It owns
        that boundary whether the bands above it rendered or not, so an empty
        Pinned band cannot take the rule with it when it goes.

        It cannot use `Band`: these rows expand into folders and carry health
        dots, where a collection or a pin is a single flat row. They share the
        heading instead — see `BandHeader`.
      */}
      <div data-testid="sources-band" className="mt-2 border-t border-border/70 pt-2">
        {!collapsed && (
          <BandHeader
            title="Sources"
            Icon={Layers}
            folded={sourcesCollapsed}
            onToggleFolded={onToggleSourcesCollapsed}
            count={sections.source.length}
            /* The help `?` came down with the label: it explains the platforms,
               and it is topic-sensitive to the selected source, so it belongs
               beside the section that holds them rather than atop the rail. */
            trailing={
              <HelpButton
                topic={filters.source === ALL_SOURCES ? 'sources' : sourceTopicId(filters.source)}
              />
            }
          />
        )}
        {(collapsed || !sourcesCollapsed) && (
      <ul className="space-y-0.5">
        {sections.source.map(node => {
          const open = isOpen(node.key);
          const conn = health.get(node.key);

          return (
            <li key={node.key}>
              <Row
                node={node}
                selected={isRailNodeSelected(node, filters)}
                depth={0}
                collapsed={collapsed}
                Icon={iconFor(node.key)}
                dot={conn ? healthMeta(conn.state) : null}
                expandable={!collapsed && !!node.children?.length}
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
                      pins={pins}
                      onTogglePin={onTogglePin}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
        )}

        {/*
          **The rail lists the sources you have and says nothing about the ones
          you could.** That gap is what these two answer, and it is load-bearing
          now that a fresh install deliberately lists two platforms out of four:
          without a route to the rest, "opt-in" would be indistinguishable from
          "missing".

          Two buttons rather than the three that were asked for, and one
          destination rather than two modals. *Explore* and *Manage* are two
          views of one list, so they are two entry points into the Sources tab
          (`?focus=`) — and **Add a custom source** lives on that screen, reached
          from Explore, because it is the rarest of the three and a 240px rail is
          not the place to spend a third row on it.

          Hidden while the rail is collapsed: at icon width the labels are gone
          and two unlabelled glyphs under the tree would be indistinguishable
          from two more sources.
        */}
        {!collapsed && !sourcesCollapsed && (
          <div className="mt-1.5 space-y-0.5">
            <RailAction
              Icon={Compass}
              label="Explore sources"
              title="Everything Cronsole can connect to, including what you have not added"
              onClick={() => navigate('/sources?focus=available')}
            />
            <RailAction
              Icon={SlidersHorizontal}
              label="Manage sources"
              title="Connect, disconnect, and choose which sources this sidebar lists"
              onClick={() => navigate('/sources?focus=connected')}
            />
          </div>
        )}
      </div>
    </nav>
  );
};

/**
 * A button under the Sources tree that leaves the rail.
 *
 * Deliberately not a `Row`: a `Row` is a *destination inside your tasks* and
 * carries a count, a health dot and a selected state. These change the screen,
 * select nothing, and would be lying if they took the same shape — so they are
 * quieter than a row rather than louder, and sit below the rule that ends the
 * tree.
 */
const RailAction = ({ Icon, label, title, onClick }: {
  Icon: typeof Compass;
  label: string;
  title: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-bold text-subtle-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
  >
    <Icon size={13} className="shrink-0" />
    <span className="truncate">{label}</span>
  </button>
);

/**
 * A section heading: chevron, name, and — while folded — its tally.
 *
 * Shared by all three of the rail's named sections, because they are meant to
 * read as the same kind of thing. *Sources* is the odd one out structurally (its
 * rows are expandable trees, not a flat list, so it cannot use `Band`), and that
 * is exactly why the heading had to come out on its own: without this, the one
 * section that could not share the component would have been the one that
 * drifted.
 *
 * The tally shows **only while folded**. Open, you can count the rows yourself;
 * shut, it is the one thing you cannot see — and a chevron that hid twelve rows
 * with no hint of them is the "silently hides 200 rows" problem in miniature.
 */
const BandHeader = ({
  title,
  Icon,
  folded,
  onToggleFolded,
  count,
  trailing
}: {
  title: string;
  /** Shown beside the name when the section cannot fold (no handler given). */
  Icon: typeof Monitor;
  folded: boolean;
  onToggleFolded?: () => void;
  count: number;
  /** An extra control docked to the right of the heading — Sources' help `?`. */
  trailing?: ReactNode;
}) => (
  <div className="flex items-center gap-1 px-2 pb-1">
    {onToggleFolded ? (
      <button
        type="button"
        onClick={onToggleFolded}
        aria-expanded={!folded}
        aria-label={`${folded ? 'Expand' : 'Collapse'} ${title.toLowerCase()}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 text-subtle-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform duration-200 ${folded ? '' : 'rotate-90'}`}
        />
        <span className="text-[10px] font-black uppercase tracking-[0.14em]">{title}</span>
        {folded && count > 0 && (
          <span className="ml-auto tabular-nums text-[10px] font-semibold">{count}</span>
        )}
      </button>
    ) : (
      <>
        <Icon size={11} className="text-subtle-foreground shrink-0" />
        <span className="flex-1 text-[10px] font-black uppercase tracking-[0.14em] text-subtle-foreground">
          {title}
        </span>
      </>
    )}
    {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
  </div>
);

/**
 * One of the rail's two middle bands — *Collections* and *Pinned*.
 *
 * One component rather than two blocks of near-identical JSX, because the two
 * sections are supposed to look and behave the same: same rule above and below,
 * same heading weight, same fold, same tally when shut. Two copies would drift
 * on the first change made to only one of them, and the drift would be the
 * "these are the same kind of place" claim quietly becoming false.
 *
 * What differs between them is passed in, and it is only ever: the title and
 * icon, the rows, whether an empty band still renders, and what each row's
 * trailing control is.
 */
const Band = ({
  testId,
  title,
  Icon,
  rows,
  rowIcon,
  railCollapsed,
  folded,
  onToggleFolded,
  filters,
  onSelect,
  keepWhenEmpty = false,
  footer,
  rowAction
}: {
  testId: string;
  title: string;
  /** Shown beside the heading when the band cannot be folded (no handler). */
  Icon: typeof Monitor;
  rows: RailNode[];
  rowIcon: typeof Monitor;
  /** The whole rail is icons-only. Distinct from `folded`, which is this band. */
  railCollapsed: boolean;
  folded: boolean;
  onToggleFolded?: () => void;
  filters: TaskFilters;
  onSelect: (patch: Partial<TaskFilters>) => void;
  /** Render the band even with no rows — for a band whose footer creates them. */
  keepWhenEmpty?: boolean;
  footer?: ReactNode;
  rowAction?: (node: RailNode) => ReactNode;
}) => {
  /*
    Nothing to show and nothing to offer: render no rule at all. A band that is
    empty *and* has no way to fill itself from here is two hairlines around a
    gap — and at 72px, where the heading and the footer are both dropped, that
    is exactly what every empty band would be.
  */
  if (rows.length === 0 && (!keepWhenEmpty || railCollapsed)) return null;

  const open = railCollapsed || !folded;

  return (
    /*
      **The rule on top only.** Every section draws the boundary *above* itself
      and none draws one below, so each gap between two sections is ruled exactly
      once. Giving a band `border-y` made it self-contained and looked right in
      isolation — but two stacked bands then put their own bottom and top rules a
      margin apart, reading as a double line. A separator belongs to the boundary
      between two things, not to either of them.
    */
    <div data-testid={testId} className="mt-2 border-t border-border/70 pt-2">
      {/* Icons-only drops the heading: 72px has no room for a label, and a
          disclosure you cannot read is one you cannot use. The band is simply
          always open there. */}
      {!railCollapsed && (
        <BandHeader
          title={title}
          Icon={Icon}
          folded={folded}
          onToggleFolded={onToggleFolded}
          count={rows.length}
        />
      )}

      {open && (
        <>
          <ul className="space-y-0.5">
            {rows.map(node => (
              <li key={node.key}>
                <Row
                  node={node}
                  selected={isRailNodeSelected(node, filters)}
                  depth={0}
                  collapsed={railCollapsed}
                  Icon={rowIcon}
                  dot={null}
                  expandable={false}
                  open={false}
                  onToggle={() => {}}
                  onSelect={onSelect}
                  action={rowAction?.(node)}
                />
              </li>
            ))}
          </ul>
          {footer}
        </>
      )}
    </div>
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
  onSelect,
  pins,
  onTogglePin
}: {
  node: RailNode;
  filters: TaskFilters;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  onSelect: (patch: Partial<TaskFilters>) => void;
  pins: RailPin[];
  onTogglePin?: (node: RailNode) => void;
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
        action={<PinButton node={node} pins={pins} onTogglePin={onTogglePin} />}
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
                action={<PinButton node={leaf} pins={pins} onTogglePin={onTogglePin} />}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

/**
 * Take a pinned row back off the band.
 *
 * A separate component from `PinButton` rather than a mode of it: that one is
 * asked *about a folder* and has to work out whether it is pinned, while this
 * one is on a row that is a pin by construction. Folding them together would
 * mean a control whose meaning depends on which list it was rendered into.
 */
const UnpinButton = ({
  node,
  onTogglePin
}: {
  node: RailNode;
  onTogglePin?: (node: RailNode) => void;
}) => {
  if (!onTogglePin) return null;

  return (
    <button
      type="button"
      onClick={() => onTogglePin(node)}
      aria-label={`Unpin ${node.label} from collections`}
      title={`Unpin ${node.label} — the folder itself is untouched`}
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-subtle-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <X size={11} />
    </button>
  );
};

/**
 * Pin this folder to the Collections band, or take it back off.
 *
 * **One control, both directions.** A `+` that only added would leave removal to
 * some other surface, and the row that shows you a folder is pinned is exactly
 * the row you are looking at when you decide it should not be.
 *
 * Hover-revealed while unpinned, permanent once pinned — an affordance you have
 * to go looking for is fine for an action, but the *state* has to be readable
 * without a pointer, and there is no hover on a touch screen at all. It stays in
 * the tab order either way, so the keyboard path does not depend on the mouse
 * path.
 *
 * Absent for a node with no patch: the `\Microsoft\` disclosure group is an
 * expander, not a destination, and pinning "the idea of system tasks" would
 * produce a row that selects nothing. `pinFromNode` refuses it independently —
 * this only avoids drawing a button that would be refused.
 */
const PinButton = ({
  node,
  pins,
  onTogglePin
}: {
  node: RailNode;
  pins: RailPin[];
  onTogglePin?: (node: RailNode) => void;
}) => {
  if (!onTogglePin || !node.patch) return null;
  const pinned = pinForNode(pins, node.key) !== undefined;

  return (
    <button
      type="button"
      onClick={() => onTogglePin(node)}
      aria-pressed={pinned}
      aria-label={
        pinned
          ? `Unpin ${node.label} from collections`
          : `Pin ${node.label} to collections`
      }
      title={
        pinned
          ? `Unpin ${node.label} — it stays in the tree`
          : `Pin ${node.label} to Collections. It keeps tracking this folder.`
      }
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
        pinned
          ? 'text-primary opacity-100'
          : 'text-subtle-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted'
      }`}
    >
      {pinned ? <Pin size={11} fill="currentColor" /> : <Plus size={12} />}
    </button>
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
  onSelect,
  action
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
  /**
   * A trailing control, rendered **outside** the row's own button.
   *
   * Outside because nesting it would put a button inside a button — invalid
   * markup that browsers recover from by dropping one, and the one they drop is
   * not the one you would choose. It also keeps the two jobs separate: the row
   * navigates, the action acts on the row, and a click can only ever mean one
   * of them.
   */
  action?: ReactNode;
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

      {action}
    </div>
  );
};

export default SourceRail;
