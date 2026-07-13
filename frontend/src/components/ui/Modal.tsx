import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible modal shell — the shared foundation for every dialog in the app
 * (ROADMAP › P3 frontend refactor: "modal a11y — Escape/focus trap").
 *
 * Provides, in one place, what the ad-hoc overlays didn't:
 *  - `role="dialog"`/`alertdialog` + `aria-modal` + labelled/described-by,
 *  - Escape to close,
 *  - a focus trap (Tab/Shift+Tab cycle within the panel),
 *  - initial focus into the dialog and focus restoration to the trigger on close,
 *  - body scroll lock while open,
 *  - backdrop click-to-close.
 *
 * Rendered through a portal to <body> so it always stacks above page content;
 * pass `overlayClassName` to set the z-layer (base modals z-50, nested z-[60],
 * the confirm dialog z-[90]).
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

// Stack of open modals. When modals nest (a confirm/edit dialog over the task
// detail modal), only the top-most one handles Escape and traps focus — otherwise
// a single Escape would close every open modal at once.
const modalStack: symbol[] = [];

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** id of the element that labels the dialog (usually the title). */
  labelledBy?: string;
  /** id of the element that describes the dialog (usually the body text). */
  describedBy?: string;
  /** z-layer + any overlay tweaks. Defaults to base modal layer (z-50). */
  overlayClassName?: string;
  /** styling for the dialog panel itself (background, width, padding, …). */
  panelClassName?: string;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Element to focus first (e.g. a Cancel button on a destructive dialog). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `alertdialog` for confirmations, otherwise `dialog`. */
  role?: 'dialog' | 'alertdialog';
}

export const Modal = ({
  onClose,
  children,
  labelledBy,
  describedBy,
  overlayClassName = 'z-50',
  panelClassName = '',
  closeOnBackdrop = true,
  initialFocusRef,
  role = 'dialog'
}: ModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Register on the modal stack so only the top-most modal handles keys.
    const id = Symbol('modal');
    modalStack.push(id);
    const isTop = () => modalStack[modalStack.length - 1] === id;

    // Lock body scroll while the dialog is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog: an explicit target, else the first focusable,
    // else the panel itself (which is tabIndex=-1 so it can hold focus).
    const focusTarget =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      panelRef.current;
    focusTarget?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(el => el.offsetParent !== null || el === document.activeElement);

      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement;

      // Wrap focus at the edges, and pull it back in if it ever escaped.
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase so Escape/Tab are handled before nested handlers.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose, initialFocusRef]);

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm ${overlayClassName}`}
      // mousedown (not click) so selecting text inside the panel and releasing
      // on the backdrop doesn't count as a backdrop click.
      onMouseDown={e => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
