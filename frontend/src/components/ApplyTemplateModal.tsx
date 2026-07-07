import { useEffect, useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, ArrowRight, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Template } from '../types';
import { api } from '../api';
import { platformLabel } from '../platform';

// Substitute {{key}} placeholders.
const resolveCommand = (tpl: string, values: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? values[k] : `{{${k}}}`));

interface ApplyTemplateModalProps {
  template: Template;
  onClose: () => void;
}

export const ApplyTemplateModal = ({ template, onClose }: ApplyTemplateModalProps) => {
  const queryClient = useQueryClient();
  const params = template.parameters ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map(p => [p.key, p.default ?? '']))
  );
  const [platform, setPlatform] = useState(template.targetPlatforms[0] ?? '');
  const [schedule, setSchedule] = useState(template.scheduleExpression);

  const baseCommand = template.commandTemplate ?? template.command ?? '';
  const resolved = resolveCommand(baseCommand, values).trim();
  const missing = params.filter(p => p.required && !values[p.key]?.trim());
  const incomplete = missing.length > 0 || resolved.includes('{{');

  const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

  // Debounce the schedule so the preview doesn't fire per keystroke.
  const [debouncedSchedule, setDebouncedSchedule] = useState(schedule);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSchedule(schedule), 400);
    return () => clearTimeout(t);
  }, [schedule]);

  interface SchedulePreview {
    score: number;
    warnings: string[];
  }

  const { data: preview } = useQuery<SchedulePreview | null>({
    queryKey: ['template-preview', template.id, platform, debouncedSchedule],
    queryFn: async () => {
      const res = await api.post(`/templates/${template.id}/preview`, {
        platform,
        schedule: debouncedSchedule
      });
      return res.data;
    },
    enabled: !DEMO_MODE && !!platform && !!debouncedSchedule.trim(),
    staleTime: 60_000,
    retry: false
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (DEMO_MODE) return;
      return api.post(`/templates/${template.id}/apply`, {
        platform,
        schedule,
        name: template.name,
        command: resolved
      });
    },
    onSuccess: () => {
      if (!DEMO_MODE) queryClient.invalidateQueries({ queryKey: ['tasks'] });
      alert(
        DEMO_MODE
          ? `Demo mode — "${template.name}" would be created on ${platformLabel(platform)}.`
          : `Task created on ${platformLabel(platform)} from "${template.name}".`
      );
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      alert(`Apply failed: ${err.response?.data?.error || err.message}`);
    }
  });

  const canApply =
    !!platform && !!schedule.trim() && !incomplete && !applyMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900/50">
          <div>
            <p className="text-[10px] text-blue-500 uppercase font-black tracking-widest mb-1">Apply Template</p>
            <h2 className="text-xl font-bold">{template.name}</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{template.description}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Target platform</label>
            <div className="flex flex-wrap gap-2">
              {template.targetPlatforms.map(p => (
                <button 
                  key={p} 
                  onClick={() => setPlatform(p)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${platform === p ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}
                >
                  {platformLabel(p)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · UTC)
            </label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm font-mono text-blue-300 outline-none focus:border-blue-500 transition-colors"
            />
            {preview && preview.score >= 1 && (
              <p className="text-[10px] text-green-500 flex items-center gap-1.5">
                <CheckCircle2 size={11} className="shrink-0" /> Schedule converts cleanly to a native trigger.
              </p>
            )}
            {preview && preview.score < 1 && (
              <div className="text-[11px] text-amber-400 bg-amber-500/5 border border-amber-500/30 rounded-xl px-3 py-2 space-y-1">
                {preview.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {w}
                  </p>
                ))}
              </div>
            )}
          </div>

          {params.map(p => (
            <div key={p.key} className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                {p.label}{p.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {p.type === 'select' ? (
                <select 
                  value={values[p.key] ?? ''} 
                  onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors"
                >
                  {(p.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input 
                  value={values[p.key] ?? ''} 
                  onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                  placeholder={p.type === 'path' ? 'C:\\path\\to\\file' : p.type === 'url' ? 'https://…' : ''}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors font-mono" 
                />
              )}
              {p.help && <p className="text-[10px] text-slate-600 italic">{p.help}</p>}
            </div>
          ))}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Resolved command</label>
            <pre className={`bg-slate-950 border rounded-xl px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all ${incomplete ? 'border-amber-500/40 text-amber-300' : 'border-slate-800 text-green-300'}`}>
              {resolved || '—'}
            </pre>
            {incomplete && <p className="text-[10px] text-amber-500 italic">Fill the required fields above before applying.</p>}
          </div>

          {DEMO_MODE && (
            <div className="text-[11px] text-slate-500 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center gap-2">
              <Info size={13} className="text-blue-500 shrink-0" /> Demo mode — applying is simulated; no task is created.
            </div>
          )}
        </div>

        <footer className="p-6 bg-slate-950 border-t border-slate-800 flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
          <button 
            onClick={() => applyMutation.mutate()} 
            disabled={!canApply}
            className="flex-[2] bg-blue-600 hover:bg-blue-500 py-3 rounded-2xl font-bold shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2"
          >
            {applyMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Applying…</> : <>Create Task <ArrowRight size={16} /></>}
          </button>
        </footer>
      </div>
    </div>
  );
};
export default ApplyTemplateModal;
