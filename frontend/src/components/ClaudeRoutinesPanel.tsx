import { useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  useAddClaudeRoutine,
  useClaudeRoutines,
  useEditClaudeRoutine,
  useRemoveClaudeRoutine,
  type ClaudeRoutine
} from '../hooks/useClaudeRoutines';
import { errorMessage } from '../utils/errorMessage';
import { ConnectionField as Field } from './sources/ConnectionField';

/**
 * **Declare a Claude routine so Cronsole can fire it.**
 *
 * Every other platform's credentials arrive some other way — the Windows agent
 * pairs, Cronsole-native needs none — so this is the only place in the product a
 * user types a third-party secret in. Three things follow, and each is the
 * reason for something on screen:
 *
 * **Cronsole cannot discover a routine.** Claude Code exposes one endpoint
 * (`/fire`) whose token has no read access, so there is nothing to browse and no
 * "import" button to offer. The list is a registry the user maintains, which is
 * unusual enough that the panel says so rather than leaving it to be inferred
 * from the absence of a Sync button.
 *
 * **The token is write-only.** It is never sent back, so a stored routine shows
 * *Token stored* and not a masked value — a row of dots implies something is
 * there to reveal. Losing it means regenerating at claude.ai, which is also the
 * only recovery Anthropic offers.
 *
 * **Removing is not deleting.** Cronsole cannot delete a Claude routine and never
 * will. A button labelled "Delete" would let someone believe they had stopped a
 * nightly job that is still running — so it says *Remove*, and the confirmation
 * says where the routine keeps running.
 */
