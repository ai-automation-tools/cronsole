import { useState } from 'react';
import { Terminal, FolderOpen, Globe, FileCode, Activity } from 'lucide-react';
import {
  parseHeaders,
  discardedByTypeSwitch,
  SCRIPT_INTERPRETERS,
  type CheckKind,
  type JobType,
  type NativeJobValues,
  type ScriptInterpreter
} from '../../utils/taskEditing';
import { HelpButton } from '../HelpButton';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

const CHECK_KINDS: { value: CheckKind; label: string; hint: string }[] = [
  { value: 'http', label: 'Endpoint', hint: 'Call a URL and assert on the response.' },
  { value: 'tcp', label: 'Port', hint: 'Can something accept a connection on this port?' },
  { value: 'fileFresh', label: 'File freshness', hint: 'Has this file been written recently enough?' },
  { value: 'diskFree', label: 'Disk space', hint: 'Is there still room on this volume?' }
];

const FIELD =
  'w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50';
const LABEL =
  'text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5';

interface Props {
  value: NativeJobValues;
  onChange: (next: NativeJobValues) => void;
  /** The type the task is stored with, so a switch away from it can be warned about. */
  storedJobType: JobType;
  /** Where a native task actually executes, for the EXEC warning. */
  executionHost?: string;
  disabled?: boolean;
}

/**
 * What a **Cronsole-native** task does — the one edit with no platform round
 * trip, which is what makes it feel safe and is exactly why its risks are quiet.
 *
 * **The whole job is sent, never a patch.** The two job types share no fields, so
 * a merge would leave a stored `url` sitting behind an EXEC job as something the
 * executor never reads and a reader cannot explain. Switching type is therefore a
 * deliberate act with a warning attached, not a side effect of clearing a field —
 * and the warning arrives *before* the click, since one that arrives with the
 * result arrives too late to change the decision.
 */
