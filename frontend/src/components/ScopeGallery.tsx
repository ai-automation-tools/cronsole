import { createElement, type ReactNode } from 'react';
import { Bookmark, Link2, Pencil, Pin, PinOff, Plus } from 'lucide-react';
import { platformSourceLabel, sourceAccentGlyph, sourceIcon } from '../platform';
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

/** One place, as a box: what it is, its name and count, then its actions under a rule. */
const GalleryCard = ({
  node,
  header,
  actions,
  emptyNote,
  onSelect
}: {
  node: RailNode;
  header: ReactNode;
  actions: ReactNode;
  emptyNote: string;
  onSelect: (patch: Partial<TaskFilters>) => void;
}) => (
  <div className="group flex h-full flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-ring/40">
    <div className="flex min-w-0 items-center gap-1.5 text-xs">{header}</div>
    <button
      type="button"
      onClick={() => node.patch && onSelect(node.patch)}
      aria-label={`Open ${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
      title={node.label}
      className="mt-3 flex flex-1 flex-col items-start rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="w-full truncate text-base font-bold leading-snug">{node.label}</span>
      <span className="mt-1 text-xs text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{node.count}</span>{' '}
        task{node.count === 1 ? '' : 's'}
        {node.count === 0 && emptyNote}
      </span>
    </button>
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">{actions}</div>
  </div>
);

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
  onReorder
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
              emptyNote=" — the folder is empty or gone"
              header={
                <>
                  {source && createElement(sourceIcon(source), {
                    size: 14,
                    'aria-hidden': true,
                    className: `shrink-0 ${sourceAccentGlyph(source)}`
                  })}
                  <span className="truncate font-semibold text-foreground">
                    {source ? platformSourceLabel(source) : 'Unknown source'}
                  </span>
                </>
              }
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
  onManage
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
          return (
            <li key={node.key} {...withClass(drag(node.key), 'min-w-0')}>
              <GalleryCard
                node={node}
                onSelect={onSelect}
                emptyNote=" — add some with the bookmark on a task card"
                header={
                  <>
                    <Bookmark size={14} aria-hidden className="shrink-0 text-primary-text" />
                    <span className="truncate font-semibold text-foreground">Collection</span>
                  </>
                }
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
