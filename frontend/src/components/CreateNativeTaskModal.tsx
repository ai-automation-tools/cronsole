import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, Zap, Info } from 'lucide-react';
import { api } from '../api';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

const CRON_PRESETS = [
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 8am', cron: '0 8 * * *' },
  { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
  { label: 'Sunday night', cron: '0 22 * * 0' }
];

interface CreateNativeTaskModalProps {
  onClose: () => void;
}

/**
 * Creates a TaskHub-native task: scheduled and executed by the backend itself,
 * with no Windows Task Scheduler entry (docs/resources/Native_Tasks.md).
 */
export const CreateNativeTaskModal = ({ onClose }: CreateNativeTaskModalProps) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('TaskHub');
  const [schedule, setSchedule] = useState('0 8 * * *');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [body, setBody] = useState('');

  const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

  const createMutation = useMutation({
    mutationFn: async () => {
      if (DEMO_MODE) return;
      return api.post('/tasks/native', {
        name,
        category,
        schedule,
        job: { jobType: 'HTTP', url, method, body: body || undefined }
      });
    },
    onSuccess: () => {
      if (!DEMO_MODE) queryClient.invalidateQueries({ queryKey: ['tasks'] });
      alert(
        DEMO_MODE
          ? `Demo mode — "${name}" would be created as a TaskHub-native task.`
          : `TaskHub task "${name}" created. It runs on the backend scheduler — no Windows entry.`
      );
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      alert(`Create failed: ${err.response?.data?.error || err.message}`);
    }
  });

  const validUrl = /^https?:\/\//i.test(url.trim());
  const canCreate =
    !!name.trim() && !!schedule.trim() && validUrl && !createMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900/50">
          <div>
            <p className="text-[10px] text-violet-400 uppercase font-black tracking-widest mb-1 flex items-center gap-1.5">
              <Zap size={11} /> TaskHub-native task
            </p>
            <h2 className="text-xl font-bold">New Task</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Scheduled and executed by TaskHub itself — nothing is created in Windows Task Scheduler.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Name <span className="text-red-400">*</span></label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ping n8n webhook"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-violet-500 transition-colors"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Category</label>
              <input
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-violet-500 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · UTC) <span className="text-red-400">*</span>
            </label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm font-mono text-violet-300 outline-none focus:border-violet-500 transition-colors"
            />
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.cron}
                  onClick={() => setSchedule(p.cron)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${schedule === p.cron ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">HTTP request <span className="text-red-400">*</span></label>
            <div className="flex gap-2">
              <select
                value={method}
                onChange={e => setMethod(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-violet-500 transition-colors"
              >
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-200 outline-none focus:border-violet-500 transition-colors"
              />
            </div>
            {url.trim() && !validUrl && (
              <p className="text-[10px] text-amber-500 italic">URL must start with http:// or https://</p>
            )}
          </div>

          {method !== 'GET' && method !== 'HEAD' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Request body (optional)</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={3}
                placeholder='{"message": "hello"}'
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-200 outline-none focus:border-violet-500 transition-colors resize-y"
              />
            </div>
          )}

          <div className="text-[11px] text-slate-500 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-start gap-2">
            <Info size={13} className="text-violet-400 shrink-0 mt-0.5" />
            <span>Runs only while the TaskHub backend is up. Use a Windows template instead for jobs that must survive TaskHub being offline.</span>
          </div>

          {DEMO_MODE && (
            <div className="text-[11px] text-slate-500 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center gap-2">
              <Info size={13} className="text-blue-500 shrink-0" /> Demo mode — creation is simulated.
            </div>
          )}
        </div>

        <footer className="p-6 bg-slate-950 border-t border-slate-800 flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canCreate}
            className="flex-[2] bg-violet-600 hover:bg-violet-500 py-3 rounded-2xl font-bold shadow-lg shadow-violet-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2"
          >
            {createMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Creating…</> : <><Zap size={16} /> Create TaskHub Task</>}
          </button>
        </footer>
      </div>
    </div>
  );
};
export default CreateNativeTaskModal;
