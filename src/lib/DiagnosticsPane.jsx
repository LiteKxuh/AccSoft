/* HotelOps · Diagnostics Pane
 * =================================================================
 * Live view of runtime errors, slow operations, and platform health.
 * Designed for the controller / IT lead to triage issues without
 * touching DevTools.
 */

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, RefreshCw, Trash2, Copy, Download } from "lucide-react";
import { getLog, clearLog, subscribe, getMetrics, healthSnapshot } from "./diagnostics.js";

const LEVEL_STYLE = {
  error: "text-rose-700 bg-rose-50 border-rose-200",
  warn:  "text-amber-700 bg-amber-50 border-amber-200",
  info:  "text-sky-700 bg-sky-50 border-sky-200",
  debug: "text-stone-600 bg-stone-50 border-stone-200",
};

export function DiagnosticsPane() {
  const [entries, setEntries] = useState(getLog());
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const unsub = subscribe(() => setEntries(getLog()));
    return unsub;
  }, []);

  const metrics = getMetrics();
  const health = healthSnapshot();
  const filtered = filter === "all" ? entries : entries.filter(e => e.level === filter);

  function clear() {
    clearLog();
    setEntries([]);
  }
  function copyAll() {
    const text = filtered.map(e => `[${e.at}] ${e.level.toUpperCase()} ${e.source}: ${e.message}${e.detail ? "\n" + JSON.stringify(e.detail).slice(0, 400) : ""}`).join("\n");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(text);
    } catch {}
  }
  function downloadJson() {
    try {
      const blob = new Blob([JSON.stringify({ runtime: metrics, log: entries }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hotelops-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* download isn't critical */
    }
  }

  const bandColor = health.status === "healthy" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : health.status === "watch" ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-rose-50 border-rose-200 text-rose-700";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-3 pb-3 border-b border-stone-200">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-stone-700 text-[10px] uppercase tracking-[0.25em] font-bold">Runtime Diagnostics</span>
          </div>
          <h1 className="font-display text-2xl text-stone-900">Platform Health</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Errors, slow operations, and runtime telemetry. Local only — nothing leaves the device.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyAll} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-stone-300 rounded-md hover:bg-stone-50">
            <Copy size={13} /> Copy
          </button>
          <button onClick={downloadJson} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-stone-300 rounded-md hover:bg-stone-50">
            <Download size={13} /> Export JSON
          </button>
          <button onClick={clear} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-rose-200 text-rose-700 rounded-md hover:bg-rose-50">
            <Trash2 size={13} /> Clear log
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className={`rounded-lg border p-3 ${bandColor}`}>
          <div className="text-[10px] uppercase tracking-wider font-bold">Status</div>
          <div className="font-display text-xl font-semibold mt-1 capitalize">{health.status}</div>
        </div>
        <StatTile label="Errors" value={metrics.errors} tone={metrics.errors > 0 ? "bad" : "ok"} />
        <StatTile label="Promise rejections" value={metrics.unhandledRejections} tone={metrics.unhandledRejections > 0 ? "bad" : "ok"} />
        <StatTile label="Slow operations" value={metrics.slowOps.length} tone={metrics.slowOps.length > 5 ? "warn" : "ok"} />
      </div>

      {metrics.slowOps.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="px-4 py-2 border-b border-stone-100 bg-stone-50/50">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-stone-700">Recent slow operations (&gt;750ms)</h3>
          </div>
          <div className="divide-y divide-stone-100">
            {metrics.slowOps.slice(-10).reverse().map((s, i) => (
              <div key={i} className="px-4 py-2 flex items-center justify-between text-sm">
                <div className="font-mono text-stone-800">{s.name}</div>
                <div className="tabular text-amber-700 font-semibold">{s.ms}ms</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="px-4 py-2 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-stone-700">Log ({filtered.length} of {entries.length})</h3>
          <div className="flex items-center gap-1">
            {["all", "error", "warn", "info", "debug"].map(l => (
              <button key={l} onClick={() => setFilter(l)}
                      className={`px-2 py-0.5 text-xs rounded ${filter === l ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-stone-500 italic">No log entries match this filter.</div>
        ) : (
          <div className="divide-y divide-stone-100 max-h-[500px] overflow-y-auto">
            {filtered.slice().reverse().map((e, i) => {
              const style = LEVEL_STYLE[e.level] || LEVEL_STYLE.info;
              return (
                <div key={`${e.at}_${i}`} className={`px-4 py-2 border-l-4 ${style}`}>
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-bold uppercase tracking-wider">{e.level}</span>
                    <span className="text-stone-500">{e.source}</span>
                    <span className="text-stone-400 ml-auto tabular">{e.at.slice(11, 19)}</span>
                  </div>
                  <div className="text-sm text-stone-800 mt-0.5 break-words">{e.message}</div>
                  {e.detail && (
                    <details className="mt-1">
                      <summary className="text-[11px] text-stone-500 cursor-pointer">Detail</summary>
                      <pre className="text-[11px] font-mono text-stone-600 mt-1 whitespace-pre-wrap max-h-48 overflow-auto bg-white border border-stone-200 rounded p-2">
                        {typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }) {
  const color = tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-stone-900";
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-wider font-bold text-stone-500">{label}</div>
      <div className={`font-display text-xl font-semibold mt-1 tabular ${color}`}>{value}</div>
    </div>
  );
}
