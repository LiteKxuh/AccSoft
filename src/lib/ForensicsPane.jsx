import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, AlertCircle, Activity, Hash, Clock } from "lucide-react";
import { verifyLedger, sessionTimeline, chainHealth } from "./ledgerForensics.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtDateTime(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

export function ForensicsPane({ ctx, can }) {
  const { state, accessibleProperties, activeProperty } = ctx;
  const [verification, setVerification] = useState(null);
  const [busy, setBusy] = useState(false);
  const [propertyId, setPropertyId] = useState(activeProperty || "");

  const health = useMemo(() => chainHealth(state), [state.journalEntries, state.postingSessions]);
  const sessions = useMemo(
    () => sessionTimeline(state, { propertyId: propertyId || null }),
    [state.postingSessions, state.journalEntries, propertyId]
  );

  const allowed = !can || can("je.view-chain");

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    verifyLedger(state).then(r => { if (!cancelled) setVerification(r); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [state.journalEntries]);

  if (!allowed) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
          <Hash size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-lg text-stone-900">Restricted</h3>
          <p className="text-sm text-stone-500 mt-1">Your role does not include ledger forensics access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Ledger Forensics</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">Tamper-evidence + lineage</h2>
          <p className="text-sm text-stone-500 mt-1">Every posted journal entry is hash-chained. Re-verify on demand; the system will surface the offending entry if anything was altered after posting.</p>
        </div>
        <div className="flex items-center gap-2">
          {accessibleProperties.length > 1 && (
            <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
              <option value="">All properties</option>
              {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Verification banner */}
      {busy ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600">Walking the chain…</div>
      ) : verification?.ok ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 flex items-center gap-4">
          <ShieldCheck size={22} className="text-emerald-700" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-stone-900">Chain verified · {verification.length} posted entries</div>
            <div className="text-xs text-stone-600 mt-0.5">No tamper evidence detected. Every hash matches its predecessor.</div>
          </div>
          <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 bg-white/70 px-2 py-1 rounded">Clean</span>
        </div>
      ) : verification ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 flex items-center gap-4">
          <AlertCircle size={22} className="text-rose-700" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-rose-900">Chain broken at position {verification.brokenAt}</div>
            <div className="text-xs text-rose-700 mt-0.5">{verification.reason}</div>
            {verification.entry && (
              <div className="text-xs text-stone-700 mt-1">
                Entry <span className="font-mono">{verification.entry.id}</span> · {verification.entry.date} · {verification.entry.description}
              </div>
            )}
          </div>
          <span className="text-[10px] uppercase tracking-wider font-bold text-rose-700 bg-white px-2 py-1 rounded">Tampered</span>
        </div>
      ) : null}

      {/* Health stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatTile icon={Hash} label="Total entries" value={health.totalEntries} />
        <StatTile icon={ShieldCheck} label="Chained" value={health.chainedEntries} sub={`${Math.round((health.healthyPct || 0) * 100)}% covered`} />
        <StatTile icon={Activity} label="Sessions" value={health.sessionCount} />
        <StatTile icon={AlertCircle} label="Unchained posted" value={health.unchainedPosted} highlight={health.unchainedPosted > 0} />
      </div>

      {/* Session timeline */}
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
          <h3 className="font-display text-lg text-stone-900">Posting sessions · timeline</h3>
          <p className="text-xs text-stone-500 mt-0.5">Every batch of journal postings is grouped into a session for forensic recovery.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">When</th>
              <th className="text-left px-4 py-2 font-medium">Reason</th>
              <th className="text-left px-4 py-2 font-medium">User</th>
              <th className="text-right px-4 py-2 font-medium">Entries</th>
              <th className="text-right px-4 py-2 font-medium">Debits</th>
              <th className="text-right px-4 py-2 font-medium">Credits</th>
              <th className="text-left px-4 py-2 font-medium">Chain root</th>
              <th className="text-left px-4 py-2 font-medium w-20">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sessions.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-xs text-stone-400 px-4 py-6">No posting sessions yet. They appear once the v1.8 session-aware code paths post entries.</td></tr>
            ) : (
              sessions.slice(0, 100).map(s => (
                <tr key={s.id} className="hover:bg-stone-50">
                  <td className="px-4 py-1.5 tabular text-stone-700 text-xs">
                    <div className="flex items-center gap-1.5"><Clock size={10} className="text-stone-400" />{fmtDateTime(s.startedAt)}</div>
                  </td>
                  <td className="px-4 py-1.5 text-stone-700">
                    <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-stone-100 text-stone-600">{s.reason}</span>
                  </td>
                  <td className="px-4 py-1.5 text-stone-700 text-xs">{s.userName || s.user || "—"}</td>
                  <td className="px-4 py-1.5 text-right tabular">{s.entryCount}</td>
                  <td className="px-4 py-1.5 text-right tabular">{fmtMoney(s.totalDebit)}</td>
                  <td className="px-4 py-1.5 text-right tabular">{fmtMoney(s.totalCredit)}</td>
                  <td className="px-4 py-1.5 text-stone-500 text-xs font-mono">{s.chainRoot || "—"}</td>
                  <td className="px-4 py-1.5">
                    <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${s.status === "closed" ? "bg-emerald-100 text-emerald-700" : s.status === "reversed" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub, highlight }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-rose-200 bg-rose-50/40" : "border-stone-200 bg-white"}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
        <Icon size={13} /> {label}
      </div>
      <div className={`font-display number-display text-2xl text-stone-900 font-semibold tabular ${highlight ? "text-rose-700" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  );
}
