import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Info, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { downloadBlob, filenameFromDisposition } from '../../utils/saveExport';

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' }
] as const;

interface MatchedCounts {
  runs: number;
  succeeded: number;
  failed: number;
  pending: number;
}

const errorMessage = (err: unknown): string => {
  const e = err as Error & { response?: { data?: { error?: unknown } } };
  return e.response?.data?.error ? String(e.response.data.error) : e.message;
};

/**
 * Export run history as CSV.
 *
 * The load-bearing copy here is the honesty note. `ExecutionLog` holds runs
 * **TaskHub performed** — a Windows task firing on its own schedule writes
 * nothing — so an empty month means "TaskHub triggered nothing", not "nothing
 * ran". Without that stated, this export is a report that quietly answers a
 * different question than the one you asked it.
 */
export const RunHistoryTool = () => {
  const { toast } = useToast();
  const [days, setDays] = useState<number>(30);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const params = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      ...(failuresOnly ? { status: 'FAILURE,TIMEOUT' } : {})
    };
  }, [days, failuresOnly]);

  // A preview count over the WHOLE filtered set, so the number in the button is
  // what the file will hold — not the size of one page.
  const { data, isFetching } = useQuery<{ matched: MatchedCounts }>({
    queryKey: ['run-history-count', params],
    queryFn: async () => (await api.get('/tools/history', { params: { ...params, limit: 1 } })).data
  });

  const matched = data?.matched;

  const download = async () => {
    setBusy(true);
    try {
      const res = await api.get('/tools/history', {
        params: { ...params, format: 'csv' },
        responseType: 'blob'
      });
      const filename = filenameFromDisposition(
        res.headers['content-disposition'] as string | undefined,
        'taskhub-run-history.csv'
      );
      downloadBlob(res.data as Blob, filename);
      toast(`Exported ${matched?.runs ?? 0} run${matched?.runs === 1 ? '' : 's'} to ${filename}.`, 'success');
    } catch (err: unknown) {
      let message = errorMessage(err);
      const body = (err as { response?: { data?: unknown } }).response?.data;
      if (body instanceof Blob) {
        try {
          message = JSON.parse(await body.text())?.error ?? message;
        } catch { /* keep the original */ }
      }
      toast(`Export failed: ${message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <FileSpreadsheet size={20} />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold">Export run history</h3>
          <p className="text-sm text-muted-foreground">
            Every recorded run across all your tasks as a CSV — the answer to
            "what failed this month?", which the per-task history can't give you.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-subtle-foreground">Period</span>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            aria-label="Period to export"
            className="mt-1.5 w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
          >
            {RANGES.map(r => (
              <option key={r.days} value={r.days}>{r.label}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="accent-primary"
            checked={failuresOnly}
            onChange={e => setFailuresOnly(e.target.checked)}
          />
          Failures and timeouts only
        </label>
      </div>

      <div className="rounded-xl bg-background/60 border border-border/60 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          This covers runs <strong>TaskHub performed</strong> — tasks you ran from the dashboard, and TaskHub-native
          jobs it runs itself. A Windows task firing on its own schedule isn't recorded here, so an empty period means
          TaskHub triggered nothing, not that nothing ran. Each row's <code>runKind</code> says which it is.
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {isFetching && !matched ? 'Counting…' : matched ? (
            <>
              <span className="font-bold text-foreground">{matched.runs}</span> run{matched.runs === 1 ? '' : 's'}
              {matched.failed > 0 && <> · <span className="font-bold text-red-500">{matched.failed}</span> failed</>}
            </>
          ) : '—'}
        </div>
        <button
          onClick={download}
          disabled={busy || !matched || matched.runs === 0}
          className="bg-primary hover:bg-primary-hover text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {busy ? 'Exporting…' : 'Download CSV'}
        </button>
      </div>
    </div>
  );
};
