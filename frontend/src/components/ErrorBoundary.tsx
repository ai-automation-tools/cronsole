import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render error so one broken screen does not blank the whole app.
 *
 * A boundary has to be a class: React has no hook for it. `resetKey` clears the
 * error when it changes, so moving to another tab recovers without a reload.
 * "Reset preferences" exists because the likeliest cause that survives a reload
 * is a stored setting the current code cannot read.
 */
interface Props {
  children: ReactNode;
  /** Changing this value clears a caught error (e.g. the current tab). */
  resetKey?: string;
  /** Storage key to remove on "Reset preferences". Omit to hide the button. */
  preferencesKey?: string;
}

interface State {
  error: Error | null;
  resetKey?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cronsole render error:', error, info.componentStack);
  }

  private resetPreferences = () => {
    try {
      if (this.props.preferencesKey) localStorage.removeItem(this.props.preferencesKey);
    } catch {
      // Storage can be blocked; reloading is still the right next step.
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-16 max-w-lg rounded-2xl border border-border bg-surface p-6 text-center">
        <h2 className="text-lg font-bold text-foreground">This screen hit an error</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your tasks are not affected; they keep running on their own platforms.
        </p>
        <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-danger-text">
          {error.message || String(error)}
        </pre>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-bold hover:bg-primary-hover"
          >
            Reload
          </button>
          {this.props.preferencesKey && (
            <button
              onClick={this.resetPreferences}
              className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-foreground hover:bg-muted"
            >
              Reset preferences and reload
            </button>
          )}
        </div>
      </div>
    );
  }
}
