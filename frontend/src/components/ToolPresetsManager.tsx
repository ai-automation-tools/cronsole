import { useState } from 'react';
import { Plus, X, KeyRound, Loader2, RefreshCw, Bookmark, AlertTriangle, Check } from 'lucide-react';
import {
  useGeminiToolPresets,
  useSaveGeminiToolPreset,
  useDeleteGeminiToolPreset,
  useApplyGeminiToolPreset
} from '../hooks/useGeminiConnection';
import { useToast } from '../hooks/useToast';
import { useConfirm } from '../hooks/useConfirm';
import type { ToolPreset } from '../utils/agentReach';

/**
 * **Saved MCP servers, and the rotation that made them worth building.**
 *
 * This panel exists because the rule it replaced was built on a lifecycle claim
 * that live use falsified. A credential handed to Gemini was "used once and
 * stored nowhere" — true of *one* create, and false of every workflow: needed
 * again for the second trigger on the same server, again on every prompt edit
 * (Gemini's triggers are immutable, so editing means recreating), and again for
 * every trigger that used a token you rotated.
 *
 * **The rotation is the feature.** Before it, changing one MCP token meant
 * opening every Gemini task and retyping the token into each, from memory, with
 * nothing on any screen saying which tasks were affected — and a task missed
 * fails silently, later, on a schedule, as somebody else's 401.
 *
 * **What did not change is what leaves the server.** A stored credential is
 * reported as `hasHeaders` and never as a value, there is no reveal, and no
 * masked field pretends to be one. The task references the *name*; the value
 * lives here, encrypted beside the API key — which is the larger credential of
 * the two and has been stored all along.
 */
export function ToolPresetsManager() {
  const { data, isLoading } = useGeminiToolPresets();
  const save = useSaveGeminiToolPreset();
  const remove = useDeleteGeminiToolPreset();
  const apply = useApplyGeminiToolPreset();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const presets = data?.presets ?? [];
  const atLimit = presets.length >= (data?.max ?? 20);

  const onApply = async (preset: ToolPreset) => {
    const ok = await confirm({
      title: `Rebuild ${preset.usedBy} trigger${preset.usedBy === 1 ? '' : 's'}?`,
      // **Recreate, said plainly.** Gemini assigns a new trigger id, and a dialog
      // offering to "update" would be describing something the platform cannot do.
      message:
        `Gemini cannot change a trigger in place, so each one using ${preset.name} is recreated with ` +
        'the stored credential — same schedule, prompt and agent, new id on Gemini. Each task keeps ' +
        'its run history, favourite and collections. Each is rebuilt before the old one is removed, ' +
        'so a failure leaves the working trigger alone.',
      confirmText: 'Rebuild them'
    });
    if (!ok) return;

    try {
      const result = await apply.mutateAsync(preset.name);
      const failed = result.applied.filter(a => !a.ok);
      const doubled = result.applied.filter(a => a.ok && !a.oldRemoved);
      // **Per task, never per batch.** A fan-out with one verdict over it is a
      // lie in one direction or the other, and the two bad outcomes here are
      // different: a refusal left the trigger alone, a surviving original means
      // the schedule now fires twice.
      toast(result.message, failed.length || doubled.length ? 'error' : 'success');
      for (const row of [...failed, ...doubled]) {
        toast(`${row.name}: ${row.message ?? 'the original trigger is still on Gemini'}`, 'error');
      }
    } catch (err) {
      const e = err as Error & { response?: { data?: { error?: string } } };
      toast(e.response?.data?.error || e.message, 'error');
    }
  };

  const onDelete = async (preset: ToolPreset) => {
    const ok = await confirm({
      title: `Forget ${preset.name}?`,
      message: preset.usedBy
        ? `${preset.usedBy} trigger${preset.usedBy === 1 ? '' : 's'} using it keep running — Gemini ` +
          'holds their credentials and nothing here can reach into a trigger that already exists. ' +
          'What you lose is rotating them together.'
        : 'Nothing is using it. The stored credential is deleted.',
      confirmText: 'Forget it',
      tone: 'danger'
    });
    if (!ok) return;

    try {
      const result = await remove.mutateAsync(preset.name);
      toast(result.message, 'success');
    } catch (err) {
      const e = err as Error & { response?: { data?: { error?: string } } };
      toast(e.response?.data?.error || e.message, 'error');
    }
  };

  return (
    <div className="bg-muted/40 border border-border rounded-xl px-3 py-2.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black text-foreground flex items-center gap-1.5">
          <Bookmark size={12} className="text-gemini-text" /> Saved MCP servers
        </span>
        {!adding && !atLimit && (
          <button
            onClick={() => { setAdding(true); setEditing(null); }}
            className="text-[10px] font-bold text-gemini-text hover:underline flex items-center gap-1"
          >
            <Plus size={11} /> Add server
          </button>
        )}
      </div>

      <p className="text-[10px] text-subtle-foreground">
        A server saved here is picked by name when you create a trigger, so its token is typed once
        instead of once per task. Cronsole stores it encrypted beside your API key and never shows it
        again — the same rule the key follows.
      </p>

      {isLoading && <p className="text-[10px] text-subtle-foreground">Loading…</p>}

      {!isLoading && presets.length === 0 && !adding && (
        <p className="text-[10px] text-subtle-foreground italic">
          None yet. Without one, every trigger needs its MCP server and token typed in again — and
          again each time you edit its prompt, because Gemini triggers cannot be edited in place.
        </p>
      )}

      {presets.map(preset => (
        <div key={preset.name} className="bg-background border border-border rounded-lg px-2.5 py-2 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono font-bold text-foreground truncate">{preset.name}</span>
                {preset.hasHeaders && (
                  <KeyRound size={9} className="text-gemini-text shrink-0" aria-label="credential stored" />
                )}
              </span>
              <span className="block text-[10px] text-subtle-foreground font-mono truncate">{preset.url}</span>
              <span className="block text-[10px] text-subtle-foreground">
                {preset.usedBy === 0
                  ? 'Not used by any trigger yet'
                  : `Used by ${preset.usedBy} trigger${preset.usedBy === 1 ? '' : 's'}`}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => { setEditing(editing === preset.name ? null : preset.name); setAdding(false); }}
                className="text-[10px] font-bold text-muted-foreground hover:text-foreground px-1.5 py-1"
              >
                {editing === preset.name ? 'Cancel' : 'Edit'}
              </button>
              <button
                onClick={() => onDelete(preset)}
                aria-label={`Forget ${preset.name}`}
                className="px-1.5 py-1 text-subtle-foreground hover:text-danger-text"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {preset.usedBy > 0 && preset.hasHeaders && (
            <button
              onClick={() => onApply(preset)}
              disabled={apply.isPending}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold bg-gemini/10 hover:bg-gemini/20 text-gemini-text border border-gemini/40 disabled:opacity-50 transition-colors"
            >
              {apply.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Push this credential to {preset.usedBy} trigger{preset.usedBy === 1 ? '' : 's'}
            </button>
          )}

          {editing === preset.name && (
            <PresetForm
              preset={preset}
              busy={save.isPending}
              onCancel={() => setEditing(null)}
              onSave={async values => {
                try {
                  await save.mutateAsync(values);
                  toast(`Saved ${values.name}.`, 'success');
                  setEditing(null);
                } catch (err) {
                  const e = err as Error & { response?: { data?: { error?: string } } };
                  toast(e.response?.data?.error || e.message, 'error');
                }
              }}
            />
          )}
        </div>
      ))}

      {adding && (
        <PresetForm
          busy={save.isPending}
          onCancel={() => setAdding(false)}
          onSave={async values => {
            try {
              await save.mutateAsync(values);
              toast(`Saved ${values.name}.`, 'success');
              setAdding(false);
            } catch (err) {
              const e = err as Error & { response?: { data?: { error?: string } } };
              toast(e.response?.data?.error || e.message, 'error');
            }
          }}
        />
      )}

      {atLimit && !adding && (
        <p className="text-[10px] text-warning-text flex items-start gap-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          That is the maximum for one connection. Remove one to add another.
        </p>
      )}
    </div>
  );
}