export const NativeJobFields = ({ value, onChange, storedJobType, executionHost, disabled }: Props) => {
  const [headerError, setHeaderError] = useState<string | null>(null);

  const set = <K extends keyof NativeJobValues>(key: K, next: NativeJobValues[K]) =>
    onChange({ ...value, [key]: next });

  const typeChanged = value.jobType !== storedJobType;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider inline-flex items-center gap-1">
          Job type<HelpButton topic="native-job-type" />
        </span>
        {/* Two rows of two below `sm`: four labelled buttons on one line are
            unreadable at 375px, which is a first-class target.

            `py-3` rather than `py-2`, which is what shipped: at 375px these came
            out **34px** tall against the **42px** platform picker directly above
            them — the same "pick one of N" control, one field up, 8px shorter for
            no reason anyone chose. Measured, not guessed (roadmap item 0.4). The
            type stays `text-xs`: "Check something" at `text-sm` wraps in a
            half-width column, and a wrapped label is worse than a small one. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { value: 'HTTP' as const, label: 'Call a URL', icon: Globe },
            { value: 'EXEC' as const, label: 'Run a program', icon: Terminal },
            { value: 'SCRIPT' as const, label: 'Write a script', icon: FileCode },
            { value: 'CHECK' as const, label: 'Check something', icon: Activity }
          ]).map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => set('jobType', opt.value)}
              className={`px-3 py-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                value.jobType === opt.value
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
              }`}
            >
              <opt.icon size={12} /> {opt.label}
            </button>
          ))}
        </div>
        {typeChanged && (
          <p className="text-[11px] text-warning-text">
            This replaces the whole job — the {discardedByTypeSwitch(storedJobType)} currently
            saved will be discarded. The task keeps its name, schedule and history.
          </p>
        )}
      </div>

      {value.jobType === 'SCRIPT' ? (
        <>
          <div className="space-y-2">
            <label htmlFor="job-interpreter" className={LABEL}>
              <FileCode size={11} /> Interpreter <span className="text-danger-text">*</span>
            </label>
            <select
              id="job-interpreter"
              value={value.interpreter}
              disabled={disabled}
              onChange={e => set('interpreter', e.target.value as ScriptInterpreter)}
              className={FIELD}
            >
              {SCRIPT_INTERPRETERS.map(i => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-subtle-foreground">
              Must be installed where the backend runs. <span className="font-mono">node</span> always is —
              it is what Cronsole itself runs on.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="job-script" className={LABEL}>
              Script <span className="text-danger-text">*</span>
            </label>
            <textarea
              id="job-script"
              value={value.scriptBody}
              disabled={disabled}
              onChange={e => set('scriptBody', e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder={'# Runs top to bottom.\n# A non-zero exit is recorded as a failure.'}
              className={`${FIELD} resize-y leading-relaxed`}
            />
            <p className="text-[11px] text-subtle-foreground">
              Stored in Cronsole and written to a temporary file at run time — nothing needs to exist on
              disk. Exit code, duration and output are recorded.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="job-script-cwd" className={LABEL}>
              <FolderOpen size={11} /> Working directory
            </label>
            <input
              id="job-script-cwd"
              value={value.workingDirectory}
              disabled={disabled}
              onChange={e => set('workingDirectory', e.target.value)}
              placeholder="(optional)"
              spellCheck={false}
              className={FIELD}
            />
          </div>

          {executionHost && (
            <p className="text-[11px] text-warning-text">
              Runs on <span className="font-semibold">{executionHost}</span>. Paths inside the script resolve
              there, not on the machine you are browsing from.
            </p>
          )}
        </>
      ) : value.jobType === 'CHECK' ? (
        <CheckFields value={value} set={set} disabled={disabled} executionHost={executionHost} />
      ) : value.jobType === 'HTTP' ? (
        <>
          <div className="space-y-2">
            <label htmlFor="job-url" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Globe size={11} /> URL <span className="text-danger-text">*</span>
            </label>
            <input
              id="job-url"
              value={value.url}
              disabled={disabled}
              onChange={e => set('url', e.target.value)}
              spellCheck={false}
              placeholder="https://example.com/ping"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="job-method" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Method</label>
            <select
              id="job-method"
              value={value.method}
              disabled={disabled}
              onChange={e => set('method', e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
            >
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="job-headers" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Headers</label>
            <textarea
              id="job-headers"
              value={value.headers}
              disabled={disabled}
              onChange={e => { set('headers', e.target.value); setHeaderError(null); }}
              onBlur={() => setHeaderError(parseHeaders(value.headers) ? null : 'Use JSON, or one "Name: value" per line.')}
              rows={3}
              spellCheck={false}
              placeholder={'Authorization: Bearer …\nContent-Type: application/json'}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y disabled:opacity-50"
            />
            {headerError
              ? <p className="text-[11px] text-danger-text">{headerError}</p>
              : <p className="text-[11px] text-subtle-foreground">JSON, or one <span className="font-mono">Name: value</span> per line.</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="job-body" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Body</label>
            <textarea
              id="job-body"
              value={value.body}
              disabled={disabled}
              onChange={e => set('body', e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="(optional)"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y disabled:opacity-50"
            />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <label htmlFor="job-command" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Terminal size={11} /> Command <span className="text-danger-text">*</span>
            </label>
            <textarea
              id="job-command"
              value={value.command}
              disabled={disabled}
              onChange={e => set('command', e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={'node "C:\\jobs\\digest.js"'}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y disabled:opacity-50"
            />
            <p className="text-[11px] text-subtle-foreground">
              Runs directly (no shell). Quote arguments with spaces. For pipes or <span className="font-mono">&amp;&amp;</span>, name a
              shell explicitly — <span className="font-mono">cmd.exe /c "…"</span>.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="job-cwd" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FolderOpen size={11} /> Working directory
            </label>
            <input
              id="job-cwd"
              value={value.workingDirectory}
              disabled={disabled}
              onChange={e => set('workingDirectory', e.target.value)}
              placeholder="(optional)"
              spellCheck={false}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
            />
          </div>

          {/*
            Where this runs is not cosmetic. A native job executes wherever the
            BACKEND runs — inside the container on a Dockerized stack, against a
            filesystem that is not the user's — so the same path fails as
            "executable not found" for a file they can see in Explorer.
          */}
          {executionHost && (
            <p className="text-[11px] text-warning-text">
              Runs on <span className="font-semibold">{executionHost}</span>. Paths are resolved there, not on the
              machine you are browsing from.
            </p>
          )}
        </>
      )}
    </div>
  );
};

interface CheckProps {
  value: NativeJobValues;
  set: <K extends keyof NativeJobValues>(key: K, next: NativeJobValues[K]) => void;
  disabled?: boolean;
  executionHost?: string;
}

/**
 * The four probes, behind one job type.
 *
 * They are a `<select>` rather than four job-type buttons for the reason ADR 0002
 * gives: each probe promoted to its own `jobType` would spend a permanent
 * source-rail row on a distinction nobody navigates by. Inside the form they are
 * genuinely a choice of *what to measure*, which is what a select is for.
 */