export const ClaudeRoutinesPanel = () => {
  const { data: routines = [], isLoading } = useClaudeRoutines();
  const add = useAddClaudeRoutine();
  const edit = useEditClaudeRoutine();
  const remove = useRemoveClaudeRoutine();

  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // The routine currently being corrected, or null. Separate from the add form:
  // editing never asks for a token, which is the whole point of it existing.
  const [editing, setEditing] = useState<ClaudeRoutine | null>(null);
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');

  const startEdit = (routine: ClaudeRoutine) => {
    setEditing(routine);
    setEditId(routine.id);
    setEditName(routine.name ?? '');
    setError(null);
    setWarnings([]);
    setOpen(false);
  };

  const submitEdit = async () => {
    if (!editing) return;
    setError(null);
    setWarnings([]);
    const nextId = editId.trim();
    const nextName = editName.trim();
    const changed = {
      ...(nextId && nextId !== editing.id ? { id: nextId } : {}),
      ...(nextName !== (editing.name ?? '') ? { name: nextName } : {})
    };
    if (!Object.keys(changed).length) {
      setEditing(null);
      return;
    }
    try {
      const result = await edit.mutateAsync({ routineId: editing.id, ...changed });
      setWarnings(result.warnings ?? []);
      setEditing(null);
    } catch (e) {
      setError(errorMessage(e, 'Could not update that routine.'));
    }
  };

  const reset = () => {
    setId(''); setToken(''); setName(''); setError(null); setOpen(false);
  };

  const submit = async () => {
    setError(null);
    setWarnings([]);
    try {
      const result = await add.mutateAsync({
        id: id.trim(),
        token: token.trim(),
        ...(name.trim() ? { name: name.trim() } : {})
      });
      setWarnings(result.warnings);
      reset();
    } catch (e) {
      setError(errorMessage(e, 'Could not save that routine.'));
    }
  };

  const onRemove = async (routine: ClaudeRoutine) => {
    // Named in full, and the count is stated before the click rather than
    // reported after it — the same rule the bulk recategorize dialog follows.
    const stranded = routine.taskCount === 1
      ? '\n\n1 tracked task points at it and will stop being runnable until you re-add it.'
      : routine.taskCount > 1
        ? `\n\n${routine.taskCount} tracked tasks point at it and will stop being runnable until you re-add it.`
        : '';
    const ok = window.confirm(
      `Remove "${routine.name || routine.id}" from Cronsole?\n\n` +
        'The routine itself keeps running at claude.ai on its own schedule — Cronsole has no API to ' +
        'stop or delete it. This only forgets the id and token stored here.' +
        stranded
    );
    if (!ok) return;
    try {
      await remove.mutateAsync(routine.id);
    } catch (e) {
      setError(errorMessage(e, 'Could not remove that routine.'));
    }
  };

  return (
    <div className="border-t border-border px-5 py-4 space-y-3" data-testid="claude-routines-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h5 className="text-xs font-black uppercase tracking-widest text-subtle-foreground">Routines</h5>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-prose">
            Claude Code has no API to list your routines, so Cronsole can't find them — add each one
            here with the id and token from its{' '}
            <span className="font-bold text-foreground">API trigger</span>. Everything else about the
            routine stays at claude.ai.
          </p>
        </div>
        <a
          href="https://claude.ai/code/routines"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-claude-text hover:underline"
        >
          Open routines <ExternalLink size={11} />
        </a>
      </div>

      {isLoading ? (
        <p className="text-[11px] text-subtle-foreground">Loading…</p>
      ) : routines.length === 0 ? (
        <p className="text-[11px] text-subtle-foreground">No routines added yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {routines.map(routine => (
            <li
              key={routine.id}
              className="flex items-center justify-between gap-3 bg-muted/40 border border-border rounded-xl px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{routine.name || routine.id}</p>
                <p className="text-[10px] text-subtle-foreground font-mono truncate">{routine.id}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {/*
                  "Token stored", not a masked value: dots imply something is
                  there to reveal, and there is not — the token is never sent
                  back, and claude.ai cannot re-display it either.
                */}
                <span className="text-[10px] font-bold text-success-text">Token stored</span>
                {routine.taskCount > 0 && (
                  <span className="text-[10px] text-subtle-foreground tabular-nums">
                    {routine.taskCount} task{routine.taskCount === 1 ? '' : 's'}
                  </span>
                )}
                {/*
                  Edit exists so a mistyped id does not cost a token. Removing
                  and re-adding discards the stored credential, and claude.ai
                  shows a token once — so the cheap fix would force the
                  expensive recovery.
                */}
                <button
                  onClick={() => startEdit(routine)}
                  title={`Fix the id or rename ${routine.name || routine.id} (keeps the stored token)`}
                  aria-label={`Edit ${routine.name || routine.id}`}
                  className="p-1 rounded-lg text-subtle-foreground hover:text-foreground transition-colors"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => onRemove(routine)}
                  disabled={remove.isPending}
                  title={`Remove ${routine.name || routine.id} from Cronsole (the routine keeps running at claude.ai)`}
                  aria-label={`Remove ${routine.name || routine.id} from Cronsole`}
                  className="p-1 rounded-lg text-subtle-foreground hover:text-danger-text transition-colors disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="bg-background border border-claude/40 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-claude-text">
            Fix “{editing.name || editing.id}”
          </p>
          <Field
            label="Routine id or fire URL"
            hint="The trig_… value. Pasting the routine's name here is the usual mistake — that is what this fixes."
            value={editId}
            onChange={setEditId}
            placeholder="trig_01…"
          />
          <Field
            label="Name"
            hint="What it is called on the dashboard."
            value={editName}
            onChange={setEditName}
            placeholder={editing.id}
          />
          {/*
            No token field, and its absence is the feature: the stored token is
            kept, so correcting a typo costs nothing. Rotating a token is the
            Add form's job — re-adding the same id replaces it.
          */}
          <p className="text-[10px] text-subtle-foreground">
            The stored token is kept.{' '}
            {editing.taskCount > 0 && (
              <>
                {editing.taskCount} tracked task{editing.taskCount === 1 ? '' : 's'} will move with the id,
                keeping run history and stars.{' '}
              </>
            )}
            To replace the token instead, add the routine again with the same id.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setEditing(null)}
              className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
            >
              <X size={12} className="inline mr-1" />Cancel
            </button>
            <button
              onClick={submitEdit}
              disabled={!editId.trim() || edit.isPending}
              className="flex items-center gap-1.5 bg-claude hover:bg-claude/85 disabled:opacity-40 px-4 py-1.5 rounded-xl text-[11px] font-bold text-white transition-all active:scale-95"
            >
              {edit.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="text-[11px] text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2 space-y-1">
          {warnings.map(w => (
            <p key={w} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}
            </p>
          ))}
          <p className="opacity-80">Saved anyway — the routines API is experimental, so this is a hint, not a refusal.</p>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {open ? (
        <div className="bg-background border border-border rounded-xl p-3 space-y-2">
          <Field
            label="Routine id or fire URL"
            hint="From Edit routine → Add another trigger → API. Pasting the whole URL is fine."
            value={id}
            onChange={setId}
            placeholder="trig_01…  or  https://api.anthropic.com/v1/claude_code/routines/trig_01…/fire"
          />
          <Field
            label="API token"
            hint="Click Generate token in the same dialog. Shown once — and generating a new one revokes the previous."
            value={token}
            onChange={setToken}
            placeholder="sk-ant-oat01-…"
            secret
          />
          <Field
            label="Name (optional)"
            hint="What to call it on the dashboard. Defaults to the id."
            value={name}
            onChange={setName}
            placeholder="Nightly PR review"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={reset}
              className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
            >
              <X size={12} className="inline mr-1" />Cancel
            </button>
            <button
              onClick={submit}
              disabled={!id.trim() || !token.trim() || add.isPending}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 px-4 py-1.5 rounded-xl text-[11px] font-bold text-primary-foreground transition-all active:scale-95"
            >
              {add.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add routine
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95"
        >
          <Plus size={12} /> Add a routine
        </button>
      )}
    </div>
  );
};

export default ClaudeRoutinesPanel;
