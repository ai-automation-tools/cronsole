import { createContext, useContext } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastContextValue {
  /** Show a transient toast. Defaults to the neutral `info` variant. */
  toast: (message: string, variant?: ToastVariant) => void;
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