const CheckFields = ({ value, set, disabled, executionHost }: CheckProps) => {
  const kind = CHECK_KINDS.find(k => k.value === value.checkKind) ?? CHECK_KINDS[0];
  // Only the filesystem probes read the backend's own disk, so only they carry
  // the execution-host warning. On the others it would be noise, and a warning
  // shown everywhere is a warning nobody reads where it matters.
  const readsLocalDisk = value.checkKind === 'fileFresh' || value.checkKind === 'diskFree';

  return (
    <>
      <div className="space-y-2">
        <label htmlFor="check-kind" className={LABEL}>
          <Activity size={11} /> What to check <span className="text-danger-text">*</span>
        </label>
        <select
          id="check-kind"
          value={value.checkKind}
          disabled={disabled}
          onChange={e => set('checkKind', e.target.value as CheckKind)}
          className={FIELD}
        >
          {CHECK_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <p className="text-[11px] text-subtle-foreground">{kind.hint}</p>
      </div>

      {value.checkKind === 'http' && (
        <>
          <div className="space-y-2">
            <label htmlFor="check-url" className={LABEL}>
              <Globe size={11} /> URL <span className="text-danger-text">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={value.checkMethod}
                disabled={disabled}
                onChange={e => set('checkMethod', e.target.value)}
                aria-label="Method"
                className={`${FIELD} w-auto`}
              >
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                id="check-url"
                value={value.checkUrl}
                disabled={disabled}
                onChange={e => set('checkUrl', e.target.value)}
                spellCheck={false}
                placeholder="https://example.com/health"
                className={FIELD}
              />
            </div>
          </div>

          <div className="space-y-2">
            <span className={LABEL}>Expected status</span>
            <div className="flex items-center gap-2">
              <input
                value={value.expectStatusMin}
                disabled={disabled}
                onChange={e => set('expectStatusMin', e.target.value)}
                inputMode="numeric"
                aria-label="Lowest acceptable status"
                className={FIELD}
              />
              <span className="text-subtle-foreground text-xs">to</span>
              <input
                value={value.expectStatusMax}
                disabled={disabled}
                onChange={e => set('expectStatusMax', e.target.value)}
                inputMode="numeric"
                aria-label="Highest acceptable status"
                className={FIELD}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="check-contains" className={LABEL}>Body must contain</label>
            <input
              id="check-contains"
              value={value.expectBodyContains}
              disabled={disabled}
              onChange={e => set('expectBodyContains', e.target.value)}
              spellCheck={false}
              placeholder="(optional)"
              className={FIELD}
            />
            <p className="text-[11px] text-subtle-foreground">
              This is what separates a check from an HTTP job: a 200 serving an error page still fails.
            </p>
          </div>

          <div className="space-y-2">
            <span className={LABEL}>JSON field must equal</span>
            <div className="flex gap-2">
              <input
                value={value.expectJsonPath}
                disabled={disabled}
                onChange={e => set('expectJsonPath', e.target.value)}
                spellCheck={false}
                placeholder="status.db"
                aria-label="JSON path"
                className={FIELD}
              />
              <input
                value={value.expectJsonEquals}
                disabled={disabled}
                onChange={e => set('expectJsonEquals', e.target.value)}
                spellCheck={false}
                placeholder="up"
                aria-label="Expected value"
                className={FIELD}
              />
            </div>
            <p className="text-[11px] text-subtle-foreground">
              Optional. A dotted path into the JSON response, and the value it must have.
            </p>
          </div>
        </>
      )}

      {value.checkKind === 'tcp' && (
        <div className="space-y-2">
          <span className={LABEL}>Host and port <span className="text-danger-text">*</span></span>
          <div className="flex gap-2">
            <input
              value={value.checkHost}
              disabled={disabled}
              onChange={e => set('checkHost', e.target.value)}
              spellCheck={false}
              placeholder="db.internal"
              aria-label="Host"
              className={FIELD}
            />
            <input
              value={value.checkPort}
              disabled={disabled}
              onChange={e => set('checkPort', e.target.value)}
              inputMode="numeric"
              placeholder="5432"
              aria-label="Port"
              className={`${FIELD} w-28`}
            />
          </div>
        </div>
      )}

      {(value.checkKind === 'fileFresh' || value.checkKind === 'diskFree') && (
        <div className="space-y-2">
          <label htmlFor="check-path" className={LABEL}>
            <FolderOpen size={11} /> Path <span className="text-danger-text">*</span>
          </label>
          <input
            id="check-path"
            value={value.checkPath}
            disabled={disabled}
            onChange={e => set('checkPath', e.target.value)}
            spellCheck={false}
            placeholder={value.checkKind === 'fileFresh' ? 'D:\\backups\\nightly.zip' : 'D:\\'}
            className={FIELD}
          />
        </div>
      )}

      {value.checkKind === 'fileFresh' && (
        <div className="space-y-2">
          <label htmlFor="check-age" className={LABEL}>
            Fail if older than (minutes) <span className="text-danger-text">*</span>
          </label>
          <input
            id="check-age"
            value={value.maxAgeMinutes}
            disabled={disabled}
            onChange={e => set('maxAgeMinutes', e.target.value)}
            inputMode="numeric"
            className={FIELD}
          />
          <p className="text-[11px] text-subtle-foreground">
            A missing file fails too — a backup that was never written is the same problem as one that
            stopped.
          </p>
        </div>
      )}

      {value.checkKind === 'diskFree' && (
        <div className="space-y-2">
          <label htmlFor="check-free" className={LABEL}>
            Fail below (MB) <span className="text-danger-text">*</span>
          </label>
          <input
            id="check-free"
            value={value.minFreeMb}
            disabled={disabled}
            onChange={e => set('minFreeMb', e.target.value)}
            inputMode="numeric"
            className={FIELD}
          />
        </div>
      )}

      {readsLocalDisk && executionHost && (
        <p className="text-[11px] text-warning-text">
          Measured on <span className="font-semibold">{executionHost}</span> — not the machine you are
          browsing from. A check that passes against the wrong filesystem is worse than no check.
        </p>
      )}
    </>
  );
};
