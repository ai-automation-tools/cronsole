import { useState } from 'react';
import { Bookmark, Plus, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useConfirm } from '../hooks/useConfirm';
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection
} from '../hooks/useCollections';

interface ManageCollectionsModalProps {
  onClose: () => void;
}

/**
 * Create, rename and delete collections.
 *
 * **Membership is not edited here, and that is deliberate.** Picking tasks needs
 * the tasks in front of you, so it belongs on the task itself
 * (`TaskCollectionMenu`) — a second membership editor here would be a list of
 * task names divorced from everything that makes a task identifiable, and two
 * controls doing one job is how they drift. This modal owns the collection as an
 * object; the task owns whether it is in one.
 *
 * Deleting asks for confirmation but **not** for a typed count, unlike the bulk
 * task actions. The friction rule is that it scales with blast radius, and this
 * blast radius is one grouping: no task is removed from Cronsole, nothing on the
 * machine changes, and re-adding is a few clicks. Demanding a typed
 * confirmation here would train the gesture that the destructive task actions
 * need it *not* to be routine.
 */
export const ManageCollectionsModal = ({ onClose }: ManageCollectionsModalProps) => {
  const { data: collections, isLoading } = useCollections();
  const createCollection = useCreateCollection();
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();
  const confirm = useConfirm();

  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const readError = (err: unknown, fallback: string) => {
    const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
    if (res?.status === 409) return 'You already have a collection with that name';
    return res?.data?.error || fallback;
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await createCollection.mutateAsync({ name: trimmed });
      setName('');
    } catch (err) {
      setError(readError(err, 'Could not create the collection'));
    }
  };

  const submitRename = async (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await updateCollection.mutateAsync({ id, name: trimmed });
      setEditingId(null);
    } catch (err) {
      setError(readError(err, 'Could not rename the collection'));
    }
  };

  const remove = async (id: string, label: string, count: number) => {
    const ok = await confirm({
      title: `Delete “${label}”?`,
      // States what survives, not only what goes. The word "delete" beside a
      // list of tasks invites exactly the wrong reading, and this control sits a
      // short distance from ones that really do remove tasks.
      message:
        count > 0
          ? `This removes the collection only. Its ${count} task${count === 1 ? '' : 's'} stay in Cronsole and keep running.`
          : 'This removes the collection. It has no tasks in it.',
      confirmText: 'Delete collection',
      tone: 'danger'
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteCollection.mutateAsync(id);
    } catch (err) {
      setError(readError(err, 'Could not delete the collection'));
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="manage-collections-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
      <div className="p-5">
        <h2 id="manage-collections-title" className="text-lg font-bold flex items-center gap-2">
          <Bookmark size={18} className="text-info-text" /> Collections
        </h2>
        <p className="mt-1 text-xs text-subtle-foreground">
          A collection is a set of tasks you pick by hand. Unlike a view, it is not a filter —
          it can hold tasks from different platforms that have nothing else in common. Add tasks
          from the bookmark button on any task.
        </p>

        <form onSubmit={submitCreate} className="mt-4 flex items-center gap-2">
          <input
            value={name}
            maxLength={60}
            onChange={e => setName(e.target.value)}
            placeholder="New collection name"
            aria-label="New collection name"
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={!name.trim() || createCollection.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            {createCollection.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Create
          </button>
        </form>

        {error && <p className="mt-2 text-xs text-danger-text">{error}</p>}

        <div className="mt-4">
          {isLoading ? (
            <p className="text-xs text-subtle-foreground">Loading…</p>
          ) : !collections?.length ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-subtle-foreground">
              No collections yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {collections.map(c => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"
                >
                  {editingId === c.id ? (
                    <>
                      <input
                        autoFocus
                        value={editingName}
                        maxLength={60}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') submitRename(c.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        aria-label={`Rename ${c.name}`}
                        className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => submitRename(c.id)}
                        aria-label="Save name"
                        className="text-success-text hover:opacity-80"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel rename"
                        className="text-subtle-foreground hover:text-foreground"
                      >
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <Bookmark size={14} className="shrink-0 text-info-text" />
                      <span className="flex-1 truncate text-sm text-foreground">{c.name}</span>
                      <span className="text-[11px] text-subtle-foreground">
                        {c.count} task{c.count === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditingName(c.name);
                          setError(null);
                        }}
                        aria-label={`Rename ${c.name}`}
                        className="text-subtle-foreground hover:text-foreground"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c.id, c.name, c.count)}
                        aria-label={`Delete ${c.name}`}
                        className="text-subtle-foreground hover:text-danger-text"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
};
