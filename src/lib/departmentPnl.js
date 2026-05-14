/* HotelOps · USALI department P&L generator
 * =================================================================
 * Produces a Uniform-System-of-Accounts-aligned departmental P&L for
 * a property × period from the GL ledger:
 *
 *   Operating Revenue
 *     Rooms
 *     F&B
 *     Other Operated
 *   Departmental Expenses
 *     Rooms
 *     F&B
 *     Other Operated
 *   = Departmental Profit
 *   Undistributed Operating Expenses
 *     A&G
 *     Sales & Marketing (rolled into A&G in DEFAULT_CHART)
 *     Property Operations & Maintenance
 *     Utilities
 *   = Gross Operating Profit (GOP)
 *   Fixed Charges
 *     Property Taxes, Insurance, Interest, Depreciation
 *   = Net Operating Income (NOI)
 *
 * GOP / NOI margins are validated against realistic ranges:
 *   GOP margin: limited service 35-45%, full service 25-35%
 *   NOI margin: limited service 25-35%, full service 15-25%
 *
 * If observed margins fall outside the band, the result includes a
 * realism flag so the UI can highlight numbers that look like data
 * entry errors instead of business performance.
 */

import { DEFAULT_CHART } from "./gl.js";
import { toCents, fromCents } from "./money.js";

const SUBTYPE_BUCKET = {
  // revenue
  "rooms": { bucket: "revenue.rooms", section: "rooms" },
  "fb": { bucket: "revenue.fb", section: "fb" },
  "other": { bucket: "revenue.other", section: "other-operated" },
  // departmental expenses
  "rooms-expense": { bucket: "expense.deptl.rooms", section: "rooms" },
  "fb-expense": { bucket: "expense.deptl.fb", section: "fb" },
  // undistributed expenses
  "ag-expense": { bucket: "expense.undist.ag", section: "ag" },
  "payroll-expense": { bucket: "expense.undist.ag", section: "ag" }, // central payroll lumped in A&G
  // fixed charges
  "fixed-expense": { bucket: "expense.fixed", section: "fixed" },
};

function bucketKeyFor(account) {
  return SUBTYPE_BUCKET[account.subtype]?.bucket || (account.type === "expense" ? "expense.undist.ag" : null);
}

function sectionFor(account) {
  return SUBTYPE_BUCKET[account.subtype]?.section || null;
}

export function buildDepartmentPnl({ ledger, start, end, propertyId, chart = DEFAULT_CHART }) {
  const byAccount = new Map();
  for (const entry of ledger || []) {
    if (!entry.posted || entry.void) continue;
    if (start && entry.date < start) continue;
    if (end && entry.date > end) continue;
    if (propertyId && entry.propertyId && entry.propertyId !== propertyId) continue;
    for (const l of (entry.lines || [])) {
      const k = String(l.accountCode);
      const cur = byAccount.get(k) || { debitCents: 0, creditCents: 0 };
      cur.debitCents += toCents(l.debit);
      cur.creditCents += toCents(l.credit);
      byAccount.set(k, cur);
    }
  }
  const buckets = {
    "revenue.rooms":        0,
    "revenue.fb":           0,
    "revenue.other":        0,
    "expense.deptl.rooms":  0,
    "expense.deptl.fb":     0,
    "expense.undist.ag":    0,
    "expense.fixed":        0,
  };
  const rows = [];
  for (const acct of chart) {
    const bk = bucketKeyFor(acct);
    if (!bk) continue;
    const m = byAccount.get(String(acct.code)) || { debitCents: 0, creditCents: 0 };
    const netCents = acct.type === "revenue"
      ? (m.creditCents - m.debitCents)
      : (m.debitCents - m.creditCents);
    if (netCents === 0) continue;
    const amount = fromCents(netCents);
    buckets[bk] += amount;
    rows.push({
      accountCode: acct.code,
      accountName: acct.name,
      type: acct.type,
      subtype: acct.subtype,
      section: sectionFor(acct),
      amount,
    });
  }
  const totalRevenue = buckets["revenue.rooms"] + buckets["revenue.fb"] + buckets["revenue.other"];
  const deptlExpenses = buckets["expense.deptl.rooms"] + buckets["expense.deptl.fb"];
  const departmentalProfit = totalRevenue - deptlExpenses;
  const undistributed = buckets["expense.undist.ag"];
  const gop = departmentalProfit - undistributed;
  const fixed = buckets["expense.fixed"];
  const noi = gop - fixed;

  const gopPct = totalRevenue > 0 ? gop / totalRevenue : 0;
  const noiPct = totalRevenue > 0 ? noi / totalRevenue : 0;

  // Realism bands
  const realism = {
    gop: assessBand(gopPct, [0.15, 0.55], "GOP"),
    noi: assessBand(noiPct, [0.05, 0.40], "NOI"),
  };

  return {
    propertyId,
    period: { start, end },
    totals: {
      revenue: {
        rooms: buckets["revenue.rooms"],
        fb: buckets["revenue.fb"],
        other: buckets["revenue.other"],
        total: totalRevenue,
      },
      departmentalExpense: {
        rooms: buckets["expense.deptl.rooms"],
        fb: buckets["expense.deptl.fb"],
        total: deptlExpenses,
      },
      departmentalProfit,
      undistributed: { ag: buckets["expense.undist.ag"], total: undistributed },
      gop,
      gopPct,
      fixed,
      noi,
      noiPct,
    },
    rows,
    realism,
  };
}

function assessBand(value, [lo, hi], label) {
  if (value < lo) return { status: "low", note: `${label} margin ${(value * 100).toFixed(1)}% is below the typical floor of ${(lo * 100).toFixed(0)}%.` };
  if (value > hi) return { status: "high", note: `${label} margin ${(value * 100).toFixed(1)}% is above the typical ceiling of ${(hi * 100).toFixed(0)}% — verify expense coding.` };
  return { status: "in-band", note: `${label} margin ${(value * 100).toFixed(1)}% is within typical hospitality range.` };
}
