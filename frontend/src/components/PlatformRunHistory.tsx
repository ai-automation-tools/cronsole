import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Loader2, ChevronRight, FileText } from 'lucide-react';
import { api } from '../api';
import type { PlatformRun, PlatformRunOutputResponse } from '../types';

/**
 * **Runs the platform performed, beside the runs Cronsole performed — never
 * merged with them.**
 *
 * `ExecutionLog` holds only what Cronsole did, on purpose: a task firing on its
 * own schedule writes nothing there, because Cronsole did not fire it and saying
 * otherwise is the kind of confident lie the whole product is built against.
 * That leaves a real hole on a source that runs work by itself and publishes the
 * outcome — the Run History tab said *"no recorded runs yet"* over a Gemini
 * trigger that had been working for days.
 *
 * This fills the hole without closing the distinction. Two headed groups, two
 * sentences about where each came from, and no combined count anywhere: a
 * summary over both populations would be exactly the "never mix populations in
 * one summary" rule broken in the one place the difference matters most.
 *
 * Nothing here is stored. It is a live read of the platform's own record, so it
 * can fail on its own while Cronsole's log renders fine — and it says so rather
 * than showing a short list as if it were complete.
 */
export function PlatformRunHistory({ taskId, enabled }: { taskId: string; enabled: boolean }) {
  const [openRun, setOpenRun] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ runs: PlatformRun[] }>({
    queryKey: ['platform-runs', taskId],
    queryFn: async () => (await api.get(`/tasks/${taskId}/platform-runs`)).data,
    enabled,
    // A 400 is the route saying this platform publishes no run history — a fact
    // about the connector, not a transient failure, so retrying it is spend for
    // an answer that cannot change.
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      return status !== 400 && status !== 404 && count < 2;
    },
    staleTime: 15_000
  });

  const status = (error as { response?: { status?: number } } | null)?.response?.status;

  // **Unsupported renders as nothing at all.** Every platform that cannot serve
  // this answers 400 by absence, and an empty "Runs on the platform — not
  // available here" block on five of six sources would be a permanent apology
  // occupying the space the real history needs.
  if (status === 400 || status === 404) return null;
  if (!enabled) return null;

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2 pt-2">
        <Cloud size={13} className="text-gemini-text" />
        <h3 className="text-[11px] uppercase font-black tracking-widest text-foreground">Runs on the platform</h3>
      </header>
      <p className="text-xs text-subtle-foreground -mt-1">
        Read live from the source just now, including runs on its own schedule that Cronsole never
        triggered. Not stored here.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-subtle-foreground">
          <Loader2 size={16} className="animate-spin" /> Asking the platform…
        </div>
      ) : error ? (
        <div className="text-xs text-warning-text bg-warning/5 border border-warning/30 rounded-xl px-4 py-3">
          Could not read run history from the platform just now. The Cronsole log above is
          unaffected.
        </div>
      ) : !data?.runs?.length ? (
        <div className="text-xs text-subtle-foreground bg-background border border-border rounded-xl px-4 py-3">
          The platform reports no runs for this task yet.
        </div>
      ) : (
        <div className="space-y-2">
          {data.runs!.map(run => (
            <PlatformRunRow
              key={run.id}
              taskId={taskId}
              run={run}
              open={openRun === run.id}
              onToggle={() => setOpenRun(openRun === run.id ? null : run.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The platform's own word, styled where it is recognised and printed where it
 * is not.
 *
 * **Never mapped onto Cronsole's `ExecutionStatus`.** That would be a second
 * judgement about an outcome the platform already named, and this vocabulary is
 * preview-era on at least one source — a word introduced next month must render
 * as itself rather than as a guess. `completed` is Gemini's success word;
 * `succeeded` is the one its docs use, and reading only the second is what once
 * scored every healthy trigger as broken.
 */
function statusStyle(status: string): string {
  if (status === 'completed' || status === 'succeeded') return 'bg-success/10 text-success-text border-success/30';
  if (status === 'failed' || status === 'error') return 'bg-danger/10 text-danger-text border-danger/30';
  if (status === 'cancelled') return 'bg-warning/10 text-warning-text border-warning/30';
  if (status === 'in_progress' || status === 'running') return 'bg-info/10 text-info-text border-info/30';
  return 'bg-surface text-muted-foreground border-border';
}

function duration(run: PlatformRun): string | null {
  if (!run.startedAt || !run.endedAt) return null;
  const ms = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function PlatformRunRow({
  taskId,
  run,
  open,
  onToggle
}: {
  taskId: string;
  run: PlatformRun;
  open: boolean;
  onToggle: () => void;
}) {
  // **Fetched only when the row is opened**, and only for the row that was
  // opened. A Gemini transcript is ~90KB of tool arguments and grounding blobs
  // per run, so eagerly loading ten of them would be a megabyte fetched to
  // render four timestamps.
  const { data, isLoading, isError } = useQuery<PlatformRunOutputResponse>({
    queryKey: ['platform-run-output', taskId, run.id],
    queryFn: async () => (await api.get(`/tasks/${taskId}/platform-runs/${run.id}/output`)).data,
    enabled: open && run.outputAvailable,
    staleTime: Infinity
  });

  const took = duration(run);

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        disabled={!run.outputAvailable}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left ${run.outputAvailable ? 'hover:bg-surface/60 cursor-pointer' : 'cursor-default'}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {run.outputAvailable && (
            <ChevronRight
              size={13}
              className={`text-subtle-foreground shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
            />
          )}
          <span className={`inline-flex items-center text-[10px] uppercase font-black px-2 py-0.5 rounded-full border ${statusStyle(run.status)}`}>
            {run.status.replace(/_/g, ' ')}
          </span>
        </span>
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          {run.startedAt ? new Date(run.startedAt).toLocaleString() : 'time not reported'}
          {took && <span className="text-subtle-foreground"> · {took}</span>}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-subtle-foreground">
              <Loader2 size={15} className="animate-spin" /> Fetching what this run produced…
            </div>
          ) : isError ? (
            <p className="text-xs text-warning-text">Could not fetch this run&apos;s output.</p>
          ) : !data?.available ? (
            // The reason, not a shrug. "Still running", "produced nothing" and
            // "aged out of the platform's list" are three different true things.
            <p className="text-xs text-subtle-foreground">{data?.reason ?? 'No output to show.'}</p>
          ) : (
            <>
              {data.output?.steps?.length ? (
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-black tracking-widest text-subtle-foreground">
                    What it did
                  </span>
                  {/* The field that answers "but did it do what I asked?" — an
                      agent can finish cleanly having skipped a step its sandbox
                      cannot perform, and the status alone will never say so. */}
                  <div className="flex flex-wrap gap-1">
                    {data.output.steps!.map((step, i) => (
                      <span
                        key={`${step}-${i}`}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-surface/60 text-muted-foreground"
                      >
                        {step}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase font-black tracking-widest text-subtle-foreground flex items-center gap-1.5">
                    <FileText size={11} /> Output
                  </span>
                  {data.output?.totalTokens != null && (
                    <span className="text-[10px] text-subtle-foreground font-mono">
                      {data.output.totalTokens.toLocaleString()} tokens
                    </span>
                  )}
                </div>
                {data.output?.text ? (
                  <pre className="text-[11px] text-foreground font-mono whitespace-pre-wrap break-words bg-surface/60 rounded-lg p-3 border border-border/60 max-h-96 overflow-y-auto">
                    {data.output.text}
                  </pre>
                ) : (
                  <p className="text-xs text-subtle-foreground">
                    This run finished without producing a final message.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
