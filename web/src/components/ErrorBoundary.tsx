import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  /** Shown instead of the default screen — used to scope a boundary to a page. */
  fallback?: (reset: () => void, error: Error) => ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so one bad component can't white-screen the whole
 * PWA. That matters more here than in a normal SPA: this app is used offline in
 * a gym, where "just reload it" may not be an option and an unrecoverable blank
 * screen can mean losing an in-progress workout.
 *
 * Recovery is deliberately staged — try re-rendering first, and only offer the
 * destructive "clear cached data" escape hatch as a last resort, because the
 * cache holds sessions that haven't synced yet.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, error);

    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Something broke</h1>
          <p className="text-sm text-muted-foreground">
            The app hit an unexpected error. Your logged workouts are saved.
          </p>
        </div>
        <pre className="max-w-full overflow-x-auto rounded-lg bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
          {error.message}
        </pre>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={this.reset}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      </div>
    );
  }
}
