import { useMemo, useState } from "react";
import { FileText, TrendingUp, Receipt, DollarSign, Activity, BarChart3, Users, ChevronRight } from "lucide-react";
import { buildDepartmentPnl } from "./departmentPnl.js";
import { buildOwnerStatement } from "./ownerStatement.js";
import { buildManagementFeeReport } from "./managementFeeReport.js";
import { buildGopAnalysis } from "./gopAnalysis.js";
import { buildSegmentMix, detectShifts } from "./segmentMix.js";
import { pickupReport } from "./pickupReport.js";
import { gradeForecast } from "./forecastAccuracy.js";
import { buildForecastVariance } from "./flashReport.js";
import { apAging, arAging } from "./aging.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtMoney2(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtPct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }

const REPORTS = [
  { id: "deptpnl", label: "Department P&L", icon: Receipt, group: "Financials", desc: "USALI-aligned departmental rollup → GOP → NOI." },
  { id: "ownerstmt", label: "Owner Statement", icon: DollarSign, group: "Financials", desc: "Management fees, reserves, owner distributions per cap-table." },
  { id: "mgmtfee", label: "Management Fee Accrual", icon: DollarSign, group: "Financials", desc: "Base + incentive + reserve with draft JE." },
  { id: "gop", label: "GOP Analysis", icon: TrendingUp, group: "Financials", desc: "GOP variance vs budget, decomposed by revenue vs cost." },
  { id: "apaging", label: "A/P Aging", icon: Receipt, group: "AP / AR", desc: "Current / 30 / 60 / 90 / 120+ buckets by vendor." },
  { id: "araging", label: "A/R Aging", icon: Receipt, group: "AP / AR", desc: "Direct-bill / city-ledger aging by property." },
  { id: "pickup", label: "Pickup Report", icon: TrendingUp, group: "Revenue Management", desc: "Rooms gained/lost between snapshots." },
  { id: "segmix", label: "Segment Mix", icon: Activity, group: "Revenue Management", desc: "Revenue share by market segment over time." },
  { id: "fcacc", label: "Forecast Accuracy", icon: BarChart3, group: "Revenue Management", desc: "MAPE / MAE / MPE by horizon — historical accuracy curve." },
  { id: "fcvar", label: "Forecast Variance", icon: BarChart3, group: "Revenue Management", desc: "Actuals vs forecast bucketed (on-target / favorable / miss)." },
];

