import { useState, useEffect } from 'react';
import { Loader2, XCircle, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface DiscoveredCategory {
  name: string;
  count: number;
}

interface DiscoveredPlatform {
  platform: string;
  categories: DiscoveredCategory[];
}

interface ImportModalProps {
  onClose: () => void;
  onImport: (categories: string[]) => void;
}

export const ImportModal = ({ onClose, onImport }: ImportModalProps) => {
  const { data: discovery, isLoading, error } = useQuery<DiscoveredPlatform[]>({
    queryKey: ['discovery'],
    queryFn: async () => {
      console.log('[Frontend] Fetching discovery data...');
      const response = await api.get('/tasks/discover');
      console.log('[Frontend] Discovery response:', response.data);
      return response.data;
    }
  });

  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (error) console.error('[Frontend] Discovery fetch error:', error);
  }, [error]);

  useEffect(() => {
    if (discovery) {
      const all = discovery.flatMap(p => p.categories.map((c) => c.name));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(all.filter(c => c !== 'Microsoft' && c !== 'Uncategorized'));
    }
  }, [discovery]);

  const toggle = (cat: string) => {
    setSelected(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  if (isLoading) return (
     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="text-center space-y-4">
           <Loader2 className="animate-spin text-blue-500 mx-auto" size={48} />
           <p className="text-slate-400 font-medium">Scanning platforms for tasks...</p>
        </div>
     </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        <header className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <div>
            <h2 className="text-xl font-bold">Import & Sync</h2>
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Select categories to pull into dashboard</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors"><XCircle size={20} /></button>
        </header>
        <div className="p-6 space-y-4">
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
            {(error || !discovery || discovery.every(p => p.categories.length === 0)) && (
              <div className="text-center py-8 px-4 space-y-2">
                <p className="text-sm font-bold text-slate-300">No tasks discovered</p>
                <p className="text-xs text-slate-500">
                  {error
                    ? 'Discovery failed — is the backend running?'
                    : 'No platform returned any tasks. The Windows agent may be offline — check that the TaskHubAgent scheduled task is running, then try again.'}
                </p>
              </div>
            )}
            {discovery?.map(platform => (
               <div key={platform.platform} className="space-y-2 mb-6 last:mb-0">
                  <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">{platform.platform.replace(/_/g, ' ')}</h3>
                  <div className="grid gap-2">
                    {platform.categories.map((cat) => (
                      <label key={cat.name} className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer group ${selected.includes(cat.name) ? 'bg-blue-600/5 border-blue-500/30' : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${selected.includes(cat.name) ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700 bg-slate-900 text-transparent group-hover:border-slate-500'}`}>
                            <Check size={12} strokeWidth={4} />
                          </div>
                          <div>
                            <span className={`text-sm font-bold transition-colors ${selected.includes(cat.name) ? 'text-slate-100' : 'text-slate-400'}`}>{cat.name}</span>
                            {(cat.name === 'Microsoft' || cat.name === 'Uncategorized') && !selected.includes(cat.name) && (
                               <span className="ml-2 text-[9px] text-slate-600 font-medium italic">(Excluded by default)</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-colors ${selected.includes(cat.name) ? 'bg-blue-600/20 border-blue-500/20 text-blue-400' : 'bg-slate-900 border-slate-800 text-slate-600'}`}>{cat.count} tasks</span>
                        </div>
                        <input type="checkbox" className="hidden" checked={selected.includes(cat.name)} onChange={() => toggle(cat.name)} />
                      </label>
                    ))}
                  </div>
               </div>
            ))}
          </div>
        </div>
        <footer className="p-6 bg-slate-950 border-t border-slate-800 flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-300 transition-colors">Discard</button>
          <button 
            onClick={() => onImport(selected)} 
            disabled={selected.length === 0}
            className="flex-[2] bg-blue-600 hover:bg-blue-500 py-3 rounded-2xl font-bold shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm"
          >
            Sync {selected.length} Categories
          </button>
        </footer>
      </div>
    </div>
  );
};
export default ImportModal;
