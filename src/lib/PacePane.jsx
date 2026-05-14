import { useMemo, useState } from "react";
import { TrendingUp, Calendar, AlertCircle, Activity } from "lucide-react";
import { buildPace } from "./paceReport.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }
function fmtShort(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return fmtMoney(v);
}

function dowName(d) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] || "";
}

export function PacePane({ ctx, enrichReport }) {
  const { state, accessibleProperties, activeProperty } = ctx;
  const [propId, setPropId] = useState(activeProperty || accessibleProperties[0]?.id);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  const enriched = useMemo(() => {
    return (state.reports || [])
      .filter(r => r.propertyId === propId)
      .map(r => typeof enrichReport === "function" ? enrichReport(r) : r);
  }, [state.reports, propId, enrichReport]);

  const priorYear = useMemo(() => {
    const py = String(Number(asOf.slice(0, 4)) - 1);
    return enriched.filter(r => r.date.startsWith(py));
  }, [enriched, asOf]);

  const pace = useMemo(
    () => buildPace({ reports: enriched, asOf, priorYear, options: { horizon: 14 } }),
    [enriched, asOf, priorYear]
  );

  const property = (state.properties || []).find(p => p.id === propId);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Revenue Pace · Forward 14 days</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name || "Property"} · As of {asOf}</h2>
          {pace.market && pace.market.tier && (
            <p className="text-sm text-stone-500 mt-1">
              Market tier: <strong className="text-stone-700">{pace.market.tier}</strong> · Occupancy cap {fmtPct(pace.market.occCap)} · Realistic wash cap {fmtPct(pace.market.washCap)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {accessibleProperties.length > 1 && (
            <select value={propId} onChange={e => setPropId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
              {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white tabular" />
        </div>
      </div>

      {pace.status === "insufficient-history" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-700" />
          <div className="text-sm text-amber-900">
            Need at least 14 days of history to compute pace. {pace.reasonsRequired} more day{pace.reasonsRequired === 1 ? "" : "s"} required.
          </div>
        </div>
      )}

      {pace.status === "ok" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <KpiTile icon={Calendar} label="MTD revenue" value={fmtShort(pace.mtd.revenue)} sub={`${pace.mtd.daysElapsed} of ${pace.mtd.daysInMonth} days`} />
            <KpiTile icon={TrendingUp} label="MTD occupancy" value={fmtPct(pace.mtd.occupancy)} sub={`${pace.mtd.roomsSold.toFixed(0)} rooms sold`} />
            <KpiTile icon={Activity} label="Pickup (last 7d)" value={`${pace.pickup.rooms.toFixed(0)} rooms`} sub={`since ${pace.pickup.sinceDate}`} />
            <KpiTile icon={TrendingUp} label="14-day projection" value={fmtShort(pace.projection.d14)}
              sub={pace.priorYear ? `${(pace.priorYear.revGrowth * 100).toFixed(1)}% vs PY MTD` : "no prior year"} />
          </div>

          <div className="rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
              <h3 className="font-display text-lg text-stone-900">Forward 14 days</h3>
              <p className="text-xs text-stone-500 mt-0.5">Realism-clamped to market occupancy ceiling. Confidence reflects depth of same-DoW history.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">DoW</th>
                  <th className="text-right px-4 py-2 font-medium">Proj. Occ</th>
                  <th className="text-right px-4 py-2 font-medium">Proj. ADR</th>
                  <th className="text-right px-4 py-2 font-medium">Proj. Revenue</th>
                  <th className="text-right px-4 py-2 font-medium">OTB</th>
                  <th className="text-right px-4 py-2 font-medium w-24">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {pace.forward.map((p) => (
                  <tr key={p.date} className="hover:bg-stone-50">
                    <td className="px-4 py-1.5 tabular">{p.date}</td>
                    <td className="px-4 py-1.5 text-stone-600">{dowName(p.dow)}</td>
                    <td className="px-4 py-1.5 text-right tabular">{fmtPct(p.projectedOccupancy)}</td>
                    <td className="px-4 py-1.5 text-right tabular">{fmtMoney(p.projectedAdr)}</td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold">{fmtShort(p.projectedRevenue)}</td>
                    <td className="px-4 py-1.5 text-right tabular text-stone-500">
                      {p.onTheBooks != null ? `${p.onTheBooks} ${p.otbAdjusted != null ? `→ ${Math.round(p.otbAdjusted)}` : ""}` : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${p.confidence >= 0.8 ? "bg-emerald-100 text-emerald-700" : p.confidence >= 0.6 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-600"}`}>
                        {fmtPct(p.confidence, 0)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pace.washFactor != null && (
            <div className="text-xs text-stone-500">
              <strong className="text-stone-700">Observed wash factor:</strong> {(pace.washFactor * 100).toFixed(1)}% — fraction of on-the-books rooms that did not materialize, clamped to this market tier's realistic cap.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiTile({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
        <Icon size={13} /> {label}
      </div>
      <div className="font-display number-display text-2xl text-stone-900 font-semibold tabular">{value}</div>
      <div className="text-xs text-stone-500 mt-1">{sub}</div>
    </div>
  );
}
