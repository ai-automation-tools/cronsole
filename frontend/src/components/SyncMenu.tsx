import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MonitorCog, RefreshCw } from 'lucide-react';
import { useAnchoredPanel } from '../hooks/useAnchoredPanel';
import { HelpButton } from './HelpButton';

/**
 * Sync reads a **source** — and it does two different things to one.
 *
 * **Refresh** re-pulls status and schedules for the folders already tracked
 * (`scope: 'tracked'`). **Add tasks from this machine** adopts folders that are
 * not (`{ categories }`). They are one control because they are the same
 * question — *what is on the machine?* — and two gestures because the second
 * answer changes what Cronsole tracks.
 *
 * **They must stay two requests, not one convenient merge.** An explicit
 * `categories` call forgets the untracks inside those folders, which is right:
 * naming a folder is the gesture that started tracking it. A refresh must never
 * do that, or a routine sync silently undoes a deliberate removal — the
 * invisible-fence failure, arriving from the side that looks harmless. A single
 * "sync everything" button is precisely how that gets built by accident.
 *
 * The primary click stays the refresh, because it is the one you press often and
 * it asks nothing of you. Discovery is a full agent round trip that can take its
 * timeout, so it sits behind a deliberate second click rather than riding along
 * with every refresh.
 *
 * Portalled through `useAnchoredPanel` for the same reason the export and
 * collection menus are: the header sits inside scrolling, clipping ancestors, so
 * an absolutely positioned dropdown would be cut off — and the hook already owns
 * flipping above the fold on a phone.
 */

const PANEL_WIDTH = 300;

interface SyncMenuProps {
  /** Refresh what is already tracked. The primary click and the first menu row. */
  onRefresh: () => void;
  /** Open the folder picker — the only path that can adopt anything new. */
  onAddSources: () => void;
  isSyncing: boolean;
}

export const SyncMenu = ({ onRefresh, onAddSources, isSyncing }: SyncMenuProps) => {
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

  const choose = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <div className="flex items-stretch">
      {/* A split button, not two: the caret belongs to the primary action, and
          a reader should not have to decide which of two adjacent buttons is
          "the sync". */}
      <button
        onClick={onRefresh}
        disabled={isSyncing}
        className="bg-primary hover:bg-primary-hover text-primary-foreground pl-4 pr-3 py-2 rounded-l-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
        title="Re-pull status and schedules for the tasks you already track"
      >
        <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} /> {isSyncing ? 'Syncing…' : 'Sync'}
      </button>

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={isSyncing}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Sync options"
        className="bg-primary hover:bg-primary-hover text-primary-foreground px-2 rounded-r-lg border-l border-primary-foreground/20 transition-all shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center"
      >
        <ChevronDown size={14} />
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
                Sync with this machine
              </span>
              <HelpButton topic="import" />
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onRefresh)}
              className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted transition-colors flex gap-2.5"
            >
              <RefreshCw size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-xs font-bold">Refresh tracked tasks</span>
                <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">
                  Re-reads status and schedules for the folders you already track. Adds nothing new.
                </span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onAddSources)}
              className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted transition-colors flex gap-2.5"
            >
              <MonitorCog size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-xs font-bold">Add tasks from this machine…</span>
                <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">
                  Pick folders Cronsole can see and start tracking them. Nothing is created — these
                  tasks run whether or not Cronsole knows about them.
                </span>
              </span>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};

export default SyncMenu;
