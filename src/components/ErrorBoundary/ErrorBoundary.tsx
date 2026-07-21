import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, RefreshCw } from "lucide-react";
import "./ErrorBoundary.css";

type Props = {
  children: ReactNode;
  /**
   * Optional custom fallback renderer. Receives the captured error and
   * reset/reload handlers so callers can render their own recovery UI.
   * If omitted, the styled `DefaultFallback` is used.
   */
  fallback?: (args: {
    error: Error;
    reset: () => void;
    reload: () => void;
  }) => ReactNode;
  /**
   * Optional side-effect hook fired once per caught error (after state is
   * set). Useful for hooking up a real error tracker like Sentry/PostHog
   * without coupling this component to a specific transport.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
};

type State = {
  error: Error | null;
};

/**
 * LottaCash — Cracked Obsidian Error Boundary
 *
 * React 19 still requires a class component to catch render errors; the
 * `useErrorBoundary` hook only works inside other error boundaries, not at
 * the top level. Wrap any subtree that can throw during render (typically
 * the page content) so a single bad page doesn't white-screen the whole
 * app — the topbar, sidebar, and footer remain interactive and the user
 * can navigate elsewhere.
 *
 * Usage:
 *   <ErrorBoundary key={pathname}>
 *     <PageTransition>...</PageTransition>
 *   </ErrorBoundary>
 *
 * The `key={pathname}` trick forces a remount (and thus an automatic reset)
 * on every route change, so a boundary that caught an error on `/keno`
 * won't block the user from clicking a sidebar link to `/help`.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  reload = (): void => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback({
        error,
        reset: this.reset,
        reload: this.reload,
      });
    }
    return (
      <DefaultFallback
        error={error}
        reset={this.reset}
        reload={this.reload}
      />
    );
  }
}

function DefaultFallback({
  error,
  reset,
  reload,
}: {
  error: Error;
  reset: () => void;
  reload: () => void;
}) {
  const isDev = import.meta.env.DEV;
  // EXCEPTION-DETAIL POLICY (per audit fix):
  //   - Title + body always visible (no change for prod).
  //   - "Error: TypeError" chip is shown in production so users can relay the
  //     kind of failure to support without opening DevTools.
  //   - Truncated first-line message below the body is shown in production
  //     too — render-time TypeError/ReferenceError messages are brief and
  //     non-sensitive. Capped at 140 chars so a runaway stack-string can't
  //     blow out the layout.
  //   - Full stack + component-stack remain dev-only.
  const errorClass = error.name || "Error";
  // Trim to first line + cap to 140 chars.
  const firstLine = error.message ? error.message.split("\n", 1)[0] : "";
  const summaryLine = firstLine ? firstLine.slice(0, 140) : "";
  return (
    <div className="lc-error-boundary" role="alert">
      <div className="lc-error-boundary__icon" aria-hidden="true">
        <AlertTriangle size={48} strokeWidth={1.5} />
      </div>
      <h2 className="lc-error-boundary__title">Something went wrong</h2>
      <p className="lc-error-boundary__body">
        An unexpected error occurred while rendering this page. You can try
        again, or reload the entire app if the problem persists.
      </p>
      {errorClass && (
        <p className="lc-error-boundary__chip" aria-live="polite">
          <span className="lc-error-boundary__chip-label">Error</span>
          <code>{errorClass}</code>
        </p>
      )}
      {summaryLine && (
        <p className="lc-error-boundary__summary" aria-live="polite">
          <code>{summaryLine}</code>
        </p>
      )}
      {isDev && (
        <details className="lc-error-boundary__details">
          <summary>Error details (dev only)</summary>
          <pre>
            {error.message}
            {"\n\n"}
            {error.stack}
          </pre>
        </details>
      )}
      <div className="lc-error-boundary__actions">
        <button
          type="button"
          className="lc-error-boundary__btn"
          onClick={reset}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Try again
        </button>
        <button
          type="button"
          className="lc-error-boundary__btn lc-error-boundary__btn--primary"
          onClick={reload}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Reload page
        </button>
      </div>
    </div>
  );
}
