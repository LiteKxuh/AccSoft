import { useMemo, useState } from "react";
import { Building2, TrendingUp, DollarSign, Activity, AlertTriangle, ShieldCheck } from "lucide-react";
import { buildCommandCenter, rankProperties } from "./executive.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }

const HEALTH_BAND = {
  strong:  { color: "text-emerald-700", bg: "bg-emerald-50" },
  healthy: { color: "text-sky-700",     bg: "bg-sky-50" },
  watch:   { color: "text-amber-700",   bg: "bg-amber-50" },
  "at-risk": { color: "text-rose-700",  bg: "bg-rose-50" },
};

export function CommandCenterPane({ ctx, enrichReport }) {
  const { state, accessibleProperties } = ctx;
  const asOf = new Date().toISOString().slice(0, 10);
  const [criterion, setCriterion] = useState("revenue");
  const propertyIds = accessibleProperties.map(p => p.id);

  const cc = useMemo(
    () => buildCommandCenter(state, { propertyIds, asOf, enrichReport }),
    [state, propertyIds.join(","), asOf, enrichReport]
  );

  const ranked = useMemo(() => {
    const snaps = cc.properties.map(p => p.snapshot);
    return rankProperties(snaps, criterion);
  }, [cc, criterion]);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Portfolio Command Center</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wider">Exec</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{cc.properties.length} properties · {asOf}</h2>
          <p className="text-sm text-stone-500 mt-1">Live portfolio snapshot · ranking, asset health, and risk surface.</p>
        </div>
        <div>
          <select value={criterion} onChange={e => setCriterion(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            <option value="revenue">Rank by revenue (MTD)</option>
            <option value="occupancy">Rank by occupancy</option>
            <option value="adr">Rank by ADR</option>
            <option value="revpar">Rank by RevPAR</option>
            <option value="labor">Rank by labor discipline</option>
            <option value="risk">Rank by risk (fewest flags)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tile icon={DollarSign} label="Portfolio MTD Revenue" value={fmtMoney(cc.portfolio.revenue)} />
        <Tile icon={Building2} label="Portfolio Occupancy" value={fmtPct(cc.portfolio.occupancy)} />
        <Tile icon={TrendingUp} label="GOP Margin (MTD)" value={fmtPct(cc.portfolio.gopPct)} sub={fmtMoney(cc.portfolio.gop)} />
        <Tile icon={Activity} label="Avg Asset Health" value={`${cc.portfolio.avgHealth.toFixed(0)}/100`} sub={`${cc.portfolio.highRiskFlags} high-severity risk(s)`} highlight={cc.portfolio.highRiskFlags > 0} />
      </div>

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
          <h3 className="font-display text-lg text-stone-900">Property leaderboard</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-12">Rank</th>
              <th className="text-left px-4 py-2 font-medium">Property</th>
              <th className="text-right px-4 py-2 font-medium">MTD Revenue</th>
              <th className="text-right px-4 py-2 font-medium">Occupancy</th>
              <th className="text-right px-4 py-2 font-medium">ADR</th>
              <th className="text-right px-4 py-2 font-medium">Labor %</th>
              <th className="text-right px-4 py-2 font-medium w-32">Asset Health</th>
              <th className="text-right px-4 py-2 font-medium w-24">Risks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {ranked.map((row, i) => {
              const property = cc.properties.find(p => p.propertyId === row.propertyId);
              const band = HEALTH_BAND[property?.health?.band] || HEALTH_BAND.healthy;
              return (
                <tr key={row.propertyId} className="hover:bg-stone-50">
                  <td className="px-4 py-1.5 text-stone-500 text-xs font-bold">#{row.rank}</td>
                  <td className="px-4 py-1.5 text-stone-900 font-medium">{property?.propertyName || row.propertyId}</td>
                  <td className="px-4 py-1.5 text-right tabular">{fmtMoney(row.snapshot.mtd?.revenue || 0)}</td>
                  <td className="px-4 py-1.5 text-right tabular">{fmtPct(row.snapshot.mtd?.occupancy || 0)}</td>
                  <td className="px-4 py-1.5 text-right tabular">{fmtMoney(row.snapshot.mtd?.adr || 0)}</td>
                  <td className="px-4 py-1.5 text-right tabular">{fmtPct(row.snapshot.labor?.mtdPctRev || 0)}</td>
                  <td className="px-4 py-1.5 text-right">
                    {property?.health ? (
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold ${band.color} ${band.bg}`}>
                        {property.health.score}/100 · {property.health.band}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    {row.snapshot.riskFlags?.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-rose-700 font-semibold tabular text-xs">
                        <AlertTriangle size={11} /> {row.snapshot.riskFlags.length}
                      </span>
                    ) : (
                      <ShieldCheck size={14} className="text-emerald-600 inline-block" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, highlight }) {
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
