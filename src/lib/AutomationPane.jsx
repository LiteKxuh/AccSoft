import { useMemo, useState } from "react";
import { Zap, Play, CheckCircle2, X, AlertTriangle, Info } from "lucide-react";
import { snapshot, portfolioSnapshot } from "./hotelState.js";
import { evaluate, evaluatePortfolio, applyEvents, resolveEvent, summarizeAutomation } from "./workflowEngine.js";
import { DEFAULT_RULES, listRules } from "./automationRules.js";

function fmtDateTime(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

const SEV_STYLE = {
  high:   { dot: "bg-rose-500",    text: "text-rose-700",    chip: "bg-rose-100 text-rose-700" },
  medium: { dot: "bg-amber-500",   text: "text-amber-700",   chip: "bg-amber-100 text-amber-700" },
  low:    { dot: "bg-sky-500",     text: "text-sky-700",     chip: "bg-sky-100 text-sky-700" },
  info:   { dot: "bg-stone-400",   text: "text-stone-600",   chip: "bg-stone-100 text-stone-600" },
};

export function AutomationPane({ ctx, enrichReport }) {
  const { state, accessibleProperties, currentUser, toast, update } = ctx;
  const asOf = new Date().toISOString().slice(0, 10);
  const propertyIds = accessibleProperties.map(p => p.id);

  const snapshots = useMemo(
    () => portfolioSnapshot(state, { propertyIds, asOf, enrichReport }),
    [state, propertyIds.join(","), asOf, enrichReport]
  );
  const pendingEvents = useMemo(() => evaluatePortfolio(snapshots, DEFAULT_RULES), [snapshots]);
  const summary = useMemo(() => summarizeAutomation(state), [state.automationEvents]);

  const runEvaluation = () => {
    const patch = applyEvents(state, pendingEvents, currentUser);
    if (!patch) {
      toast?.push?.("No new events — everything already tracked.", { tone: "info" });
      return;
    }
    update(patch);
    toast?.push?.(`${patch.automationEvents.length - (state.automationEvents?.length || 0)} new automation event(s) recorded.`, { tone: "success" });
  };

  const resolve = (id, status) => {
    const patch = resolveEvent(state, id, currentUser, status);
    update(patch);
    toast?.push?.(`Event ${status === "resolved" ? "resolved" : "dismissed"}`, { tone: "success" });
  };

  const openEvents = (state.automationEvents || []).filter(e => e.status === "open");
  const recentClosed = (state.automationEvents || []).filter(e => e.status !== "open").slice(-30).reverse();

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Automation Engine</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800 uppercase tracking-wider">Rules</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{summary.open} open · {summary.resolved} resolved</h2>
          <p className="text-sm text-stone-500 mt-1">{DEFAULT_RULES.length} rules monitor occupancy compression, labor variance, AP aging, audit health, settlement gaps, approval backlogs, and more.</p>
        </div>
        <div>
          <button onClick={runEvaluation} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-amber-700 hover:bg-amber-800 text-white">
            <Play size={14} /> Run automation pass · {pendingEvents.length} fresh signal{pendingEvents.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {/* Open events */}
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
          <Zap size={16} className="text-amber-700" />
          <h3 className="font-display text-lg text-stone-900">Open · {openEvents.length}</h3>
        </div>
        {openEvents.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-500">No open events. Hit "Run automation pass" to evaluate against the current state.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-40">When</th>
                <th className="text-left px-4 py-2 font-medium w-24">Severity</th>
                <th className="text-left px-4 py-2 font-medium">Property</th>
                <th className="text-left px-4 py-2 font-medium">Event</th>
                <th className="text-right px-4 py-2 font-medium w-44">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {openEvents.map(e => {
                const s = SEV_STYLE[e.severity] || SEV_STYLE.medium;
                const property = (state.properties || []).find(p => p.id === e.propertyId);
                return (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className="px-4 py-1.5 text-stone-700 text-xs tabular">{fmtDateTime(e.createdAt)}</td>
                    <td className="px-4 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${s.chip}`}>{e.severity}</span>
                    </td>
                    <td className="px-4 py-1.5 text-stone-700 text-xs">{property?.name || e.propertyId}</td>
                    <td className="px-4 py-1.5 text-stone-900">{e.label}</td>
                    <td className="px-4 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => resolve(e.id, "resolved")} className="px-2 py-1 text-[10px] uppercase font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded inline-flex items-center gap-1">
                          <CheckCircle2 size={11} /> Resolve
                        </button>
                        <button onClick={() => resolve(e.id, "dismissed")} className="px-2 py-1 text-[10px] uppercase font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded inline-flex items-center gap-1">
                          <X size={11} /> Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Rule catalog */}
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
          <Info size={16} className="text-stone-500" />
          <h3 className="font-display text-lg text-stone-900">Rule catalog · {DEFAULT_RULES.length} active</h3>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            {listRules().map(r => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className="px-4 py-2 text-stone-900 font-medium w-72">{r.label}</td>
                <td className="px-4 py-2 text-stone-600 text-xs">{r.description}</td>
                <td className="px-4 py-2 text-right tabular text-xs text-stone-500 font-mono">{r.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent closed */}
      {recentClosed.length > 0 && (
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
            <h3 className="font-display text-lg text-stone-900">Recently closed · {recentClosed.length}</h3>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stone-100">
              {recentClosed.map(e => (
                <tr key={e.id} className="text-stone-600">
                  <td className="px-4 py-1.5 text-xs tabular w-40">{fmtDateTime(e.resolvedAt || e.createdAt)}</td>
                  <td className="px-4 py-1.5 text-xs">{e.label}</td>
                  <td className="px-4 py-1.5 text-right text-[10px] uppercase font-bold tracking-wider">
                    {e.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
