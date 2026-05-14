import { useMemo } from "react";
import { Activity, Building2, AlertTriangle, ShieldCheck, TrendingUp, Users, DollarSign, ClipboardList } from "lucide-react";
import { snapshot, overnightDelta } from "./hotelState.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtMoneyP(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtPct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }
function fmtPts(n) { return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pts` : "—"; }
function fmtDelta(n, formatter = fmtMoney) { return `${n >= 0 ? "+" : ""}${formatter(n)}`; }

export function StatePane({ ctx, enrichReport }) {
  const { state, accessibleProperties, activeProperty } = ctx;
  const asOf = new Date().toISOString().slice(0, 10);
  const propertyId = activeProperty || accessibleProperties[0]?.id;
  const snap = useMemo(() => snapshot(state, { propertyId, asOf, enrichReport }), [state, propertyId, asOf, enrichReport]);
  const overnight = useMemo(() => overnightDelta(state, { propertyId, asOf, enrichReport }), [state, propertyId, asOf, enrichReport]);

  if (snap.status !== "ok") {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
          <Activity size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-lg text-stone-900">Digital twin not available</h3>
          <p className="text-sm text-stone-500 mt-1">No reports for the selected property.</p>
        </div>
      </div>
    );
  }

  const property = (state.properties || []).find(p => p.id === snap.propertyId);

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Live Hotel State</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wider">Digital Twin</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name || "Property"} · {snap.asOf}</h2>
          <p className="text-sm text-stone-500 mt-1">
            Tier <strong className="text-stone-700">{snap.tier}</strong> · {snap.coverage.hasReportToday ? "Report posted today" : "No report posted yet today"} · {snap.coverage.hasBudget ? "Budget loaded" : "No budget for this month"}
          </p>
        </div>
      </div>

      {/* Risk flags at the top — most important signal */}
      {snap.riskFlags.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-700 font-bold mb-3">
            <AlertTriangle size={14} /> Active risk flags · {snap.riskFlags.length}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {snap.riskFlags.map((f, i) => {
              const sevColor = f.severity === "high" ? "border-rose-300 bg-rose-50/60" : f.severity === "medium" ? "border-amber-300 bg-amber-50/40" : "border-sky-300 bg-sky-50/40";
              return (
                <div key={i} className={`rounded border ${sevColor} px-3 py-2 text-sm`}>
                  <div className="font-medium text-stone-900">{f.label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold mt-0.5">{f.severity} · {f.code}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 flex items-center gap-3">
          <ShieldCheck size={20} className="text-emerald-700" />
          <div>
            <div className="font-semibold text-stone-900">Operations clean</div>
            <div className="text-xs text-stone-600 mt-0.5">No active risk flags. Audit healthy. Approvals current.</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tile icon={DollarSign} label="MTD Revenue" value={fmtMoney(snap.mtd.revenue)} sub={`${snap.mtd.roomsSold} room nights`} />
        <Tile icon={Building2} label="MTD Occupancy" value={fmtPct(snap.mtd.occupancy)} sub={`ADR ${fmtMoney(snap.mtd.adr)}`} />
        <Tile icon={Users} label="Labor % of Rev" value={fmtPct(snap.labor.mtdPctRev)} sub={`${fmtMoney(snap.labor.mtdCost)} MTD`} />
        <Tile icon={ShieldCheck} label="Audit Score" value={snap.audit ? `${snap.audit.score}/100` : "—"} sub={snap.audit?.status || ""} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today vs Yesterday */}
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3 flex items-center gap-2">
            <TrendingUp size={13} /> Overnight delta
          </div>
          {overnight.status === "ok" ? (
            <div className="space-y-2 text-sm">
              <RowDelta label="Revenue" value={overnight.delta.revenue} formatter={fmtMoneyP} />
              <RowDelta label="Occupancy" value={overnight.delta.occupancy} formatter={fmtPts} compare="pts" />
              <RowDelta label="ADR" value={overnight.delta.adr} formatter={fmtMoneyP} />
              <RowDelta label="Audit score" value={overnight.delta.auditScore} formatter={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(0)} pts`} />
              {overnight.delta.newRiskFlags.length > 0 && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <div className="text-xs uppercase tracking-wider text-rose-700 font-bold mb-1">New since yesterday</div>
                  {overnight.delta.newRiskFlags.map((f, i) => (
                    <div key={i} className="text-xs text-stone-700">→ {f.label}</div>
                  ))}
                </div>
              )}
              {overnight.delta.resolvedRiskFlags.length > 0 && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <div className="text-xs uppercase tracking-wider text-emerald-700 font-bold mb-1">Resolved overnight</div>
                  {overnight.delta.resolvedRiskFlags.map((f, i) => (
                    <div key={i} className="text-xs text-stone-700">✓ {f.label}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-stone-500">Insufficient history for overnight diff.</div>
          )}
        </div>

        {/* Approvals + ledger */}
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3 flex items-center gap-2">
            <ClipboardList size={13} /> Approvals & ledger
          </div>
          <div className="space-y-2 text-sm">
            <KvRow label="Pending JE approvals" value={`${snap.approvals.pendingJE}`} />
            <KvRow label="Pending AP approvals" value={`${snap.approvals.pendingAP}`} />
            <KvRow label="Total dollars pending" value={fmtMoneyP(snap.approvals.pendingDollar)} />
            <div className="border-t border-stone-100 mt-2 pt-2 space-y-2">
              <KvRow label="A/P open" value={fmtMoneyP(snap.ledger.ap.total)} />
              <KvRow label="A/P over 120d" value={fmtMoneyP(snap.ledger.apOver120)} highlight={snap.ledger.apOver120 > 0} />
              <KvRow label="A/R open" value={fmtMoneyP(snap.ledger.ar.total)} />
              <KvRow label="Cash position" value={fmtMoneyP(snap.ledger.cashCovered)} />
            </div>
          </div>
        </div>
      </div>

      {snap.pace && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3 flex items-center gap-2">
            <TrendingUp size={13} /> Forward pace
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <KvRow label="7-day projection" value={fmtMoney(snap.pace.projection7)} />
            <KvRow label="14-day projection" value={fmtMoney(snap.pace.projection14)} />
            <KvRow label="Pickup (last 7d)" value={`${snap.pace.pickupRooms.toFixed(0)} rooms`} />
            <KvRow label="Wash factor" value={snap.pace.washFactor != null ? fmtPct(snap.pace.washFactor) : "—"} />
          </div>
          {snap.compression && (
            <div className="mt-3 text-xs text-amber-700 font-medium">⚠ Compression detected on the forward 7 days — review rate ceilings and overbooking controls.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
        <Icon size={13} /> {label}
      </div>
      <div className="font-display number-display text-2xl text-stone-900 font-semibold tabular">{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  );
}

function RowDelta({ label, value, formatter, compare }) {
  const color = value > 0 ? "text-emerald-700" : value < 0 ? "text-rose-700" : "text-stone-500";
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-600">{label}</span>
      <span className={`tabular font-semibold ${color}`}>{formatter(value)}</span>
    </div>
  );
}

function KvRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-600">{label}</span>
      <span className={`tabular font-semibold ${highlight ? "text-rose-700" : "text-stone-900"}`}>{value}</span>
    </div>
  );
}
