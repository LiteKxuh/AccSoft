/* HotelOps · SafeChart wrapper
 * =================================================================
 * Defensive wrapper around recharts components. Recharts will crash
 * the render tree on:
 *   - empty/null data arrays
 *   - non-finite values (NaN, Infinity)
 *   - undefined dataKey on a series object
 *   - mismatched series lengths
 *
 * SafeChart:
 *   1. Filters out non-finite numeric values, replacing them with null
 *      so recharts renders gaps instead of NaN-poisoned scales.
 *   2. Renders an empty-state when the dataset is empty.
 *   3. Catches render errors via an internal boundary so chart-level
 *      faults never propagate up.
 *
 * Usage:
 *   <SafeChart data={rows} numericKeys={["revenue", "cost"]} emptyMessage="No data">
 *     {(safeData) => (
 *       <LineChart data={safeData}>
 *         <Line dataKey="revenue" />
 *       </LineChart>
 *     )}
 *   </SafeChart>
 */

import React from "react";

class ChartBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) {
    try {
      // Lazy-import to avoid circular dependency on diagnostics
      // (diagnostics imports nothing heavy, but be defensive)
      import("./diagnostics.js").then(d => d.record("error", "chart", err?.message || "Chart render failed", err)).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.err) {
      return (
        <div className="p-4 text-xs text-stone-500 italic text-center bg-stone-50 border border-stone-200 rounded">
          Chart could not render. Data may be malformed.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Sanitize a row by replacing any non-finite number on listed keys with null.
 * Non-numeric values pass through untouched.
 */
export function sanitizeChartRow(row, numericKeys = []) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const k of numericKeys) {
    const v = out[k];
    if (typeof v === "number" && !Number.isFinite(v)) out[k] = null;
  }
  return out;
}

/** Sanitize an entire dataset. Returns [] for invalid inputs. */
export function sanitizeChartData(data, numericKeys = []) {
  if (!Array.isArray(data)) return [];
  if (data.length === 0) return [];
  if (numericKeys.length === 0) {
    // Auto-detect numeric keys from the first row
    const first = data[0] || {};
    numericKeys = Object.keys(first).filter(k => typeof first[k] === "number");
  }
  return data.map(r => sanitizeChartRow(r, numericKeys));
}

export function SafeChart({ data, numericKeys = [], emptyMessage = "No data available", height = "auto", children }) {
  const safeData = React.useMemo(() => sanitizeChartData(data, numericKeys), [data, numericKeys.join(",")]);
  if (!safeData.length) {
    return (
      <div className="p-4 text-xs text-stone-500 italic text-center bg-stone-50 border border-stone-200 rounded" style={{ height: height === "auto" ? undefined : height }}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <ChartBoundary>
      {typeof children === "function" ? children(safeData) : children}
    </ChartBoundary>
  );
}
