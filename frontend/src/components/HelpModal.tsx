import { XCircle, HelpCircle, BookOpen, ExternalLink, Sparkles } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal = ({ onClose }: HelpModalProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <header className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900/50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <HelpCircle className="text-blue-500" size={22} />
              <p className="text-[10px] text-blue-500 uppercase font-black tracking-widest">Documentation & Help</p>
            </div>
            <h2 className="text-xl font-bold">TaskHub Help Center</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Tips and quick links to master your task automation.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Tips Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400" />
              Pro Automation Tips
            </h3>
            
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950/50 rounded-2xl border border-slate-800/80">
                <span className="font-bold text-slate-200 block mb-1">📂 Dynamic Local Categorization</span>
                <p className="text-slate-400">
                  TaskHub automatically infers root folders as categories (e.g. a Windows task at <code className="bg-slate-900 px-1 py-0.5 rounded text-blue-300">\Monitoring\Logs</code> is categorized as "Monitoring"). You can rename categories by clicking the category label on any card.
                </p>
              </div>

              <div className="p-3 bg-slate-950/50 rounded-2xl border border-slate-800/80">
                <span className="font-bold text-slate-200 block mb-1">⏰ Standard Cron Schedules</span>
                <p className="text-slate-400">
                  Tasks use the standard 5-field cron syntax: <code className="bg-slate-900 px-1 py-0.5 rounded text-blue-300">Min Hour Day Month Weekday</code>. 
                  For example, <code className="bg-slate-900 px-1 py-0.5 rounded text-blue-300">0 3 * * *</code> executes every day at 3:00 AM.
                </p>
              </div>

              <div className="p-3 bg-slate-950/50 rounded-2xl border border-slate-800/80">
                <span className="font-bold text-slate-200 block mb-1">🖥️ Windows Agent Execution</span>
                <p className="text-slate-400">
                  The TaskHub Windows Agent runs locally to execute tasks. If the agent is offline, tasks will queue up and sync the next time the agent starts.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Links Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <BookOpen size={14} className="text-blue-400" />
              Helpful Resources
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <a 
                href="https://crontab.guru" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-slate-950 border border-slate-800 hover:border-blue-500/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-slate-200 block truncate group-hover:text-blue-400 transition-colors">Crontab Guru</span>
                  <span className="text-[10px] text-slate-500 truncate block">Cron schedule expression tester</span>
                </div>
                <ExternalLink size={14} className="text-slate-600 group-hover:text-blue-400 transition-colors" />
              </a>

              <a 
                href="https://github.com/michaelschecht/taskhub" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-slate-950 border border-slate-800 hover:border-blue-500/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-slate-200 block truncate group-hover:text-blue-400 transition-colors">TaskHub Repository</span>
                  <span className="text-[10px] text-slate-500 truncate block">Explore codebase & issue tracker</span>
                </div>
                <ExternalLink size={14} className="text-slate-600 group-hover:text-blue-400 transition-colors" />
              </a>

              <a 
                href="https://claude.ai/code/routines" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-slate-950 border border-slate-800 hover:border-blue-500/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-slate-200 block truncate group-hover:text-blue-400 transition-colors">Claude Code Routines</span>
                  <span className="text-[10px] text-slate-500 truncate block">Anthropic experimental routine docs</span>
                </div>
                <ExternalLink size={14} className="text-slate-600 group-hover:text-blue-400 transition-colors" />
              </a>

              <a 
                href="https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-slate-950 border border-slate-800 hover:border-blue-500/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-slate-200 block truncate group-hover:text-blue-400 transition-colors">Windows Scheduler API</span>
                  <span className="text-[10px] text-slate-500 truncate block">Official Win32 task APIs documentation</span>
                </div>
                <ExternalLink size={14} className="text-slate-600 group-hover:text-blue-400 transition-colors" />
              </a>
            </div>
          </div>
        </div>

        <footer className="p-6 bg-slate-950 border-t border-slate-800">
          <button onClick={onClose} className="w-full bg-slate-800 hover:bg-slate-700 py-3 rounded-2xl font-bold transition-all text-xs active:scale-95 text-slate-200">
            Close Help Center
          </button>
        </footer>
      </div>
    </div>
  );
};

export default HelpModal;
