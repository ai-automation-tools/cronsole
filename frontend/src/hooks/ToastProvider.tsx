import { useCallback, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { ToastContext, type ToastVariant } from './useToast';

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

const VARIANT_STYLES: Record<ToastVariant, { ring: string; Icon: typeof Info; icon: string }> = {
  success: { ring: 'border-green-500/40', Icon: CheckCircle2, icon: 'text-green-400' },
  error: { ring: 'border-red-500/40', Icon: XCircle, icon: 'text-red-400' },
  info: { ring: 'border-primary/40', Icon: Info, icon: 'text-foreground' },
};

let nextId = 1;

/**
 * Lightweight, dependency-free toast system. Wrap the app once and call
 * `useToast().toast(...)` anywhere. Replaces blocking `alert()` calls so a
 * background task run doesn't freeze the UI. Auto-dismisses after 4s.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, variant }]);
    window.setTimeout(() => remove(id), 4000);
  }, [remove]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
        {toasts.map(t => {
          const { ring, Icon, icon } = VARIANT_STYLES[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border ${ring}
                          bg-surface/95 backdrop-blur-sm px-4 py-3 text-sm text-foreground
                          shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-300`}
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${icon}`} />
              <p className="flex-1 leading-snug">{t.message}</p>
              <button
                onClick={() => remove(t.id)}
                className="shrink-0 text-subtle-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
