import { createContext, useContext } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

/**
 * A single control on a toast — the thing the message just told you to go and do.
 *
 * Deliberately one, and deliberately optional. A toast that names a screen and
 * makes you go and find it is a dead end for the message whose whole job is to
 * be actionable; a toast with a row of buttons is a dialog that dismisses itself
 * after four seconds.
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastContextValue {
  /** Show a transient toast. Defaults to the neutral `info` variant. */
  toast: (message: string, variant?: ToastVariant, action?: ToastAction) => void;
}

// Shared by ToastProvider (the component) and the useToast hook. Kept in this
// non-component module so the provider file can satisfy react-refresh's
// "only export components" rule.
export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
