import { useMemo, useState } from "react";
import { Users, Activity, AlertTriangle, Clock } from "lucide-react";
import { occupancyDrivenStaffing, overtimePredictor, scheduleSimulation, roomsPerAttendant } from "./laborOptimization.js";
import { buildPace } from "./paceReport.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }

function classifyTier(adr) {
  if (adr >= 250) return "luxury";
  if (adr >= 170) return "upper-upscale";
  if (adr >= 110) return "upscale";
  if (adr >= 70)  return "midscale";
  return "economy";
}

export function LaborOptimizationPane({ ctx, enrichReport }) {
  const { state, accessibleProperties, activeProperty } = ctx;
  const asOf = new Date().toISOString().slice(0, 10);
  const [propertyId, setPropertyId] = useState(activeProperty || accessibleProperties[0]?.id);

  const enrich = enrichReport || ((r) => r);
  const property = (state.properties || []).find(p => p.id === propertyId);
  const capacity = property?.rooms || 100;
  const reports = useMemo(
    () => (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich).sort((a, b) => a.date.localeCompare(b.date)),
    [state.reports, propertyId, enrich]
  );

  const tier = useMemo(() => {
    const recent = reports.slice(-30).map(r => Number(r.adr) || 0).filter(v => v > 0).sort((a, b) => a - b);
    const med = recent.length ? recent[Math.floor(recent.length / 2)] : 0;
    return classifyTier(med);
  }, [reports]);

  // Forward 14-day staffing recommendations from pace forecast
  const pace = useMemo(() => buildPace({ reports, asOf, options: { horizon: 14 } }), [reports, asOf]);
  const forwardStaffing = useMemo(() => {
    if (pace.status !== "ok") return [];
    return pace.forward.map(p => ({
      date: p.date,
      occupancy: p.projectedOccupancy,
      ...occupancyDrivenStaffing({ forecastOcc: p.projectedOccupancy, capacity, tier }),
    }));
  }, [pace, capacity, tier]);

  // OT predictor for current week
  const otPredictions = useMemo(() => {
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    const propShifts = (state.shifts || []).filter(s => !s.propertyId || s.propertyId === propertyId);
    return overtimePredictor({
      shifts: propShifts,
      employees: state.employees || [],
      weekStart: monday.toISOString().slice(0, 10),
      weekEnd: sunday.toISOString().slice(0, 10),
    });
  }, [state.shifts, state.employees, propertyId]);

  // MTD rooms-per-attendant
  const mtdProductivity = useMemo(() => {
    const monthStart = `${asOf.slice(0, 7)}-01`;
    const mtdReports = reports.filter(r => r.date >= monthStart && r.date <= asOf);
    const mtdRoomsSold = mtdReports.reduce((s, r) => s + (Number(r.roomsSold) || 0), 0);
    const propShifts = (state.shifts || []).filter(s => !s.propertyId || s.propertyId === propertyId);
    const empMap = new Map((state.employees || []).map(e => [e.id, e]));
    const hkHours = propShifts.filter(s => {
      const e = empMap.get(s.employeeId);
      const t = String(e?.title || "").toLowerCase();
      return t.includes("housekeep") || t.includes("room attendant");
    }).reduce((s, sh) => {
      const start = new Date(sh.clockIn), end = sh.clockOut ? new Date(sh.clockOut) : null;
      if (!end) return s;
      return s + Math.max(0, (end - start) / 3600_000 - (Number(sh.breakMinutes) || 0) / 60);
    }, 0);
    if (hkHours <= 0) return { status: "no-data" };
    return roomsPerAttendant({ housekeepingHours: hkHours, roomsCleaned: mtdRoomsSold, tier });
  }, [state.shifts, state.employees, reports, propertyId, asOf, tier]);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Labor Optimization</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wider">HR</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name || "Property"} · {tier}</h2>
        </div>
        <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
          {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* MTD productivity */}
      {mtdProductivity.status === "ok" && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3 flex items-center gap-2">
            <Activity size={13} /> MTD productivity
          </div>
          <div className="text-2xl font-display font-semibold text-stone-900 tabular">{mtdProductivity.headline}</div>
          <div className={`text-xs uppercase tracking-wider font-bold mt-1 ${mtdProductivity.verdict === "above-target" ? "text-emerald-700" : mtdProductivity.verdict === "near-target" ? "text-amber-700" : "text-rose-700"}`}>{mtdProductivity.verdict}</div>
        </div>
      )}

      {/* Forward staffing recommendations */}
      {forwardStaffing.length > 0 && (
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
            <Users size={16} className="text-amber-700" />
            <h3 className="font-display text-lg text-stone-900">Forward staffing — housekeeping</h3>
            <span className="text-xs text-stone-500">Productivity target {forwardStaffing[0]?.productivityTarget} rooms/attendant</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-right px-4 py-2 font-medium">Forecast Occ</th>
                <th className="text-right px-4 py-2 font-medium">Rooms to Clean</th>
                <th className="text-right px-4 py-2 font-medium">Headcount</th>
                <th className="text-right px-4 py-2 font-medium">Total Hours</th>
                <th className="text-left px-4 py-2 font-medium">Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {forwardStaffing.map(line => (
                <tr key={line.date} className="hover:bg-stone-50">
                  <td className="px-4 py-1.5 tabular">{line.date}</td>
                  <td className="px-4 py-1.5 text-right tabular">{fmtPct(line.occupancy)}</td>
                  <td className="px-4 py-1.5 text-right tabular">{line.roomsToClean}</td>
                  <td className="px-4 py-1.5 text-right tabular font-semibold">{line.headcount}</td>
                  <td className="px-4 py-1.5 text-right tabular">{line.totalHours}h</td>
                  <td className="px-4 py-1.5 text-stone-600 text-xs">{line.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* OT predictions */}
      {otPredictions.length > 0 && (
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
            <Clock size={16} className="text-amber-700" />
            <h3 className="font-display text-lg text-stone-900">Overtime predictor · this week</h3>
            <span className="text-xs text-stone-500">{otPredictions.filter(p => p.overTimeRisk === "yes").length} at risk · {otPredictions.filter(p => p.overTimeRisk === "borderline").length} borderline</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Employee</th>
                <th className="text-right px-4 py-2 font-medium">Hours to Date</th>
                <th className="text-right px-4 py-2 font-medium">Projected Hours</th>
                <th className="text-right px-4 py-2 font-medium">OT Projection</th>
                <th className="text-right px-4 py-2 font-medium w-32">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {otPredictions.map(p => {
                const riskStyle = p.overTimeRisk === "yes" ? "bg-rose-100 text-rose-700" : p.overTimeRisk === "borderline" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
                return (
                  <tr key={p.employeeId} className="hover:bg-stone-50">
                    <td className="px-4 py-1.5 text-stone-900">{p.employeeName}</td>
                    <td className="px-4 py-1.5 text-right tabular">{p.hoursToDate.toFixed(1)}h</td>
                    <td className="px-4 py-1.5 text-right tabular">{p.projectedHours.toFixed(1)}h</td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold">{p.otHoursProjected > 0 ? `+${p.otHoursProjected.toFixed(1)}h` : "—"}</td>
                    <td className="px-4 py-1.5 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${riskStyle}`}>{p.overTimeRisk}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
