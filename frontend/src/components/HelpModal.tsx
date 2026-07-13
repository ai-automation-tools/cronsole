import { XCircle, HelpCircle, BookOpen, ExternalLink, Sparkles, Compass } from 'lucide-react';
import { GETTING_STARTED_STEPS, HELP_GUIDES } from '../data/onboarding';
import { Modal } from './ui/Modal';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal = ({ onClose }: HelpModalProps) => {
  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      labelledBy="help-center-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
    >
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <HelpCircle className="text-foreground" size={22} />
              <p className="text-[10px] text-foreground uppercase font-black tracking-widest">Documentation & Help</p>
            </div>
            <h2 id="help-center-title" className="text-xl font-bold">TaskHub Help Center</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              Get started, master the basics, and find the full guides.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Getting Started walkthrough */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Compass size={14} className="text-primary" />
              Getting Started
            </h3>
            <ol className="space-y-2.5">
              {GETTING_STARTED_STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3 p-3 bg-background/50 rounded-2xl border border-border/80">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-black flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0 text-xs">
                    <span className="font-bold text-foreground block mb-0.5">{step.icon} {step.title}</span>
                    <p className="text-muted-foreground leading-relaxed">{step.body}</p>
                    {step.link && (
                      <a
                        href={step.link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-1.5 text-primary hover:underline font-semibold"
                      >
                        {step.link.label} <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Guides & Docs */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <BookOpen size={14} className="text-foreground" />
              Guides & Docs
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {HELP_GUIDES.map(guide => (
                <a
                  key={guide.url}
                  href={guide.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3 bg-background border border-border hover:border-primary/50 rounded-2xl flex items-center justify-between group transition-colors"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-xs text-foreground block truncate group-hover:text-foreground transition-colors">{guide.label}</span>
                    <span className="text-[10px] text-subtle-foreground truncate block">{guide.description}</span>
                  </div>
                  <ExternalLink size={14} className="text-subtle-foreground group-hover:text-foreground transition-colors shrink-0 ml-2" />
                </a>
              ))}
            </div>
          </div>

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
    </Modal>
  );
};

export default HelpModal;
