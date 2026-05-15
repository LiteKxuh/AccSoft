/* HotelOps · Pane Error Boundary
 * =================================================================
 * Wraps every tab body so a render fault in one pane cannot crash
 * the entire app. Operational state survives — the user can switch
 * tabs, reload the pane, or copy the diagnostic to share.
 *
 * Usage:
 *   <PaneErrorBoundary name="Forensics" onResetKey={tab}>
 *     <ForensicsPane ... />
 *   </PaneErrorBoundary>
 *
 * `onResetKey` changes (e.g. tab switch) auto-reset the boundary so
 * navigating away and back recovers without manual intervention.
 */

import React from "react";
import { AlertTriangle, RefreshCw, Copy } from "lucide-react";
import { record } from "./diagnostics.js";

export class PaneErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null, lastResetKey: props.onResetKey };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    // Auto-reset when the parent's onResetKey changes (e.g., tab switch).
    if (prevState.err && prevState.lastResetKey !== nextProps.onResetKey) {
      return { err: null, info: null, lastResetKey: nextProps.onResetKey };
    }
    if (prevState.lastResetKey !== nextProps.onResetKey) {
      return { lastResetKey: nextProps.onResetKey };
    }
    return null;
  }

  componentDidCatch(err, info) {
    this.setState({ info });
    try {
      record("error", `pane:${this.props.name || "unknown"}`, err?.message || "Pane render failure", { stack: err?.stack, componentStack: info?.componentStack });
    } catch { /* never let logging crash recovery */ }
    if (this.props.onError) {
      try { this.props.onError(err, info); } catch { /* swallow */ }
    }
  }

  reset = () => {
    this.setState({ err: null, info: null });
  };

  copy = () => {
    const { err, info } = this.state;
    const text = `Pane: ${this.props.name || "unknown"}\nError: ${err?.message || ""}\n\nStack:\n${err?.stack || ""}\n\nComponent stack:\n${info?.componentStack || ""}`;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(text);
      }
    } catch { /* clipboard may not be available */ }
  };

  render() {
    if (!this.state.err) return this.props.children;
    const err = this.state.err;
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangle className="text-rose-600 flex-shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-lg text-rose-900">
                {this.props.name ? `${this.props.name} pane crashed` : "Pane crashed"}
              </h2>
              <p className="text-sm text-rose-700 mt-1">
                This pane stopped rendering. The rest of the app is still operational —
                switch tabs to continue working. Operational state was preserved.
              </p>
            </div>
          </div>
          <div className="bg-white border border-rose-200 rounded p-3 mb-3">
            <div className="text-xs uppercase tracking-wider text-rose-700 font-bold mb-1">Error</div>
            <div className="text-sm font-mono text-stone-800 break-words">{err.message || String(err)}</div>
          </div>
          {err.stack && (
            <details className="bg-white border border-rose-200 rounded p-3 mb-3">
              <summary className="text-xs uppercase tracking-wider text-rose-700 font-bold cursor-pointer">Stack trace</summary>
              <pre className="text-[11px] font-mono text-stone-700 mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{String(err.stack)}</pre>
            </details>
          )}
          <div className="flex items-center gap-2">
            <button onClick={this.reset}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-md">
              <RefreshCw size={13} /> Retry
            </button>
            <button onClick={this.copy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-md">
              <Copy size={13} /> Copy diagnostic
            </button>
            <span className="text-xs text-rose-600 ml-2">Reported to Diagnostics pane.</span>
          </div>
        </div>
      </div>
    );
  }
}
