import React from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL, APP_VERSION } from "@/lib/appInfo";

interface Props {
  children: React.ReactNode;
  /** Shown in the heading, e.g. "Estimates". */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions.
 *
 * React 18 unmounts the ENTIRE tree when a render throws, which the user
 * experiences as the app going blank — no message, no way back, nothing to
 * report. That is exactly what a `null` product name did to the estimate form.
 * The specific bug is fixed, but any future one would fail the same way, so the
 * class of failure is worth containing: a boundary turns a white screen into a
 * screen the user can read, retry from, and quote back to support.
 *
 * Deliberately a class component — hooks cannot express componentDidCatch.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept in the console so `adb logcat` picks it up from a real device.
    console.error("[ui] render error:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  private reload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const area = this.props.area ?? "This screen";

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 py-10 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-8 w-8" />
        </span>

        <div className="space-y-1.5">
          <h1 className="text-xl font-bold text-foreground">{area} hit a problem</h1>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Nothing you saved has been lost — your estimates are stored on this device. Try again,
            and if it keeps happening send us the details below.
          </p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-2">
          <Button size="lg" className="h-12 w-full" onClick={this.reset}>
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
          <Button variant="outline" size="lg" className="h-12 w-full" onClick={this.reload}>
            <RefreshCw className="h-4 w-4" />
            Restart the app
          </Button>
        </div>

        {/* The message is the one thing that makes a report actionable, so it is
            shown rather than hidden behind a debug flag. */}
        <details className="w-full max-w-sm text-left">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Technical details
          </summary>
          <p className="break-anywhere mt-2 rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            v{APP_VERSION} — {error.message || String(error)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Send this to{" "}
            <a className="font-medium text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
        </details>
      </div>
    );
  }
}

export default ErrorBoundary;
