import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Plus, Loader2 } from 'lucide-react';
import type { Task } from '../types';
import {
  useCollections,
  useCreateCollection,
  useSetCollectionMembers
} from '../hooks/useCollections';

interface TaskCollectionMenuProps {
  task: Task;
  size?: number;
  className?: string;
}

/**
 * "Which collections is this task in?" — a checklist, and the only place a task
 * joins one.
 *
 * **A checklist rather than a star**, because the two gestures differ in a way
 * that decides the control. Favoriting is one binary thing, so a star can be a
 * single toggle sitting inline. A task can be in any number of collections, so
 * the honest control has to *show the set* and let you tick within it — a
 * button cycling through collections would be unreadable at three.
 *
 * **Each tick writes immediately** rather than collecting into a Save. There is
 * nothing to be consistent with — memberships are independent rows, no platform
 * is contacted, and nothing here can fail in a way that leaves the task in a
 * state the user did not ask for. A Save button would be pure ceremony over a
 * write that already cannot half-apply.
 *
 * Creating from here is deliberate: the moment you discover a task needs a home
 * is the moment you want the home, and sending the user to a separate manager to
 * come back afterwards is the friction that stops collections being used at all.
 */
export const TaskCollectionMenu = ({ task, size = 18, className = '' }: TaskCollectionMenuProps) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: collections } = useCollections();
  const setMembers = useSetCollectionMembers();
  const createCollection = useCreateCollection();

  const memberOf = new Set(task.collectionIds ?? []);
  const count = memberOf.size;

  // Close on an outside click or Escape. Not a Modal: this is a menu attached to
  // a control, and the task modal it lives inside already owns the focus trap —
  // nesting a second one would fight it for the Escape key.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const toggle = (collectionId: string) => {
    setError(null);
    const isMember = memberOf.has(collectionId);
    setMembers.mutate({
      id: collectionId,
      ...(isMember ? { remove: [task.id] } : { add: [task.id] })
    });
  };

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      // Created *with* the task in it — one call, so a collection can never be
      // made and then fail to receive the task that motivated it.
      await createCollection.mutateAsync({ name: trimmed, taskIds: [task.id] });
      setName('');
      setCreating(false);
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
      setError(
        res?.status === 409
          ? 'You already have a collection with that name'
          : res?.data?.error || 'Could not create the collection'
      );
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setOpen(v => !v);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={
          count > 0
            ? `${task.name} is in ${count} collection${count === 1 ? '' : 's'}. Edit collections`
            : `Add ${task.name} to a collection`
        }
        title={count > 0 ? `In ${count} collection${count === 1 ? '' : 's'}` : 'Add to a collection'}
        className={`shrink-0 transition-colors ${
          count > 0 ? 'text-info-text' : 'text-subtle-foreground hover:text-info-text'
        }`}
      >
        <Bookmark size={size} className={count > 0 ? 'fill-current' : ''} />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1.5 w-60 rounded-xl border border-border bg-surface shadow-xl p-1.5"
          onClick={e => e.stopPropagation()}
        >
          <p className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-subtle-foreground">
            Collections
          </p>

          {collections && collections.length > 0 ? (
            <ul className="max-h-56 overflow-y-auto">
              {collections.map(c => {
                const isMember = memberOf.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c.id)}
                      // Not disabled while saving: a disabled row loses focus and
                      // cannot be re-read by a screen reader mid-write, and these
                      // writes are idempotent, so a double click is harmless.
                      aria-pressed={isMember}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isMember ? 'bg-info border-info text-info-foreground' : 'border-border'
                        }`}
                      >
                        {isMember && <Check size={11} />}
                      </span>
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto text-[10px] text-subtle-foreground">{c.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            // Names what a collection IS, because an empty list here is most
            // people's first encounter with the feature.
            <p className="px-2 py-1.5 text-[11px] text-subtle-foreground">
              No collections yet. A collection is a set of tasks you pick by hand —
              they can come from any platform.
            </p>
          )}

          {creating ? (
            <form onSubmit={submitNew} className="mt-1 border-t border-border pt-1.5 px-1">
              <input
                ref={inputRef}
                value={name}
                maxLength={60}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setCreating(false);
                    setName('');
                  }
                }}
                placeholder="Collection name"
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="submit"
                  disabled={!name.trim() || createCollection.isPending}
                  className="flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
                >
                  {createCollection.isPending && <Loader2 size={11} className="animate-spin" />}
                  Create &amp; add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setName('');
                    setError(null);
                  }}
                  className="rounded-lg px-2 py-1 text-[11px] text-subtle-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-2 pt-2 pb-1.5 text-left text-[11px] font-bold text-subtle-foreground hover:text-foreground transition-colors"
            >
              <Plus size={12} /> New collection
            </button>
          )}

          {/* A refusal is a sentence in the control, never a disabled button with
              the reason in a title= — the phone this app must work on cannot
              show a tooltip. */}
          {error && <p className="px-2 pt-1.5 text-[11px] text-danger-text">{error}</p>}
        </div>
      )}
    </div>
  );
};
