import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileCode2, FileJson, Loader2 } from 'lucide-react';
import type { Task } from '../types';
import { useAnchoredPanel } from '../hooks/useAnchoredPanel';
import { HelpButton } from './HelpButton';

/**
 * Export one task — in one of two formats, because there are two different
 * questions and no single file answers both.
 *
 * **Native** puts *this exact task* back on *this platform*: Task Scheduler XML
 * for Windows (fetched through the agent, restorable via Tools → Restore),
 * Cronsole JSON for a native task (read back by Import a task). **Portable** is
 * a Registry v1 template — target-agnostic, compiled to a platform's config at
 * apply time, and importable on any install.
 *
 * A single universal format sounds better and is worse. Faithfully restoring a
 * Windows task means carrying its principal, logon type, run level and every
 * action, at which point the format *is* XML with extra steps; portability means
 * dropping precisely those fields, because nothing else can honour them. The
 * merged version is a file that **looks** like a faithful backup and is not —
 * restore it and the task runs as the wrong account, succeeding, so nothing
 * warns you.
 *
 * So the menu names each option by **what it is for**, not by its file
 * extension. The extension is the half a reader cannot act on — the same reason
 * the Import chooser leads with "nothing is created" rather than "from sources".
 *
 * It is a portalled menu rather than a second footer button for two reasons: the
 * task modal's footer already carries a lot, and the modal's own panel is
 * `overflow-hidden`, so an absolutely positioned dropdown would be clipped.
 * `useAnchoredPanel` owns that, shared with the collections menu.
 */

const PANEL_WIDTH = 300;

interface TaskExportMenuProps {
  task: Task;
  /** Runs the download. `format` maps 1:1 to the route's query param. */
  onExport: (format: 'native' | 'template') => void;
  exporting: boolean;
}

/** What "native" means here — stated per platform, since it is not one thing. */
function nativeLabel(task: Task): { title: string; detail: string } | null {
  if (task.platform === 'WINDOWS_TASK_SCHEDULER') {
    return {
      title: 'Windows Task Scheduler XML',
      detail: 'The real definition, read from your machine. Restores onto any Windows PC.'
    };
  }
  if (task.platform === 'TASKHUB_NATIVE') {
    return {
      title: 'Cronsole task JSON',
      detail: 'The whole task. Bring it back with Tools → Import a task.'
    };
  }
  // Claude and anything later: the definition lives on the platform and Cronsole
  // cannot fetch it. Saying so beats a disabled row with the reason in a title=.
  return null;
}

export const TaskExportMenu = ({ task, onExport, exporting }: TaskExportMenuProps) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const pos = useAnchoredPanel({
    open,
    onClose: () => setOpen(false),
    triggerRef: buttonRef,
    panelRef,
    width: PANEL_WIDTH
  });

  const native = nativeLabel(task);

  const choose = (format: 'native' | 'template') => {
    setOpen(false);
    onExport(format);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={exporting}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Export ${task.name}`}
        title="Download this task's definition"
        className="bg-muted hover:bg-muted/80 text-foreground px-4 py-3 rounded-xl font-bold transition-all border border-border active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export
        <ChevronDown size={14} className="text-subtle-foreground" />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            // Invisible until placed, so it never paints once at 0,0 and jumps.
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              width: PANEL_WIDTH,
              visibility: pos ? 'visible' : 'hidden'
            }}
            className="fixed z-[70] rounded-xl border border-border bg-surface shadow-xl p-1.5 space-y-1"
          >
            <div className="flex items-center justify-between px-2.5 pt-1 pb-0.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-subtle-foreground">
                Download as
              </span>
              <HelpButton topic="task-export" />
            </div>

            {native ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => choose('native')}
                className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted transition-colors flex gap-2.5"
              >
                <FileCode2 size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-xs font-bold">{native.title}</span>
                  <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">
                    {native.detail}
                  </span>
                </span>
              </button>
            ) : (
              <p className="px-2.5 py-2 text-[10px] text-muted-foreground leading-snug">
                This platform keeps its own definition, so there is nothing native to download —
                the portable template below still describes what the task runs.
              </p>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => choose('template')}
              className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted transition-colors flex gap-2.5"
            >
              <FileJson size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-xs font-bold">Portable template JSON</span>
                <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">
                  Recreate this task on any install. Drops platform-specific settings like the
                  account it runs as — and adds nothing to your template library.
                </span>
              </span>
            </button>
          </div>,
          document.body
        )}
    </>
  );
};

export default TaskExportMenu;
