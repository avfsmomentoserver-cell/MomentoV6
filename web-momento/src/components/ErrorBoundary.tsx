// Error boundaries: a crashing page shows a recoverable panel instead of
// unmounting the whole app. Resets automatically when the route changes.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

interface Props { children: ReactNode; resetKey?: string; label?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[momento] ${this.props.label ?? "page"} crashed:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-10 max-w-xl rounded-xl border border-rose-400/30 bg-rose-500/[0.06] p-5 text-sm">
        <p className="text-[11px] uppercase tracking-[0.16em] text-rose-300">This view hit an error</p>
        <p className="mt-2 font-data text-[12.5px] text-foreground">{this.state.error.message || String(this.state.error)}</p>
        <p className="mt-2 text-[12px] text-muted-foreground">The rest of the platform is still running. Retry, or pick another page from the menu. If the backend is older than v6.4, some endpoints this page needs may not exist yet.</p>
        <div className="mt-4 flex gap-2">
          <button className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground" onClick={() => this.setState({ error: null })}>Retry</button>
          <button className="rounded-md border border-border px-3 py-1.5 text-[12px]" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      </div>
    );
  }
}

/** Boundary that resets on navigation — wrap route outlets with this. */
export function RouteBoundary({ children, label }: { children: ReactNode; label?: string }) {
  const loc = useLocation();
  return <ErrorBoundary resetKey={loc.pathname} label={label}>{children}</ErrorBoundary>;
}
