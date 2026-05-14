import { useMemo, useState } from "react";
import { TrendingUp, DollarSign, Activity, AlertCircle } from "lucide-react";
import { priceRecommendation, compressionScore, losRecommendation, overbookingModel } from "./revenueEngine.js";
import { buildPace } from "./paceReport.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }

export function RevenueEnginePane({ ctx, enrichReport }) {
  const { state, accessibleProperties, activeProperty } = ctx;
  const asOf = new Date().toISOString().slice(0, 10);
  const [propertyId, setPropertyId] = useState(activeProperty || accessibleProperties[0]?.id);
  const [horizon, setHorizon] = useState(14);

  const enrich = enrichReport || ((r) => r);
  const history = useMemo(
    () => (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich).sort((a, b) => a.date.localeCompare(b.date)),
    [state.reports, propertyId, enrich]
  );

  const futureDates = useMemo(() => {
    return Array.from({ length: horizon }, (_, i) => {
      const d = new Date(asOf); d.setDate(d.getDate() + i + 1);
      return d.toISOString().slice(0, 10);
    });
  }, [asOf, horizon]);

  const pace = useMemo(
    () => buildPace({ reports: history, asOf, options: { horizon } }),
    [history, asOf, horizon]
  );

  const recs = useMemo(
    () => priceRecommendation({ history, dates: futureDates, paceForecast: pace.status === "ok" ? pace.forward : [] }),
    [history, futureDates, pace]
  );

  const compressionByDate = useMemo(() => {
    const map = {};
    for (const d of futureDates) {
      map[d] = compressionScore({ stayDate: d, history });
    }
    return map;
  }, [history, futureDates]);

  const losRecs = useMemo(() => losRecommendation({ compressionByDate, threshold: 0.85 }), [compressionByDate]);

  const property = (state.properties || []).find(p => p.id === propertyId);
  const capacity = property?.rooms || 100;
  const overbooking = useMemo(() => overbookingModel({ history, capacity }), [history, capacity]);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Revenue Engine 2.0</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wider">RM</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name || "Property"} · Forward {horizon} days</h2>
          {recs.status === "ok" && (
            <p className="text-sm text-stone-500 mt-1">
              Tier <strong className="text-stone-700">{recs.tier}</strong> · Median 30-day ADR {fmtMoney(recs.medianAdr)} · Lift cap {fmtPct(recs.tierLiftCap.up)} up / {fmtPct(recs.tierLiftCap.down)} down
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={horizon} onChange={e => setHorizon(Number(e.target.value))} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            <option value={7}>Next 7 days</option>
            <option value={14}>Next 14 days</option>
            <option value={30}>Next 30 days</option>
          </select>
        </div>
      </div>

      {recs.status === "insufficient-history" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-700" />
          <div className="text-sm text-amber-900">{recs.message}</div>
        </div>
      ) : (
        <>
          {/* Pricing recommendations */}
          <div className="rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
              <DollarSign size={16} className="text-amber-700" />
              <h3 className="font-display text-lg text-stone-900">Pricing recommendations</h3>
              <span className="text-xs text-stone-500">Clamped to tier realism — {fmtPct(recs.tierLiftCap.up)} max lift, {fmtPct(recs.tierLiftCap.down)} max discount</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-right px-4 py-2 font-medium">Compression</th>
                  <th className="text-right px-4 py-2 font-medium">Recommended BAR</th>
                  <th className="text-right px-4 py-2 font-medium">Lift</th>
                  <th className="text-left px-4 py-2 font-medium">Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {recs.lines.map(line => {
                  const lift = line.liftPct;
                  const liftStyle = lift > 0.05 ? "text-emerald-700" : lift < -0.05 ? "text-rose-700" : "text-stone-700";
                  return (
                    <tr key={line.date} className="hover:bg-stone-50">
                      <td className="px-4 py-1.5 tabular">{line.date}</td>
                      <td className="px-4 py-1.5 text-right tabular">{line.compressionScore != null ? fmtPct(line.compressionScore, 0) : "—"}</td>
                      <td className="px-4 py-1.5 text-right tabular font-semibold">{fmtMoney(line.recommendedBar)}</td>
                      <td className={`px-4 py-1.5 text-right tabular font-semibold ${liftStyle}`}>{lift >= 0 ? "+" : ""}{(lift * 100).toFixed(1)}%</td>
                      <td className="px-4 py-1.5 text-stone-600 text-xs">{line.rationale}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* LOS controls */}
          {losRecs.some(r => r.action === "set-min-los") && (
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
                <h3 className="font-display text-lg text-stone-900">Length-of-stay controls</h3>
                <p className="text-xs text-stone-500 mt-0.5">Compressed nights where you should require multi-night bookings.</p>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-stone-100">
                  {losRecs.filter(r => r.action === "set-min-los").map(r => (
                    <tr key={r.date} className="hover:bg-stone-50">
                      <td className="px-4 py-1.5 tabular w-32">{r.date}</td>
                      <td className="px-4 py-1.5 font-semibold text-amber-700">MLOS {r.minLOS}+</td>
                      <td className="px-4 py-1.5 text-stone-600 text-xs">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Overbooking */}
          {overbooking.status === "ok" && (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3 flex items-center gap-2">
                <Activity size={13} /> Overbooking model
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Recommended cushion %" value={fmtPct(overbooking.recommendedCushionPct)} />
                <Stat label="Recommended rooms" value={overbooking.recommendedRooms ?? "—"} />
                <Stat label="Median walk rate" value={fmtPct(overbooking.medianNoShowWalk)} />
                <Stat label="Historical over-sold rate" value={fmtPct(overbooking.overBookRate)} />
              </div>
              <p className="text-xs text-stone-600 mt-3">{overbooking.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded border border-stone-200 p-3">
      <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{label}</div>
      <div className="font-display text-lg text-stone-900 font-semibold tabular mt-1">{value}</div>
    </div>
  );
}
