import { useState } from 'react';
import { XCircle, HelpCircle, BookOpen, ExternalLink, Sparkles, Compass, ArrowLeft, ChevronRight, LifeBuoy } from 'lucide-react';
import { GETTING_STARTED_STEPS, HELP_GUIDES } from '../data/onboarding';
import { helpTopic, helpTopics, type HelpTopic } from '../data/help';
import { Modal } from './ui/Modal';

/**
 * One modal, two modes.
 *
 * Opened from the header it is the **Help Center** — the hub, with the
 * getting-started walkthrough and every guide. Opened from a `?` it is **one
 * topic**, in place, on the thing you were looking at.
 *
 * They are the same component rather than two, because the interesting
 * behaviour is the seam between them: a specific answer must never be a dead
 * end (every topic ends in *Browse all help*), and the hub must be able to reach
 * every topic (it lists them). Two components would have made that seam a prop
 * threaded through half the app instead of one piece of local state.
 */

interface HelpModalProps {
  onClose: () => void;
  /** Open straight onto one topic. Omitted → the Help Center hub. */
  topic?: string;
}

export const HelpModal = ({ onClose, topic }: HelpModalProps) => {
  // Where we are *now*, which the Back / Browse-all controls move. The prop is
  // only the starting point — reopening on a topic and navigating to the hub is
  // the whole point of the seam.
  const [activeId, setActiveId] = useState<string | null>(topic ?? null);
  const active = activeId ? helpTopic(activeId) : undefined;

  if (active) {
    return <TopicView topic={active} onClose={onClose} onBrowseAll={() => setActiveId(null)} />;
  }

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
            <h2 id="help-center-title" className="text-xl font-bold">Cronsole Help Center</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              Get started, master the basics, and find the full guides.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close help center" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
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

          {/*
            The index for the `?` buttons. Present here as well as beside each
            control because the two entry points fail in opposite directions:
            a `?` is only findable if you are already looking at the control it
            explains, and the hub is only useful if it can reach what the `?`
            buttons say.
          */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <LifeBuoy size={14} className="text-primary" />
              Help by topic
            </h3>
            <p className="text-[11px] text-subtle-foreground -mt-1">
              The same topics behind the <span className="font-bold">?</span> buttons around the app.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {helpTopics().map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className="p-2.5 bg-background border border-border hover:border-primary/50 rounded-xl flex items-center justify-between gap-2 text-left group transition-colors"
                >
                  <span className="font-semibold text-xs text-foreground truncate">{t.title}</span>
                  <ChevronRight size={14} className="text-subtle-foreground group-hover:text-foreground transition-colors shrink-0" />
                </button>
              ))}
            </div>
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
              <Sparkles size={14} className="text-warning-text" />
              Pro Automation Tips
            </h3>
            
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-background/50 rounded-2xl border border-border/80">
                <span className="font-bold text-foreground block mb-1">📂 Dynamic Local Categorization</span>
                <p className="text-muted-foreground">
                  Cronsole automatically infers root folders as categories (e.g. a Windows task at <code className="bg-surface px-1 py-0.5 rounded text-foreground">\Monitoring\Logs</code> is categorized as "Monitoring"). You can rename categories by clicking the category label on any card.
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
                  The Cronsole Windows Agent runs locally to execute tasks. If the agent is offline, tasks will queue up and sync the next time the agent starts.
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
                href="https://github.com/ai-automation-tools/cronsole"
                target="_blank" 
                rel="noopener noreferrer"
                className="p-3 bg-background border border-border hover:border-primary/50 rounded-2xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-foreground block truncate group-hover:text-foreground transition-colors">Cronsole Repository</span>
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

/**
 * One topic: what it is, the two or three things that surprise people, and the
 * doc that covers it in full.
 *
 * The doc link is styled as the primary action rather than a footnote. A
 * popover is a summary by construction — it cannot hold the reasoning, the
 * exceptions or the history — so the honest thing is to make the way to the
 * full version the most visible control on it.
 */
const TopicView = ({
  topic,
  onClose,
  onBrowseAll
}: {
  topic: HelpTopic;
  onClose: () => void;
  onBrowseAll: () => void;
}) => (
  <Modal
    onClose={onClose}
    overlayClassName="z-[60]"
    labelledBy="help-topic-title"
    panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
  >
    <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50 gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <HelpCircle className="text-primary shrink-0" size={18} />
          <p className="text-[10px] text-subtle-foreground uppercase font-black tracking-widest">Help</p>
        </div>
        <h2 id="help-topic-title" className="text-lg font-bold">{topic.title}</h2>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{topic.summary}</p>
      </div>
      <button
        onClick={onClose}
        aria-label="Close help"
        title="Close"
        className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0"
      >
        <XCircle size={20} />
      </button>
    </header>

    <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
      <ul className="space-y-2.5">
        {topic.points.map(point => (
          <li key={point.label} className="p-3 bg-background/50 rounded-2xl border border-border/80 text-xs">
            <span className="font-bold text-foreground block mb-0.5">{point.label}</span>
            <p className="text-muted-foreground leading-relaxed">{point.body}</p>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <a
          href={topic.doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-3 bg-primary/10 border border-primary/30 hover:border-primary/60 rounded-2xl flex items-center justify-between gap-2 group transition-colors"
        >
          <div className="min-w-0">
            <span className="font-bold text-xs text-foreground block">Read the full docs</span>
            <span className="text-[10px] text-muted-foreground truncate block">{topic.doc.label}</span>
          </div>
          <ExternalLink size={14} className="text-primary shrink-0" />
        </a>

        {topic.more?.map(link => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2.5 bg-background border border-border hover:border-primary/50 rounded-xl flex items-center justify-between gap-2 group transition-colors"
          >
            <span className="font-semibold text-[11px] text-muted-foreground group-hover:text-foreground transition-colors truncate">
              {link.label}
            </span>
            <ExternalLink size={12} className="text-subtle-foreground shrink-0" />
          </a>
        ))}
      </div>
    </div>

    {/* A specific answer must not be a dead end — this is the way back up to
        everything else, and it is why the hub and the topics are one component. */}
    <footer className="p-4 bg-background border-t border-border flex gap-3">
      <button
        onClick={onBrowseAll}
        className="flex-1 py-2.5 rounded-xl font-bold text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5"
      >
        <ArrowLeft size={13} /> Browse all help
      </button>
      <button
        onClick={onClose}
        className="flex-1 bg-muted hover:bg-muted/70 py-2.5 rounded-xl font-bold transition-all text-xs active:scale-95 text-foreground"
      >
        Close
      </button>
    </footer>
  </Modal>
);

export default HelpModal;
