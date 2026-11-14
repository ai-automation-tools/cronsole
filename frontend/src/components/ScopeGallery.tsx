import { createElement, type ReactNode } from 'react';
import { Bookmark, CircleCheck, Clock, Link2, Pencil, Pin, PinOff, Plus, PowerOff, XOctagon, type LucideIcon } from 'lucide-react';
import { platformAccent, platformLabel, platformSourceLabel, sourceAccentGlyph, sourceIcon, sourcePlatform } from '../platform';
import type { Task } from '../types';
import { nextRunOf } from '../utils/taskFilters';
import { nextRunText } from '../utils/datetime';
import { useSettings } from '../hooks/useSettings';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { railNodeLink } from '../utils/savedViews';
import { collectionIdFromKey, type RailNode, type RailSection } from '../utils/sourceTree';
import type { TaskFilters } from '../utils/taskFilters';
import { collectionLink } from '../hooks/useCollections';
import { useToast } from '../hooks/useToast';
import { useBandReorder, withClass } from '../hooks/useBandReorder';

/**
 * **The scope galleries** — what the rail's *Collections* and *Pinned* rows open
 * in the main content area, one box per collection or pin.
 *
 * Both are lists of *places*, and the rail is already the tree; a second column
 * of rows beside it read as more tree. Here each place is a card — what it is,
 * its name, its count — and clicking one opens its tasks. Counts come straight
 * off the `buildSourceTree` pass the rail runs, so a card never re-derives one.
 * Drag (or Alt+↑/↓) reorders, through the same `onReorder` the rail's bands use,
 * so order is still written where each kind of record keeps it.
 *
 * The two stay **two galleries**, because a pin is not a collection: a
 * collection's members are declared and it can be renamed; a pin mirrors a real
 * folder, so it has no rename (a second name for a place that already has one)
 * and reads `0` — still removable — once the folder is gone.
 */

interface GalleryProps {
  nodes: RailNode[];
  onSelect: (patch: Partial<TaskFilters>) => void;
  onReorder: (section: RailSection, keys: string[]) => void;
  /** The tasks behind a card — the same rows the rail counted. Absent = count only. */
  membersOf?: (node: RailNode) => Task[];
}

const GRID = 'grid grid-cols-1 gap-4 pb-20 md:grid-cols-2 xl:grid-cols-3';

/**
 * A card's action: labelled, 32px tall, and tinted by **what it does** — info
 * for sharing, primary for editing, danger for taking something away. Role
 * tokens only (§9: never a raw palette utility), so both themes stay legible.
 */
const ACTION_TONE = {
  info: 'border-info/30 bg-info/10 text-info-text hover:bg-info/20',
  primary: 'border-primary/30 bg-primary/10 text-primary-text hover:bg-primary/20',
  danger: 'border-danger/30 bg-danger/10 text-danger-text hover:bg-danger/20'
} as const;

