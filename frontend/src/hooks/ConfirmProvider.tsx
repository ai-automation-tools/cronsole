import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from './useConfirm';

/**
 * Promise-based confirmation dialog, mirroring the ToastProvider pattern.
 * `const confirm = useConfirm(); if (await confirm({...})) { … }` replaces the
 * blocking native `confirm()` (ROADMAP › P3 frontend refactor). One dialog is
 * rendered for the whole app; each call resolves true (confirmed) or false
 * (cancelled / dismissed).
 */

const CONFIRM_BTN: Record<NonNullable<ConfirmOptions['tone']>, string> = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
  danger: 'bg-danger text-danger-foreground hover:bg-danger/85'
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  // Focus Cancel first so a stray Enter on a destructive dialog doesn't confirm.
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(options => {
    setOptions(options);
    setTyped('');
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = (result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  };

  const tone = options?.tone ?? 'default';
  const mustType = options?.requireTypedConfirmation;
  const canConfirm = !mustType || typed.trim() === mustType;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Modal
          onClose={() => settle(false)}
          role="alertdialog"
          overlayClassName="z-[90]"
          labelledBy="confirm-dialog-title"
          describedBy={options.message ? 'confirm-dialog-message' : undefined}
          initialFocusRef={cancelRef}
          panelClassName="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md p-6"
        >
          <div className="flex items-start gap-3">
            {tone === 'danger' && (
              <AlertTriangle className="text-danger-text shrink-0 mt-0.5" size={20} aria-hidden />
            )}
            <div className="flex-1 min-w-0">
              <h2 id="confirm-dialog-title" className="text-lg font-bold text-foreground">
                {options.title}
              </h2>
              {/*
                `whitespace-pre-line` so a message can use blank lines to separate
                "what happens" from "what survives". A confirm for an irreversible
                action that runs together into one grey block is a confirm nobody
                reads. Existing single-line messages are unaffected.
              */}
              {options.message && (
                <p id="confirm-dialog-message" className="mt-2 text-sm text-muted-foreground whitespace-pre-line">
                  {options.message}
                </p>
              )}
            </div>
          </div>
          {mustType && (
            <div className="mt-4 space-y-2 bg-warning/10 border border-warning/30 rounded-xl p-4">
              <p className="text-xs text-warning-text font-bold">
                Type <strong>{mustType}</strong> to confirm.
              </p>
              <input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                aria-label={`Type ${mustType} to confirm`}
                placeholder={`Type ${mustType} here`}
                className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              ref={cancelRef}
              onClick={() => settle(false)}
              className="px-4 py-2.5 rounded-xl font-bold text-sm border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-background transition-all active:scale-95"
            >
              {options.cancelText ?? 'Cancel'}
            </button>
            <button
              onClick={() => settle(true)}
              disabled={!canConfirm}
              className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${CONFIRM_BTN[tone]}`}
            >
              {options.confirmText ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
