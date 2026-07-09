import { useEffect, useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, ArrowRight, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Template } from '../types';
import { api } from '../api';
import { platformLabel } from '../platform';
import { useToast } from '../hooks/useToast';

// Substitute {{key}} placeholders.
const resolveCommand = (tpl: string, values: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? values[k] : `{{${k}}}`));

interface ApplyTemplateModalProps {
  template: Template;
  onClose: () => void;
}

export const ApplyTemplateModal = ({ template, onClose }: ApplyTemplateModalProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
      toast(
        DEMO_MODE
          ? `Demo mode — "${template.name}" would be created on ${platformLabel(platform)}.`
          : `Task created on ${platformLabel(platform)} from "${template.name}".`,
        'success'
      );
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Apply failed: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  const canApply =
    !!platform && !!schedule.trim() && !incomplete && !applyMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <p className="text-[10px] text-foreground uppercase font-black tracking-widest mb-1">Apply Template</p>
            <h2 className="text-xl font-bold">{template.name}</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">{template.description}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Target platform</label>
            <div className="flex flex-wrap gap-2">
              {template.targetPlatforms.map(p => (
                <button 
                  key={p} 
                  onClick={() => setPlatform(p)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${platform === p ? 'bg-primary border-primary text-primary-foreground' : 'bg-background border-border text-muted-foreground hover:border-foreground/30'}`}
                >
                  {platformLabel(p)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · UTC)
            </label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
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
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
                {p.label}{p.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {p.type === 'select' ? (
                <select 
                  value={values[p.key] ?? ''} 
                  onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
                >
                  {(p.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input 
                  value={values[p.key] ?? ''} 
                  onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                  placeholder={p.type === 'path' ? 'C:\\path\\to\\file' : p.type === 'url' ? 'https://…' : ''}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors font-mono" 
                />
              )}
              {p.help && <p className="text-[10px] text-subtle-foreground italic">{p.help}</p>}
            </div>
          ))}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Resolved command</label>
            <pre className={`bg-background border rounded-xl px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all ${incomplete ? 'border-amber-500/40 text-amber-300' : 'border-border text-green-300'}`}>
              {resolved || '—'}
            </pre>
            {incomplete && <p className="text-[10px] text-amber-500 italic">Fill the required fields above before applying.</p>}
          </div>

          {DEMO_MODE && (
            <div className="text-[11px] text-subtle-foreground bg-background border border-border rounded-xl px-3 py-2 flex items-center gap-2">
              <Info size={13} className="text-foreground shrink-0" /> Demo mode — applying is simulated; no task is created.
            </div>
          )}
        </div>

        <footer className="p-6 bg-background border-t border-border flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">Cancel</button>
          <button 
            onClick={() => applyMutation.mutate()} 
            disabled={!canApply}
            className="flex-[2] bg-primary hover:bg-primary-hover py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2"
          >
            {applyMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Applying…</> : <>Create Task <ArrowRight size={16} /></>}
          </button>
        </footer>
      </div>
    </div>
  );
};
export default ApplyTemplateModal;