const ActionButton = ({
  tone,
  icon,
  text,
  ariaLabel,
  title,
  onClick
}: {
  tone: keyof typeof ACTION_TONE;
  icon: ReactNode;
  text: string;
  ariaLabel: string;
  title: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    title={title}
    className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${ACTION_TONE[tone]}`}
  >
    {icon}
    {text}
  </button>
);

/** Copy a shareable URL, and say whether it worked. */
const CopyLinkButton = ({ label, url }: { label: string; url: string }) => {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(`Link to “${label}” copied.`, 'success');
    } catch {
      toast('Could not copy the link.', 'error');
    }
  };
  return (
    <ActionButton
      tone="info"
      icon={<Link2 size={14} />}
      text="Copy link"
      ariaLabel={`Copy link to ${label}`}
      title="Copy a link to share"
      onClick={copy}
    />
  );
};

/**
 * What a card can say about its tasks, beyond the count: which sources they
 * come from, how many run, how many last failed, and the soonest next run.
 * Everything here is read off the same task rows the rail counted.
 */
function summarize(members: Task[], now: Date) {
  const bySource = new Map<string, number>();
  let active = 0;
  let failed = 0;
  let off = 0;
  let next: Date | null = null;
  for (const t of members) {
    bySource.set(t.platform, (bySource.get(t.platform) ?? 0) + 1);
    if (t.status === 'ACTIVE') active++;
    else off++;
    if (t.lastRunStatus === 'FAILURE') failed++;
    // A task that is off does not run, whatever its schedule says.
    const at = t.status === 'ACTIVE' ? nextRunOf(t) : null;
    if (at && at >= now && (!next || at < next)) next = at;
  }
  const mix = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  return { mix, active, failed, off, next };
}

/**
 * One place, as a box. Its colour is its **source's** — a pin's platform, or the
 * platform most of a collection's tasks come from — so the tint says something
 * true rather than decorating. Role tokens only, through `platformAccent`.
 */
const GalleryCard = ({
  node,
  kind,
  icon,
  platform,
  members,
  showSources = false,
  actions,
  emptyNote,
  onSelect
}: {
  node: RailNode;
  kind: string;
  /** List the sources under the bar — for a collection, which can mix them. */
  showSources?: boolean;
  icon: LucideIcon;
  /** The accent's platform; `null` = no tasks to take a colour from. */
  platform: string | null;
  members: Task[];
  actions: ReactNode;
  emptyNote: string;
  onSelect: (patch: Partial<TaskFilters>) => void;
}) => {
  const now = useMinuteClock();
  const { settings } = useSettings();
  const accent = platform ? platformAccent(platform) : { tile: 'bg-primary/10', rule: 'bg-primary/40' };
  const glyph = platform ? sourceAccentGlyph(platform) : 'text-primary-text';
  const { mix, active, failed, off, next } = summarize(members, now);
  // The bar's three parts: running fine, last run failed, turned off.
  const healthy = Math.max(active - failed, 0);
  const pct = (n: number) => `${(n / members.length) * 100}%`;
  const Icon = icon;

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-xl">
      {/* Identity band, and a soft glow of the same colour behind the header. */}
      <div aria-hidden className={`h-1.5 w-full ${accent.rule}`} />
      <div aria-hidden className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-40 blur-3xl ${accent.rule}`} />

      <div className="relative flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={() => node.patch && onSelect(node.patch)}
          aria-label={`Open ${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
          title={node.label}
          className="flex flex-1 flex-col items-stretch rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="flex items-start gap-3">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-border ${accent.tile} ${glyph}`}>
              <Icon size={20} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{kind}</span>
              <span className="mt-0.5 block truncate text-base font-bold leading-snug text-foreground">{node.label}</span>
            </span>
            <span className="shrink-0 text-right leading-none">
              <span className="block text-3xl font-black tabular-nums text-foreground">{node.count}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
                task{node.count === 1 ? '' : 's'}
              </span>
            </span>
          </span>

          {members.length > 0 ? (
            <>
              {/* How the set is doing, at a glance: running fine · last run failed · off. */}
              <span className="mt-4 flex h-2 w-full gap-px overflow-hidden rounded-full bg-background" aria-hidden>
                {healthy > 0 && <span className="bg-success" style={{ width: pct(healthy) }} />}
                {failed > 0 && <span className="bg-danger" style={{ width: pct(failed) }} />}
                {off > 0 && <span className="bg-muted-foreground/40" style={{ width: pct(off) }} />}
              </span>
              {showSources && <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {mix.slice(0, 4).map(([p, n]) => (
                  <span key={p} className="flex items-center gap-1">
                    {createElement(sourceIcon(p), { size: 11, 'aria-hidden': true, className: sourceAccentGlyph(p) })}
                    {platformLabel(p)} <span className="font-semibold tabular-nums text-foreground">{n}</span>
                  </span>
                ))}
                {mix.length > 4 && <span>+{mix.length - 4} more</span>}
              </span>}
              <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                {active > 0 && (
                  <span className="flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-success-text">
                    <CircleCheck size={11} aria-hidden /> {active} active
                  </span>
                )}
                {failed > 0 && (
                  <span className="flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-danger-text">
                    <XOctagon size={11} aria-hidden /> {failed} failed
                  </span>
                )}
                {off > 0 && (
                  <span className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-muted-foreground">
                    <PowerOff size={11} aria-hidden /> {off} off
                  </span>
                )}
                {next && (
                  <span className="flex items-center gap-1 rounded-md border border-info/30 bg-info/10 px-1.5 py-0.5 text-info-text" title={`Next run ${next.toLocaleString()}`}>
                    <Clock size={11} aria-hidden /> Next {nextRunText(next, settings.timezone, now).replace(/^In /, 'in ')}
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="mt-4 text-xs text-muted-foreground">
              {node.count === 0 ? `No tasks${emptyNote}` : ' '}
            </span>
          )}
        </button>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">{actions}</div>
      </div>
    </div>
  );
};

/** The platform most of these tasks come from — the card's colour. */
const dominantPlatform = (members: Task[]): string | null => summarize(members, new Date(0)).mix[0]?.[0] ?? null;

const EmptyGallery = ({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) => (
  <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border px-6 py-20 text-center text-subtle-foreground">
    {icon}
    <p className="font-bold text-foreground">{title}</p>
    {children}
  </div>
);

export const PinnedGallery = ({
  nodes,
  onSelect,
  onTogglePin,
  onReorder,
  membersOf
}: GalleryProps & { onTogglePin: (node: RailNode) => void }) => {
  const drag = useBandReorder('pinned', nodes.map(n => n.key), onReorder);

  if (nodes.length === 0) {
    return (
      <EmptyGallery icon={<Pin size={40} className="mb-4 opacity-30" />} title="Nothing pinned yet">
        <p className="mt-2 max-w-md text-xs leading-relaxed">
          Pin a folder to keep it one click away. In the sidebar under <strong className="text-muted-foreground">Sources</strong>,
          open a source, hover a folder and press <strong className="text-muted-foreground">+</strong>. A pin keeps
          tracking the folder as tasks come and go.
        </p>
      </EmptyGallery>
    );
  }

  return (
    <ul data-testid="pinned-gallery" className={GRID}>
      {nodes.map(node => {
        const source = node.patch?.source;
        return (
          <li key={node.key} {...withClass(drag(node.key), 'min-w-0')}>
            <GalleryCard
              node={node}
              onSelect={onSelect}
              kind={`Pinned · ${source ? platformSourceLabel(source) : 'Unknown source'}`}
              icon={source ? sourceIcon(source) : Pin}
              platform={source ? sourcePlatform(source) : null}
              members={membersOf?.(node) ?? []}
              emptyNote=" — the folder is empty or gone"
              actions={
                <>
                  {node.patch && <CopyLinkButton label={node.label} url={railNodeLink(node.patch)} />}
                  <ActionButton
                    tone="danger"
                    icon={<PinOff size={14} />}
                    text="Unpin"
                    ariaLabel={`Unpin ${node.label}`}
                    title={`Unpin ${node.label} — the folder itself is untouched`}
                    onClick={() => onTogglePin(node)}
                  />
                </>
              }
            />
          </li>
        );
      })}
    </ul>
  );
};

/**
 * Collections, one box each. Rename opens the manager in edit mode (a text
 * field inside a card is a control nobody can hit on a phone); deleting stays
 * in the manager, behind its confirmation, because it destroys a set you built.
 */
export const CollectionsGallery = ({
  nodes,
  onSelect,
  onReorder,
  onManage,
  membersOf
}: GalleryProps & { onManage: (renameId?: string) => void }) => {
  const drag = useBandReorder('collection', nodes.map(n => n.key), onReorder);

  const manageButton = (
    <button
      type="button"
      onClick={() => onManage()}
      className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <Plus size={14} />
      {nodes.length ? 'New or manage collections' : 'New collection'}
    </button>
  );

  if (nodes.length === 0) {
    return (
      <EmptyGallery icon={<Bookmark size={40} className="mb-4 opacity-30" />} title="No collections yet">
        <p className="mb-5 mt-2 max-w-md text-xs leading-relaxed">
          A collection holds exactly the tasks you put in it, from any source. Make one here, then
          add tasks with the bookmark on any task card.
        </p>
        {manageButton}
      </EmptyGallery>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{manageButton}</div>
      <ul data-testid="collections-gallery" className={GRID}>
        {nodes.map(node => {
          const id = collectionIdFromKey(node.key);
          const members = membersOf?.(node) ?? [];
          return (
            <li key={node.key} {...withClass(drag(node.key), 'min-w-0')}>
              <GalleryCard
                node={node}
                onSelect={onSelect}
                kind="Collection"
                icon={Bookmark}
                platform={dominantPlatform(members)}
                members={members}
                showSources
                emptyNote=" — add some with the bookmark on a task card"
                actions={
                  id && (
                    <>
                      <CopyLinkButton label={node.label} url={collectionLink(id)} />
                      <ActionButton
                        tone="primary"
                        icon={<Pencil size={14} />}
                        text="Rename"
                        ariaLabel={`Rename ${node.label}`}
                        title="Rename this collection"
                        onClick={() => onManage(id)}
                      />
                    </>
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
};
