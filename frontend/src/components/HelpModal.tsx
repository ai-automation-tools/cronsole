import { XCircle, HelpCircle, BookOpen, ExternalLink, Sparkles } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal = ({ onClose }: HelpModalProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <HelpCircle className="text-foreground" size={22} />
              <p className="text-[10px] text-foreground uppercase font-black tracking-widest">Documentation & Help</p>
            </div>
            <h2 className="text-xl font-bold">TaskHub Help Center</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              Tips and quick links to master your task automation.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Tips Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400" />
              Pro Automation Tips
            </h3>
            
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-background/50 rounded-2xl border border-border/80">
                <span className="font-bold text-foreground block mb-1">📂 Dynamic Local Categorization</span>
                <p className="text-muted-foreground">
                  TaskHub automatically infers root folders as categories (e.g. a Windows task at <code className="bg-surface px-1 py-0.5 rounded text-foreground">\Monitoring\Logs</code> is categorized as "Monitoring"). You can rename categories by clicking the category label on any card.
                </p>
              </div>

              <div className="p-3 bg-background/50 rounded-2xl border border-border/80">
                <span className="font-bold text-foreground block mb-1">⏰ Standard Cron Schedules</span>
                <p className="text-muted-foreground">
                  Tasks use the standard 5-field cron syntax: <code className="bg-surface px-1 py-0.5 rounded text-foreground">Min Hour Day Month Weekday</code>. 
                  For example, <code className="bg-surface px-1 py-0.5 rounded text-foreground">0 3 * * *</code> executes every day at 3:00 AM.
                </p>
              </div>

              <div className="p-3 bg-background/50 rounded-2xl border border-border/80">
                <span className="font-bold text-foreground block mb-1">🖥️ Windows Agent Execution</span>
                <p className="text-muted-foreground">
                  The TaskHub Windows Agent runs locally to execute tasks. If the agent is offline, tasks will queue up and sync the next time the agent starts.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Links Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <BookOpen size={14} className="text-foreground" />
              Helpful Resources
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <a 
                href="https://crontab.guru" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-background border border-border hover:border-primary/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-foreground block truncate group-hover:text-foreground transition-colors">Crontab Guru</span>
                  <span className="text-[10px] text-subtle-foreground truncate block">Cron schedule expression tester</span>
                </div>
                <ExternalLink size={14} className="text-subtle-foreground group-hover:text-foreground transition-colors" />
              </a>

              <a 
                href="https://github.com/michaelschecht/taskhub" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-background border border-border hover:border-primary/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-foreground block truncate group-hover:text-foreground transition-colors">TaskHub Repository</span>
                  <span className="text-[10px] text-subtle-foreground truncate block">Explore codebase & issue tracker</span>
                </div>
                <ExternalLink size={14} className="text-subtle-foreground group-hover:text-foreground transition-colors" />
              </a>

              <a 
                href="https://claude.ai/code/routines" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-background border border-border hover:border-primary/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-foreground block truncate group-hover:text-foreground transition-colors">Claude Code Routines</span>
                  <span className="text-[10px] text-subtle-foreground truncate block">Anthropic experimental routine docs</span>
                </div>
                <ExternalLink size={14} className="text-subtle-foreground group-hover:text-foreground transition-colors" />
              </a>

              <a 
                href="https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page" 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-background border border-border hover:border-primary/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-foreground block truncate group-hover:text-foreground transition-colors">Windows Scheduler API</span>
                  <span className="text-[10px] text-subtle-foreground truncate block">Official Win32 task APIs documentation</span>
                </div>
                <ExternalLink size={14} className="text-subtle-foreground group-hover:text-foreground transition-colors" />
              </a>
            </div>
          </div>
        </div>

        <footer className="p-6 bg-background border-t border-border">
          <button onClick={onClose} className="w-full bg-muted hover:bg-muted py-3 rounded-2xl font-bold transition-all text-xs active:scale-95 text-foreground">
            Close Help Center
          </button>
        </footer>
      </div>
    </div>
  );
};

export default HelpModal;
