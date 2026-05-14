import { useMemo, useState } from "react";
import { ShieldAlert, Eye, ChevronDown, ChevronRight, Activity } from "lucide-react";
import { runForensics } from "./forensics.js";

const SEV_STYLE = {
  high:   { chip: "bg-rose-100 text-rose-700",     dot: "bg-rose-500" },
  medium: { chip: "bg-amber-100 text-amber-700",   dot: "bg-amber-500" },
  low:    { chip: "bg-sky-100 text-sky-700",       dot: "bg-sky-500" },
  info:   { chip: "bg-stone-100 text-stone-600",   dot: "bg-stone-400" },
};

const BAND_STYLE = {
  clean:    { color: "text-emerald-700", bg: "bg-emerald-50/60", ring: "ring-emerald-200" },
  low:      { color: "text-sky-700",     bg: "bg-sky-50/60",     ring: "ring-sky-200" },
  elevated: { color: "text-amber-700",   bg: "bg-amber-50/60",   ring: "ring-amber-200" },
  high:     { color: "text-rose-700",    bg: "bg-rose-50/60",    ring: "ring-rose-200" },
  critical: { color: "text-rose-900",    bg: "bg-rose-100/80",   ring: "ring-rose-300" },
};

export function ForensicsRiskPane({ ctx, can }) {
  const { state } = ctx;
  const [filterSev, setFilterSev] = useState("");
  const [filterCode, setFilterCode] = useState("");
  const [expanded, setExpanded] = useState(new Set());

  const allowed = !can || can("je.view-chain");
  const result = useMemo(() => allowed ? runForensics(state) : null, [state, allowed]);

  if (!allowed) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
          <ShieldAlert size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-lg text-stone-900">Restricted</h3>
          <p className="text-sm text-stone-500 mt-1">Forensics is restricted to senior finance roles.</p>
        </div>
      </div>
    );
  }

  const findings = useMemo(() => {
    let f = result?.findings || [];
    if (filterSev) f = f.filter(x => x.severity === filterSev);
    if (filterCode) f = f.filter(x => x.code === filterCode);
    return f;
  }, [result, filterSev, filterCode]);

  const codes = Array.from(new Set((result?.findings || []).map(f => f.code)));
  const band = BAND_STYLE[result?.riskBand] || BAND_STYLE.low;

  const toggle = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Financial Forensics</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 uppercase tracking-wider">Risk</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">Controller risk dashboard</h2>
          <p className="text-sm text-stone-500 mt-1">Duplicate detection, refund outliers, approval bypass, payroll anomalies, ghost revenue, and vendor onboarding diligence.</p>
        </div>
      </div>

      {/* Risk banner */}
      <div className={`rounded-xl border ring-1 ${band.ring} ${band.bg} p-5 flex items-center gap-4`}>
        <Activity size={22} className={band.color} />
        <div className="flex-1 min-w-0">
          <div className={`font-semibold ${band.color}`}>Risk band: {result?.riskBand} · score {result?.riskScore}</div>
          <div className="text-xs text-stone-600 mt-0.5">{result?.findings.length} finding{(result?.findings.length || 0) === 1 ? "" : "s"} across {Object.keys(result?.counts || {}).length} detector{Object.keys(result?.counts || {}).length === 1 ? "" : "s"}.</div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-stone-200 bg-white p-3 flex flex-wrap gap-2 items-center text-xs">
        <span className="text-stone-500 uppercase tracking-wider font-semibold">Filter</span>
        <select value={filterSev} onChange={e => setFilterSev(e.target.value)} className="px-2 py-1 border border-stone-300 rounded bg-white text-xs">
          <option value="">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={filterCode} onChange={e => setFilterCode(e.target.value)} className="px-2 py-1 border border-stone-300 rounded bg-white text-xs">
          <option value="">All detectors</option>
          {codes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Findings list */}
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        {findings.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ShieldAlert size={28} className="mx-auto text-emerald-400 mb-3" />
            <h3 className="font-display text-lg text-stone-900">Clean — no findings</h3>
            <p className="text-sm text-stone-500 mt-1">All detectors returned green.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-8"></th>
                <th className="text-left px-4 py-2 font-medium w-24">Severity</th>
                <th className="text-left px-4 py-2 font-medium w-44">Detector</th>
                <th className="text-left px-4 py-2 font-medium">Finding</th>
                <th className="text-right px-4 py-2 font-medium w-24">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {findings.map(f => {
                const s = SEV_STYLE[f.severity] || SEV_STYLE.info;
                const open = expanded.has(f.id);
                return (
                  <>
                    <tr key={f.id} className="hover:bg-stone-50">
                      <td className="px-4 py-1.5">
                        <button onClick={() => toggle(f.id)} className="text-stone-400 hover:text-stone-700">
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-4 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${s.chip}`}>{f.severity}</span>
                      </td>
                      <td className="px-4 py-1.5 text-stone-600 text-xs font-mono">{f.code}</td>
                      <td className="px-4 py-1.5 text-stone-900">{f.label}</td>
                      <td className="px-4 py-1.5 text-right tabular text-stone-700 font-semibold">{Math.round(f.confidence * 100)}%</td>
                    </tr>
                    {open && (
                      <tr key={`${f.id}-detail`}>
                        <td colSpan={5} className="px-12 py-3 bg-stone-50/60 text-xs text-stone-700">
                          <div className="mb-2">{f.detail}</div>
                          <pre className="font-mono text-[10px] text-stone-500 whitespace-pre-wrap">{JSON.stringify(f.evidence, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