/**
 * The add/edit form.
 *
 * **The token field is empty on an edit, and the hint says why rather than
 * apologising.** Cronsole did not read the stored value — there is nothing to
 * prefill and nothing that could have leaked. Leaving it blank *keeps* what is
 * stored, so fixing a typo in a URL does not require having the token to hand,
 * which is exactly the friction this whole feature removes.
 */
function PresetForm({
  preset,
  busy,
  onSave,
  onCancel
}: {
  preset?: ToolPreset;
  busy: boolean;
  onSave: (values: { name: string; url: string; headers?: Record<string, string> }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(preset?.name ?? '');
  const [url, setUrl] = useState(preset?.url ?? '');
  const [token, setToken] = useState('');

  const submit = () => {
    onSave({
      name: name.trim(),
      url: url.trim(),
      // Absent means "leave the stored credential alone"; a typed value replaces
      // it. Both intents are expressible, and neither is the accident of an
      // untouched field.
      ...(token.trim() ? { headers: { Authorization: token.trim() } } : {})
    });
  };

  return (
    <div className="space-y-1.5 pt-1.5 border-t border-border">
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="resend"
          aria-label="Server name"
          disabled={Boolean(preset)}
          className="w-1/3 bg-surface border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-gemini disabled:opacity-60"
        />
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/mcp"
          aria-label="Server URL"
          className="flex-1 bg-surface border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-gemini"
        />
      </div>
      <input
        type="password"
        value={token}
        onChange={e => setToken(e.target.value)}
        placeholder={preset?.hasHeaders ? 'Leave blank to keep the stored token' : 'Authorization header (optional)'}
        aria-label="Authorization header"
        className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-gemini"
      />
      <div className="flex gap-1.5">
        <button
          onClick={onCancel}
          className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold bg-background border border-border text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || !name.trim() || !url.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold bg-gemini/10 hover:bg-gemini/20 text-gemini-text border border-gemini/40 disabled:opacity-40"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          {preset ? 'Save changes' : 'Save server'}
        </button>
      </div>
      {preset && (
        <p className="text-[10px] text-subtle-foreground italic">
          Saving here does not touch triggers that already exist — use <b>Push this credential</b> above
          to rebuild them.
        </p>
      )}
    </div>
  );
}

export default ToolPresetsManager;
