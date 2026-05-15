/* HotelOps · KPI Report Adapter
 * =================================================================
 * Bridges the existing report data shape to the canonical KPI
 * registry. The rest of the codebase reads daily / MTD / period
 * report objects in slightly different shapes; this adapter knows
 * how to extract the right inputs so callers don't have to.
 */

import { computeKpi, computeAllForPayload } from "./registry.js";

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }

/** Pull the standard inputs from a single daily flash report. */
export function inputsFromReport(report, extras = {}) {
  if (!report) return {};
  const b = report.breakdown || {};
  const fb = (b.revenue?.fb && Object.values(b.revenue.fb).reduce((s, v) => s + safe(v), 0)) || 0;
  const other = (b.revenue?.other && Object.values(b.revenue.other).reduce((s, v) => s + safe(v), 0)) || 0;
  const roomRev = safe(b.revenue?.rooms ?? report.roomRevenue);
  return {
    roomsSold: safe(report.roomsSold),
    roomsAvailable: safe(report.roomsAvailable),
    roomRevenue: roomRev,
    fbRevenue: fb,
    otherRevenue: other,
    totalRevenue: safe(report.totalRevenue) || (roomRev + fb + other),
    laborCost: safe(extras.laborCost),
    totalCost: safe(extras.totalCost),
    gop: safe(extras.gop),
    noi: safe(extras.noi),
  };
}

/** Aggregate inputs from a list of reports (MTD / YTD / window). */
export function inputsFromReports(reports = [], extras = {}) {
  const totals = (reports || []).reduce((acc, r) => {
    const i = inputsFromReport(r);
    acc.roomsSold += i.roomsSold;
    acc.roomsAvailable += i.roomsAvailable;
    acc.roomRevenue += i.roomRevenue;
    acc.fbRevenue += i.fbRevenue;
    acc.otherRevenue += i.otherRevenue;
    acc.totalRevenue += i.totalRevenue;
    return acc;
  }, { roomsSold: 0, roomsAvailable: 0, roomRevenue: 0, fbRevenue: 0, otherRevenue: 0, totalRevenue: 0 });
  return { ...totals, ...extras };
}

/** Convenience: compute the standard 4-tile KPIs for a report. */
export function dailyKpis(report, extras = {}) {
  const inputs = inputsFromReport(report, extras);
  return {
    occupancy: computeKpi("occupancy", inputs),
    adr:       computeKpi("adr", inputs),
    revpar:    computeKpi("revpar", inputs),
    revpor:    computeKpi("revpor", inputs),
  };
}

export function periodKpis(reports, extras = {}) {
  const inputs = inputsFromReports(reports, extras);
  return computeAllForPayload(inputs);
}
