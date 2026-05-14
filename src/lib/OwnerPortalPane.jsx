import { useMemo, useState } from "react";
import { DollarSign, Building2, TrendingUp, Receipt } from "lucide-react";
import { buildOwnerStatement } from "./ownerStatement.js";
import { buildManagementFeeReport } from "./managementFeeReport.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtMoney2(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtPct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }

export function OwnerPortalPane({ ctx, can }) {
  const { state, accessibleProperties, activeProperty } = ctx;
  const [propertyId, setPropertyId] = useState(activeProperty || accessibleProperties[0]?.id);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const allowed = !can || can("owner.statement.view");
  const property = (state.properties || []).find(p => p.id === propertyId);

  const stmt = useMemo(() => {
    if (!allowed || !propertyId) return null;
    try {
      const ledger = (state.journalEntries || []).filter(j => !j.void && j.posted);
      return buildOwnerStatement({ ledger, state, propertyId, month });
    } catch { return null; }
  }, [allowed, state, propertyId, month]);

  const fees = useMemo(() => {
    if (!allowed || !propertyId) return null;
    try {
      const ledger = (state.journalEntries || []).filter(j => !j.void && j.posted);
      return buildManagementFeeReport({ ledger, state, propertyId, month });
    } catch { return null; }
  }, [allowed, state, propertyId, month]);

  if (!allowed) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
          <Building2 size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-lg text-stone-900">Owner-only</h3>
          <p className="text-sm text-stone-500 mt-1">The Owner Portal is restricted to ownership and senior controllers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Owner Portal</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{property?.name || "Property"}</h2>
          <p className="text-sm text-stone-500 mt-1">Performance, fees, and distributable cash for the selected month.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
            {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white tabular" />
        </div>
      </div>

      {stmt ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <KpiTile icon={DollarSign} label="Revenue" value={fmtMoney(stmt.pnl.revenue.total)} />
            <KpiTile icon={TrendingUp} label="NOI" value={fmtMoney(stmt.fees.noi)} sub={fmtPct(stmt.pnl.noiPct)} />
            <KpiTile icon={Receipt} label="Mgmt Fees" value={fmtMoney(stmt.fees.baseFee + stmt.fees.incentiveFee)} />
            <KpiTile icon={DollarSign} label="Distributable" value={fmtMoney(stmt.fees.ownerNet)} highlight />
          </div>

          {/* Fee schedule */}
          {fees && (
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
                <h3 className="font-display text-lg text-stone-900">Fee detail · {month}</h3>
                {fees.mgmtCompany && <span className="text-xs text-stone-500">{fees.mgmtCompany.name}</span>}
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-stone-100">
                  {fees.breakdown.map((b, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="px-4 py-2 text-stone-800">{b.label}</td>
                      <td className="px-4 py-2 text-right tabular font-semibold">{fmtMoney2(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cap-table distribution */}
          <div className="rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
              <h3 className="font-display text-lg text-stone-900">Owner distributions</h3>
              {!stmt.capTable.ok && (
                <p className="text-xs text-amber-700 mt-1">Cap-table issue: {stmt.capTable.issue}. ${fmtMoney(stmt.unallocated)} unallocated.</p>
              )}
            </div>
            {stmt.distributions.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-stone-500">No distributions for this period.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Owner</th>
                    <th className="text-right px-4 py-2 font-medium w-32">Share</th>
                    <th className="text-right px-4 py-2 font-medium w-44">Distribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {stmt.distributions.map((d, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="px-4 py-1.5 text-stone-900">{d.ownerName}</td>
                      <td className="px-4 py-1.5 text-right tabular">{(d.sharePct * 100).toFixed(2)}%</td>
                      <td className="px-4 py-1.5 text-right tabular font-semibold">{fmtMoney2(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
          <Building2 size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-lg text-stone-900">No statement available</h3>
          <p className="text-sm text-stone-500 mt-1">No posted ledger activity for this property × month.</p>
        </div>
      )}
    </div>
  );
}

function KpiTile({ icon: Icon, label, value, sub, highlight }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-white"}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
        <Icon size={13} /> {label}
      </div>
      <div className="font-display number-display text-2xl text-stone-900 font-semibold tabular">{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  );
}
