import { createContext, useContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** `danger` styles the confirm action red (destructive actions). */
  tone?: 'default' | 'danger';
  /**
   * When set, the confirm button stays disabled until the user types this
   * exact string — the Mass Actions console's typed-confirmation gate
   * (`needsTypedConfirmation`), generalized so a second destructive dialog
   * doesn't need its own bespoke modal to get the same friction.
   */
  requireTypedConfirmation?: string;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

// Shared by ConfirmProvider (the component) and the useConfirm hook. Kept in this
// non-component module so the provider file can satisfy react-refresh's
// "only export components" rule (mirrors useToast/ToastProvider).
export const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Returns `confirm(options) => Promise<boolean>`. Must be under a ConfirmProvider. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx;
}
