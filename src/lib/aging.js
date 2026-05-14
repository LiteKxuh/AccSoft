/* HotelOps · A/P + A/R aging
 * =================================================================
 * Real aging buckets (current / 30 / 60 / 90 / 120+) for vendor
 * invoices and direct-bill folios, with vendor/property rollups and
 * exportable lines.
 */

import { toCents, fromCents } from "./money.js";

const BUCKETS = [
  { id: "current", label: "Current",   min: 0,   max: 30 },
  { id: "b30",     label: "30 – 59",   min: 30,  max: 60 },
  { id: "b60",     label: "60 – 89",   min: 60,  max: 90 },
  { id: "b90",     label: "90 – 119",  min: 90,  max: 120 },
  { id: "b120",    label: "120+",      min: 120, max: Infinity },
];

export const AGING_BUCKETS = BUCKETS;

function bucketFor(days) {
  for (const b of BUCKETS) if (days >= b.min && days < b.max) return b.id;
  return "b120";
}

function daysBetween(today, dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((today - d) / (24 * 3600 * 1000)));
}

/**
 * A/P aging — vendor invoices that are not paid.
 * Status guards: "paid" is excluded entirely. "void" is excluded.
 * Open balance uses dueDate (preferred) or issuedDate fallback for age.
 *
 * @param {Array} invoices state.invoices
 * @param {Array} vendors  state.vendors
 * @param {Array} propIds  property IDs in scope (or null for all)
 * @param {Date}  asOf
 */
export function apAging({ invoices, vendors, propIds = null, asOf = new Date() }) {
  const today = asOf instanceof Date ? asOf : new Date(asOf);
  const lines = [];
  const totals = { current: 0, b30: 0, b60: 0, b90: 0, b120: 0, total: 0 };
  const byVendor = new Map();

  for (const inv of invoices || []) {
    if (!inv) continue;
    if (inv.status === "paid" || inv.status === "void") continue;
    if (propIds && !propIds.includes(inv.propertyId)) continue;
    const amount = Number(inv.amount) || 0;
    if (amount <= 0) continue;
    const ageFromDate = inv.dueDate || inv.issuedDate;
    // Once due, age from due date. Before due, treat as current.
    const days = inv.dueDate && today > new Date(inv.dueDate)
      ? daysBetween(today, inv.dueDate)
      : 0;
    const b = bucketFor(days);
    const v = (vendors || []).find(x => x.id === inv.vendorId);
    const line = {
      id: inv.id,
      vendorId: inv.vendorId,
      vendorName: v?.name || "(unknown vendor)",
      number: inv.number || inv.invoiceNumber,
      propertyId: inv.propertyId,
      issuedDate: inv.issuedDate,
      dueDate: inv.dueDate,
      ageDays: days,
      bucket: b,
      amount,
      status: inv.status,
    };
    lines.push(line);
    totals[b] += amount;
    totals.total += amount;

    const vid = inv.vendorId || "_unknown";
    const agg = byVendor.get(vid) || { vendorId: vid, vendorName: line.vendorName, current: 0, b30: 0, b60: 0, b90: 0, b120: 0, total: 0 };
    agg[b] += amount;
    agg.total += amount;
    byVendor.set(vid, agg);
  }

  lines.sort((a, b) => b.ageDays - a.ageDays);
  return {
    lines,
    totals,
    byVendor: Array.from(byVendor.values()).sort((a, b) => b.total - a.total),
    weightedAverageDays: weightedAvgDays(lines),
  };
}

/**
 * A/R aging — direct-bill (city ledger) folios.
 *
 * In the absence of folio-level entries, the daily report's directBill
 * payment is treated as a single-day receivable aging from r.date.
 */
export function arAging({ reports, propIds = null, asOf = new Date(), enrich = null }) {
  const today = asOf instanceof Date ? asOf : new Date(asOf);
  const lines = [];
  const totals = { current: 0, b30: 0, b60: 0, b90: 0, b120: 0, total: 0 };
  const byProperty = new Map();

  for (const r of reports || []) {
    if (propIds && !propIds.includes(r.propertyId)) continue;
    const er = typeof enrich === "function" ? enrich(r) : r;
    const db = er.breakdown?.payments?.directBill || 0;
    if (db <= 0) continue;
    const days = daysBetween(today, r.date);
    const b = bucketFor(days);
    const line = {
      propertyId: r.propertyId,
      date: r.date,
      ageDays: days,
      bucket: b,
      amount: db,
    };
    lines.push(line);
    totals[b] += db;
    totals.total += db;

    const pid = r.propertyId || "_unknown";
    const agg = byProperty.get(pid) || { propertyId: pid, current: 0, b30: 0, b60: 0, b90: 0, b120: 0, total: 0 };
    agg[b] += db;
    agg.total += db;
    byProperty.set(pid, agg);
  }

  lines.sort((a, b) => b.ageDays - a.ageDays);
  return {
    lines,
    totals,
    byProperty: Array.from(byProperty.values()).sort((a, b) => b.total - a.total),
    weightedAverageDays: weightedAvgDays(lines),
  };
}

function weightedAvgDays(lines) {
  let totalAmt = 0, weightedDays = 0;
  for (const l of lines) {
    totalAmt += l.amount;
    weightedDays += l.amount * l.ageDays;
  }
  return totalAmt > 0 ? weightedDays / totalAmt : 0;
}
