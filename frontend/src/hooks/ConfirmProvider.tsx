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
  danger: 'bg-red-500 text-white hover:bg-red-600'
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  // Focus Cancel first so a stray Enter on a destructive dialog doesn't confirm.
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(options => {
    setOptions(options);
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
              <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={20} aria-hidden />
            )}
            <div className="flex-1 min-w-0">
              <h2 id="confirm-dialog-title" className="text-lg font-bold text-foreground">
                {options.title}
              </h2>
              {options.message && (
                <p id="confirm-dialog-message" className="mt-2 text-sm text-muted-foreground">
                  {options.message}
                </p>
              )}
            </div>
          </div>
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
              className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${CONFIRM_BTN[tone]}`}
            >
              {options.confirmText ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