export function ReportsHub({ ctx, can }) {
  const { state, accessibleProperties, activeProperty } = ctx;
  const [selected, setSelected] = useState("deptpnl");
  const [propertyId, setPropertyId] = useState(activeProperty || accessibleProperties[0]?.id);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const property = (state.properties || []).find(p => p.id === propertyId);
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of REPORTS) {
      if (!map.has(r.group)) map.set(r.group, []);
      map.get(r.group).push(r);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 border-r border-stone-200 bg-stone-50 overflow-y-auto">
        <div className="px-4 py-4 border-b border-stone-200">
          <div className="text-xs uppercase tracking-[0.2em] text-amber-700 font-bold mb-1">Reports Hub</div>
          <div className="text-sm font-semibold text-stone-900">Institutional reporting</div>
        </div>
        {grouped.map(([group, items]) => (
          <div key={group} className="px-2 py-3">
            <div className="px-2 text-[10px] uppercase tracking-wider text-stone-500 font-bold mb-1">{group}</div>
            {items.map(r => {
              const active = selected === r.id;
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${active ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "text-stone-700 hover:bg-stone-100"}`}
                >
                  <Icon size={14} className={active ? "text-amber-700" : "text-stone-500"} />
                  <span className="flex-1 truncate">{r.label}</span>
                  {active && <ChevronRight size={14} className="text-amber-700" />}
                </button>
              );
            })}
          </div>
        ))}
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 border-b border-stone-200 bg-white sticky top-0 z-10">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-amber-700 font-bold mb-1">{REPORTS.find(r => r.id === selected)?.group}</div>
              <h2 className="font-display text-2xl text-stone-900">{REPORTS.find(r => r.id === selected)?.label}</h2>
              <p className="text-sm text-stone-500 mt-0.5">{REPORTS.find(r => r.id === selected)?.desc}</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
                {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white tabular" />
            </div>
          </div>
        </div>
        <div className="px-8 py-6">
          <ReportPanel id={selected} ctx={ctx} propertyId={propertyId} month={month} property={property} can={can} />
        </div>
      </main>
    </div>
  );
}

function ReportPanel({ id, ctx, propertyId, month, property, can }) {
  if (id === "deptpnl") return <DeptPnlPanel ctx={ctx} propertyId={propertyId} month={month} />;
  if (id === "ownerstmt") {
    if (can && !can("owner.statement.view")) return <NoAccess label="owner statements" />;
    return <OwnerStatementPanel ctx={ctx} propertyId={propertyId} month={month} property={property} />;
  }
  if (id === "mgmtfee") {
    if (can && !can("mgmtfee.view")) return <NoAccess label="management fee reports" />;
    return <ManagementFeePanel ctx={ctx} propertyId={propertyId} month={month} />;
  }
  if (id === "gop") return <GopPanel ctx={ctx} propertyId={propertyId} month={month} />;
  if (id === "apaging") return <ApAgingPanel ctx={ctx} propertyId={propertyId} />;
  if (id === "araging") return <ArAgingPanel ctx={ctx} propertyId={propertyId} />;
  if (id === "pickup") return <PickupPanel ctx={ctx} propertyId={propertyId} month={month} />;
  if (id === "segmix") return <SegMixPanel ctx={ctx} propertyId={propertyId} month={month} />;
  if (id === "fcacc") return <ForecastAccuracyPanel ctx={ctx} propertyId={propertyId} />;
  if (id === "fcvar") return <ForecastVariancePanel ctx={ctx} propertyId={propertyId} month={month} />;
  return null;
}

function NoAccess({ label }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
      <Users size={28} className="mx-auto text-stone-400 mb-3" />
      <h3 className="font-display text-lg text-stone-900">Restricted</h3>
      <p className="text-sm text-stone-500 mt-1">Your role does not include access to {label}.</p>
    </div>
  );
}

function DeptPnlPanel({ ctx, propertyId, month }) {
  const { state } = ctx;
  const range = monthRange(month);
  const ledger = (state.journalEntries || []).filter(j => !j.void && j.posted);
  const pnl = useMemo(() => buildDepartmentPnl({ ledger, start: range.start, end: range.end, propertyId }),
    [ledger, range.start, range.end, propertyId]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="Revenue" value={fmtMoney(pnl.totals.revenue.total)} />
        <Stat label="GOP" value={fmtMoney(pnl.totals.gop)} sub={fmtPct(pnl.totals.gopPct)} />
        <Stat label="NOI" value={fmtMoney(pnl.totals.noi)} sub={fmtPct(pnl.totals.noiPct)} />
        <Stat label="Realism" value={pnl.realism.gop.status} sub={pnl.realism.gop.note} narrow />
      </div>
      <ReportTable
        rows={pnl.rows.map(r => ({ ...r }))}
        columns={[
          { key: "accountCode", label: "Code", width: "w-20" },
          { key: "accountName", label: "Account" },
          { key: "type", label: "Type", width: "w-24", text: "stone-500" },
          { key: "amount", label: "Amount", align: "right", money: true },
        ]}
      />
    </div>
  );
}

function OwnerStatementPanel({ ctx, propertyId, month, property }) {
  const { state } = ctx;
  const ledger = (state.journalEntries || []).filter(j => !j.void && j.posted);
  const stmt = useMemo(() => {
    try { return buildOwnerStatement({ ledger, state, propertyId, month }); }
    catch { return null; }
  }, [ledger, state, propertyId, month]);
  if (!stmt) return <NoAccess label="this property" />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="Revenue" value={fmtMoney(stmt.pnl.revenue.total)} />
        <Stat label="NOI" value={fmtMoney(stmt.fees.noi)} />
        <Stat label="Mgmt Fees" value={fmtMoney(stmt.fees.baseFee + stmt.fees.incentiveFee)} />
        <Stat label="Owner Net" value={fmtMoney(stmt.fees.ownerNet)} highlight />
      </div>
      {!stmt.capTable.ok && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Cap-table issue: {stmt.capTable.issue}. ${fmtMoney(stmt.unallocated)} is unallocated.
        </div>
      )}
      <ReportTable
        rows={stmt.distributions.map(d => ({
          owner: d.ownerName, share: `${(d.sharePct * 100).toFixed(2)}%`, amount: d.amount,
        }))}
        columns={[
          { key: "owner", label: "Owner" },
          { key: "share", label: "Share", align: "right", width: "w-32" },
          { key: "amount", label: "Distribution", align: "right", money: true },
        ]}
      />
    </div>
  );
}

function ManagementFeePanel({ ctx, propertyId, month }) {
  const { state } = ctx;
  const ledger = (state.journalEntries || []).filter(j => !j.void && j.posted);
  const r = useMemo(() => {
    try { return buildManagementFeeReport({ ledger, state, propertyId, month }); }
    catch { return null; }
  }, [ledger, state, propertyId, month]);
  if (!r) return null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="Revenue" value={fmtMoney(r.revenue)} />
        <Stat label="Base Fee" value={fmtMoney(r.fees.baseFee)} />
        <Stat label="Incentive Fee" value={fmtMoney(r.fees.incentiveFee)} />
        <Stat label="Reserve" value={fmtMoney(r.fees.reserve)} />
      </div>
      <ReportTable
        rows={r.breakdown}
        columns={[
          { key: "label", label: "Line" },
          { key: "amount", label: "Amount", align: "right", money: true },
        ]}
      />
      {r.draftJournal && (
        <div className="rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
            <h3 className="font-display text-lg text-stone-900">Draft accrual JE</h3>
            <span className="text-xs text-stone-500">Posts to A/P (mgmt co) and FF&E reserve.</span>
          </div>
          <ReportTable
            rows={r.draftJournal.lines.map((l, i) => ({ ...l, _i: i }))}
            columns={[
              { key: "accountCode", label: "Acct", width: "w-20" },
              { key: "memo", label: "Memo" },
              { key: "debit", label: "Debit", align: "right", money: true },
              { key: "credit", label: "Credit", align: "right", money: true },
            ]}
            dense
          />
        </div>
      )}
    </div>
  );
}

function GopPanel({ ctx, propertyId, month }) {
  const { state } = ctx;
  const range = monthRange(month);
  const ledger = (state.journalEntries || []).filter(j => !j.void && j.posted);
  const pnl = useMemo(() => buildDepartmentPnl({ ledger, start: range.start, end: range.end, propertyId }),
    [ledger, range.start, range.end, propertyId]);
  const budget = (state.budgets || []).find(b => b.propertyId === propertyId && b.month === month);
  const r = useMemo(() => buildGopAnalysis({ pnl, budget }), [pnl, budget]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="GOP $" value={fmtMoney(r.actual.gop)} />
        <Stat label="GOP %" value={fmtPct(r.actual.gopPct)} />
        <Stat label="NOI $" value={fmtMoney(r.actual.noi)} />
        <Stat label="NOI %" value={fmtPct(r.actual.noiPct)} />
      </div>
      <ReportTable
        rows={r.departments}
        columns={[
          { key: "department", label: "Department" },
          { key: "revenue", label: "Revenue", align: "right", money: true },
          { key: "expense", label: "Expense", align: "right", money: true },
          { key: "profit", label: "Profit", align: "right", money: true },
          { key: "margin", label: "Margin", align: "right",
            render: (v) => fmtPct(v) },
        ]}
      />
      {r.diagnostic.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-4 space-y-1">
          {r.diagnostic.map((d, i) => <div key={i} className="text-sm text-amber-900">• {d}</div>)}
        </div>
      )}
    </div>
  );
}

function ApAgingPanel({ ctx, propertyId }) {
  const { state } = ctx;
  const r = useMemo(() => apAging({
    invoices: state.invoices, vendors: state.vendors, propIds: [propertyId],
  }), [state.invoices, state.vendors, propertyId]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Stat label="Current" value={fmtMoney(r.totals.current)} />
        <Stat label="30 – 59" value={fmtMoney(r.totals.b30)} />
        <Stat label="60 – 89" value={fmtMoney(r.totals.b60)} />
        <Stat label="90 – 119" value={fmtMoney(r.totals.b90)} />
        <Stat label="120+" value={fmtMoney(r.totals.b120)} highlight={r.totals.b120 > 0} />
      </div>
      <ReportTable
        rows={r.byVendor}
        columns={[
          { key: "vendorName", label: "Vendor" },
          { key: "current", label: "Current", align: "right", money: true },
          { key: "b30", label: "30 – 59", align: "right", money: true },
          { key: "b60", label: "60 – 89", align: "right", money: true },
          { key: "b90", label: "90 – 119", align: "right", money: true },
          { key: "b120", label: "120+", align: "right", money: true },
          { key: "total", label: "Total", align: "right", money: true },
        ]}
      />
    </div>
  );
}

function ArAgingPanel({ ctx, propertyId }) {
  const { state } = ctx;
  const r = useMemo(() => arAging({ reports: state.reports, propIds: [propertyId] }), [state.reports, propertyId]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Stat label="Current" value={fmtMoney(r.totals.current)} />
        <Stat label="30 – 59" value={fmtMoney(r.totals.b30)} />
        <Stat label="60 – 89" value={fmtMoney(r.totals.b60)} />
        <Stat label="90 – 119" value={fmtMoney(r.totals.b90)} />
        <Stat label="120+" value={fmtMoney(r.totals.b120)} highlight={r.totals.b120 > 0} />
      </div>
      <ReportTable
        rows={r.lines.slice(0, 200)}
        columns={[
          { key: "date", label: "Date" },
          { key: "ageDays", label: "Age (d)", align: "right" },
          { key: "bucket", label: "Bucket" },
          { key: "amount", label: "Amount", align: "right", money: true },
        ]}
      />
    </div>
  );
}

function PickupPanel({ ctx, propertyId, month }) {
  const { state } = ctx;
  const snapshots = state.bookingSnapshots || [];
  const today = new Date().toISOString().slice(0, 10);
  const last7 = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
  const r = pickupReport({ snapshots, propertyId, asOf: today, compareDate: last7 });
  if (r.status !== "ok") {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
        <Activity size={28} className="mx-auto text-stone-400 mb-3" />
        <h3 className="font-display text-lg text-stone-900">No booking snapshots</h3>
        <p className="text-sm text-stone-500 mt-1">Pickup requires daily snapshots of rooms-on-the-books. Wire your PMS ingestion to capture these.</p>
      </div>
    );
  }
  return (
    <ReportTable
      rows={r.rows}
      columns={[
        { key: "stayDate", label: "Stay Date" },
        { key: "roomsCompare", label: "Rooms 7d Ago", align: "right" },
        { key: "roomsAsOf", label: "Rooms Today", align: "right" },
        { key: "roomsPickup", label: "Pickup", align: "right" },
        { key: "revenuePickup", label: "$ Pickup", align: "right", money: true },
      ]}
    />
  );
}

function SegMixPanel({ ctx, propertyId, month }) {
  const { state } = ctx;
  const range = monthRange(month);
  const m = buildSegmentMix({ reports: state.reports, propertyId, start: range.start, end: range.end });
  if (!m.mix.length) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
        <Activity size={28} className="mx-auto text-stone-400 mb-3" />
        <h3 className="font-display text-lg text-stone-900">No segment data</h3>
        <p className="text-sm text-stone-500 mt-1">Tag report.breakdown.segments to enable segment mix reporting.</p>
      </div>
    );
  }
  return (
    <ReportTable
      rows={m.mix}
      columns={[
        { key: "segment", label: "Segment" },
        { key: "revenue", label: "Revenue", align: "right", money: true },
        { key: "roomNights", label: "Room nights", align: "right" },
        { key: "adr", label: "ADR", align: "right", money: true },
        { key: "share", label: "Share", align: "right", render: (v) => fmtPct(v) },
      ]}
    />
  );
}

function ForecastAccuracyPanel({ ctx, propertyId }) {
  const { state } = ctx;
  const r = gradeForecast(state.forecasts || [], state.reports || [], { propertyId });
  if (r.status !== "ok") {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
        <BarChart3 size={28} className="mx-auto text-stone-400 mb-3" />
        <h3 className="font-display text-lg text-stone-900">No forecast history yet</h3>
        <p className="text-sm text-stone-500 mt-1">Save forecast snapshots over time to build the accuracy curve.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="MAE" value={fmtMoney(r.metrics.mae)} />
        <Stat label="MAPE" value={fmtPct(r.metrics.mape)} />
        <Stat label="MPE (bias)" value={fmtPct(r.metrics.mpe)} sub={r.metrics.bias || ""} />
        <Stat label="Samples" value={String(r.metrics.n)} />
      </div>
      <ReportTable
        rows={r.horizonCurve}
        columns={[
          { key: "horizonDays", label: "Horizon (days)", align: "right" },
          { key: "n", label: "Samples", align: "right" },
          { key: "mae", label: "MAE", align: "right", money: true },
          { key: "mape", label: "MAPE", align: "right", render: (v) => fmtPct(v) },
        ]}
      />
    </div>
  );
}

function ForecastVariancePanel({ ctx, propertyId, month }) {
  const { state } = ctx;
  const range = monthRange(month);
  // Use the most recent forecast snapshot that covers this window
  const fcs = (state.forecasts || []).filter(f => f.propertyId === propertyId);
  const forecast = fcs.length
    ? fcs[fcs.length - 1].points.filter(p => p.date >= range.start && p.date <= range.end)
    : [];
  const r = buildForecastVariance({ reports: state.reports, forecast, propertyId, start: range.start, end: range.end });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat label="Actual" value={fmtMoney(r.summary.actualTotal)} />
        <Stat label="Forecast" value={fmtMoney(r.summary.forecastTotal)} />
        <Stat label="Variance" value={fmtMoney(r.summary.variance)} sub={fmtPct(r.summary.variancePct)} />
        <Stat label="MAPE" value={fmtPct(r.summary.mape)} />
      </div>
      <ReportTable
        rows={r.lines}
        columns={[
          { key: "date", label: "Date" },
          { key: "forecast", label: "Forecast", align: "right", money: true },
          { key: "actual", label: "Actual", align: "right", money: true },
          { key: "variance", label: "Variance", align: "right", money: true },
          { key: "variancePct", label: "%", align: "right", render: (v) => fmtPct(v) },
          { key: "bucket", label: "Bucket" },
        ]}
      />
    </div>
  );
}

function monthRange(month) {
  const [yy, mm] = month.split("-").map(Number);
  const end = new Date(yy, mm, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(end).padStart(2, "0")}` };
}

function Stat({ label, value, sub, highlight, narrow }) {
  return (
    <div className={`rounded-xl border ${highlight ? "border-amber-200 bg-amber-50/50" : "border-stone-200 bg-white"} p-4`}>
      <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">{label}</div>
      <div className={`font-display number-display ${narrow ? "text-base" : "text-2xl"} text-stone-900 font-semibold tabular`}>{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  );
}

function ReportTable({ rows, columns, dense }) {
  return (
    <div className="rounded-xl border border-stone-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
          <tr>
            {columns.map(c => (
              <th key={c.key} className={`${c.align === "right" ? "text-right" : "text-left"} px-4 ${dense ? "py-1.5" : "py-2"} font-medium ${c.width || ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.length === 0 ? (
            <tr><td className="text-center text-xs text-stone-400 px-4 py-6" colSpan={columns.length}>No rows.</td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="hover:bg-stone-50">
                {columns.map(c => {
                  const v = r[c.key];
                  const display = c.render ? c.render(v) : (c.money ? fmtMoney2(v) : v);
                  return (
                    <td key={c.key} className={`${c.align === "right" ? "text-right tabular" : ""} px-4 ${dense ? "py-1" : "py-1.5"} ${c.text ? `text-${c.text}` : "text-stone-700"} ${c.money || c.align === "right" ? "tabular" : ""}`}>
                      {display ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
