/* HotelOps · Operational Cost Intelligence
 * =================================================================
 * Predictive operational cost intelligence. Goes beyond accounting:
 * looks at the cost-per-occupied-room (CPOR) for every operational
 * cost driver, forecasts spend, and flags margin erosion before it
 * hits the P&L.
 *
 *   buildCpor({ ledger, reports, propertyId, period })
 *     → { totalCpor, byCategory, byMonth, trendDelta }
 *
 *   forecastUtilityCost({ ledger, reports, propertyId, horizon })
 *     → next-N-day utility spend projection
 *
 *   detectFnbCostVariance({ ledger, reports, propertyId, period, targetCogsPct })
 *     → F&B cost-of-sales % vs target with explanation
 *
 *   maintenanceSpendPrediction({ ledger, propertyId, horizon })
 *     → next-period maintenance spend projection
 *
 *   detectMarginErosion({ ledger, reports, propertyId, periods = 6 })
 *     → trailing margin trend with erosion flag
 *
 *   detectOperationalWaste({ ledger, reports, propertyId, period })
 *     → leakage findings (low-utilization spend, suspicious patterns)
 *
 *   runCostIntelligence({ state, propertyId, period })
 *     → aggregated dashboard payload
 *
 * Categories (USALI account ranges):
 *   utilities:    6800-6810  (electric/gas/water)
 *   linen:        6210 partial + bias toward Operating Supplies
 *   supplies:     6100 / 6210 / 6220
 *   fb_cost:      6010 / 6020
 *   maintenance:  6210 / 6710
 *
 * Pure functions. No I/O.
 */

import { toCents, fromCents } from "./money.js";

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

const CATEGORY_ACCOUNTS = {
  utilities:   ["6800", "6810"],
  linen:       ["6100", "6210"],
  supplies:    ["6100", "6210", "6220"],
  fb_cost:     ["6010", "6020"],
  maintenance: ["6710", "6700"],
  marketing:   ["6300", "7200"],
  ag:          ["6400", "6500", "5030"],
};

function inRange(date, start, end) {
  return (!start || date >= start) && (!end || date <= end);
}

function sumLedgerByAccountCodes({ ledger, accountCodes, propertyId, start, end }) {
  const codes = new Set(accountCodes.map(String));
  let totalCents = 0;
  for (const entry of (ledger || [])) {
    if (!entry.posted || entry.void) continue;
    if (propertyId && entry.propertyId && entry.propertyId !== propertyId) continue;
    if (!inRange(entry.date, start, end)) continue;
    for (const l of (entry.lines || [])) {
      if (!codes.has(String(l.accountCode))) continue;
      totalCents += toCents(l.debit) - toCents(l.credit);
    }
  }
  return fromCents(totalCents);
}

function roomsSoldInRange(reports = [], propertyId, start, end) {
  return (reports || []).reduce((s, r) => {
    if (propertyId && r.propertyId !== propertyId) return s;
    if (!inRange(r.date, start, end)) return s;
    return s + safe(r.roomsSold);
  }, 0);
}

function totalRevenueInRange(reports = [], propertyId, start, end) {
  return (reports || []).reduce((s, r) => {
    if (propertyId && r.propertyId !== propertyId) return s;
    if (!inRange(r.date, start, end)) return s;
    return s + safe(r.totalRevenue);
  }, 0);
}

function fbRevenueInRange(reports = [], propertyId, start, end) {
  return (reports || []).reduce((s, r) => {
    if (propertyId && r.propertyId !== propertyId) return s;
    if (!inRange(r.date, start, end)) return s;
    const fb = r.breakdown?.revenue?.fb;
    if (!fb) return s;
    return s + Object.values(fb).reduce((sub, v) => sub + safe(v), 0);
  }, 0);
}

/* ============ CPOR by category ============ */

export function buildCpor({ ledger, reports, propertyId, period }) {
  const { start, end } = period || {};
  const roomsSold = roomsSoldInRange(reports, propertyId, start, end);
  const totalRevenue = totalRevenueInRange(reports, propertyId, start, end);
  const out = { totalCpor: 0, byCategory: [], totalCost: 0, roomsSold, totalRevenue };
  let totalCost = 0;
  for (const [cat, codes] of Object.entries(CATEGORY_ACCOUNTS)) {
    const cost = sumLedgerByAccountCodes({ ledger, accountCodes: codes, propertyId, start, end });
    if (cost === 0) continue;
    totalCost += cost;
    out.byCategory.push({
      category: cat,
      cost: round2(cost),
      cpor: roomsSold > 0 ? round2(cost / roomsSold) : null,
      pctRev: totalRevenue > 0 ? cost / totalRevenue : null,
    });
  }
  out.totalCost = round2(totalCost);
  out.totalCpor = roomsSold > 0 ? round2(totalCost / roomsSold) : null;
  out.byCategory.sort((a, b) => b.cost - a.cost);
  return out;
}

/* ============ Utility forecasting ============ */

/**
 * Project next-N-day utility spend using trailing 90-day average cost-per-occupied-room
 * × forecast occupancy.
 *
 * @param {object} input
 * @param {Array}  input.ledger
 * @param {Array}  input.reports
 * @param {string} input.propertyId
 * @param {Array}  input.forecastDays  [{date, projectedOccupancy, capacity}]
 */
export function forecastUtilityCost({ ledger, reports, propertyId, forecastDays = [] }) {
  if (!Array.isArray(forecastDays) || forecastDays.length === 0) {
    return { status: "no-forecast", projection: 0, perDay: null };
  }
  // Baseline: last 90 days
  const today = new Date();
  const ninetyAgo = new Date(today); ninetyAgo.setDate(ninetyAgo.getDate() - 90);
  const baselineStart = ninetyAgo.toISOString().slice(0, 10);
  const baselineEnd = today.toISOString().slice(0, 10);
  const cost = sumLedgerByAccountCodes({
    ledger, accountCodes: CATEGORY_ACCOUNTS.utilities, propertyId,
    start: baselineStart, end: baselineEnd,
  });
  const rooms = roomsSoldInRange(reports, propertyId, baselineStart, baselineEnd);
  if (rooms <= 0) return { status: "insufficient-history", projection: 0 };
  const cpor = cost / rooms;
  const perDay = [];
  let projection = 0;
  for (const day of forecastDays) {
    const expectedRooms = safe(day.projectedOccupancy) * safe(day.capacity);
    const dayCost = expectedRooms * cpor;
    perDay.push({ date: day.date, expectedRooms: round2(expectedRooms), projectedCost: round2(dayCost) });
    projection += dayCost;
  }
  return {
    status: "ok",
    cporBaseline: round2(cpor),
    baselineCost: round2(cost),
    baselineRooms: rooms,
    projection: round2(projection),
    perDay,
  };
}

/* ============ F&B cost variance ============ */

export function detectFnbCostVariance({ ledger, reports, propertyId, period, targetCogsPct = 0.30 }) {
  const { start, end } = period || {};
  const fbRev = fbRevenueInRange(reports, propertyId, start, end);
  if (fbRev <= 0) return { status: "no-fb-revenue" };
  const cost = sumLedgerByAccountCodes({
    ledger, accountCodes: CATEGORY_ACCOUNTS.fb_cost, propertyId, start, end,
  });
  const cogsPct = cost / fbRev;
  const variance = cogsPct - targetCogsPct;
  const verdict = Math.abs(variance) < 0.02 ? "on-target"
    : variance > 0 ? "over-target" : "under-target";
  return {
    status: "ok",
    fbRevenue: round2(fbRev),
    cost: round2(cost),
    cogsPct,
    targetCogsPct,
    variance,
    verdict,
    explanation: verdict === "over-target"
      ? `F&B COGS ${(cogsPct * 100).toFixed(1)}% vs target ${(targetCogsPct * 100).toFixed(1)}% — ${(variance * 100).toFixed(1)} pts over. Review menu pricing, waste, and inventory shrinkage.`
      : verdict === "under-target"
      ? `F&B COGS ${(cogsPct * 100).toFixed(1)}% vs target ${(targetCogsPct * 100).toFixed(1)}% — confirm inventory not understated or revenue not over-reported.`
      : "F&B costs are tracking to target.",
  };
}

/* ============ Maintenance spend prediction ============ */

export function maintenanceSpendPrediction({ ledger, propertyId, horizonDays = 30 }) {
  const today = new Date();
  const ninetyAgo = new Date(today); ninetyAgo.setDate(ninetyAgo.getDate() - 90);
  const cost = sumLedgerByAccountCodes({
    ledger, accountCodes: CATEGORY_ACCOUNTS.maintenance, propertyId,
    start: ninetyAgo.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10),
  });
  if (cost <= 0) return { status: "no-history", projection: 0 };
  const dailyAvg = cost / 90;
  const projection = dailyAvg * horizonDays;
  // Detect outlier months
  const monthly = monthlyTotals({ ledger, accountCodes: CATEGORY_ACCOUNTS.maintenance, propertyId });
  const recent = monthly.slice(-6).map(m => m.total);
  const median = recent.length ? [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)] : 0;
  const lastMonth = monthly[monthly.length - 1]?.total || 0;
  const spike = lastMonth > median * 1.5;
  return {
    status: "ok",
    dailyAverage: round2(dailyAvg),
    projection: round2(projection),
    horizonDays,
    monthlyTrend: monthly.slice(-12),
    recentSpike: spike,
    notes: spike ? `Maintenance spike last month (${round2(lastMonth)} vs trailing median ${round2(median)}) — likely deferred repair work or system failure.` : null,
  };
}

function monthlyTotals({ ledger, accountCodes, propertyId }) {
  const codes = new Set(accountCodes.map(String));
  const byMonth = new Map();
  for (const entry of (ledger || [])) {
    if (!entry.posted || entry.void) continue;
    if (propertyId && entry.propertyId && entry.propertyId !== propertyId) continue;
    const m = String(entry.date).slice(0, 7);
    let amt = 0;
    for (const l of (entry.lines || [])) {
      if (!codes.has(String(l.accountCode))) continue;
      amt += toCents(l.debit) - toCents(l.credit);
    }
    if (!amt) continue;
    byMonth.set(m, (byMonth.get(m) || 0) + amt);
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, cents]) => ({ month, total: round2(fromCents(cents)) }));
}

/* ============ Margin erosion ============ */

export function detectMarginErosion({ ledger, reports, propertyId, periods = 6 }) {
  // Calculate departmental profit margin per month for trailing N months
  const today = new Date();
  const months = [];
  for (let i = periods - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const rev = totalRevenueInRange(reports, propertyId, start, end);
    // Operating expenses approximation: 5xxx + 6xxx
    const expense = sumLedgerByAccountCodes({
      ledger,
      accountCodes: [...CATEGORY_ACCOUNTS.utilities, ...CATEGORY_ACCOUNTS.fb_cost, ...CATEGORY_ACCOUNTS.supplies, ...CATEGORY_ACCOUNTS.maintenance, ...CATEGORY_ACCOUNTS.ag, "5010", "5020"],
      propertyId, start, end,
    });
    const margin = rev > 0 ? (rev - expense) / rev : null;
    months.push({ month: start.slice(0, 7), revenue: round2(rev), expense: round2(expense), margin });
  }
  // Erosion detection: margin trending down 3+ months in a row
  const validMonths = months.filter(m => m.margin != null);
  if (validMonths.length < 3) return { status: "insufficient-history", months };
  let descents = 0;
  for (let i = 1; i < validMonths.length; i++) {
    if (validMonths[i].margin < validMonths[i - 1].margin) descents++;
    else descents = 0;
    if (descents >= 3) {
      return {
        status: "erosion-detected",
        months,
        descents,
        latestMargin: validMonths[validMonths.length - 1].margin,
        explanation: `Margin has declined for ${descents} consecutive months — diagnose cost pressure vs revenue compression.`,
      };
    }
  }
  return { status: "ok", months, descents: 0 };
}

/* ============ Operational waste detection ============ */

export function detectOperationalWaste({ ledger, reports, propertyId, period }) {
  const { start, end } = period || {};
  const findings = [];
  const roomsSold = roomsSoldInRange(reports, propertyId, start, end);
  const totalRevenue = totalRevenueInRange(reports, propertyId, start, end);
  // Heuristic 1: supply CPOR > $20 in midscale, > $40 in upscale — red flag
  const supplyCost = sumLedgerByAccountCodes({
    ledger, accountCodes: CATEGORY_ACCOUNTS.supplies, propertyId, start, end,
  });
  if (roomsSold > 0) {
    const supplyCpor = supplyCost / roomsSold;
    if (supplyCpor > 35) {
      findings.push({
        code: "supply.cpor.high",
        severity: supplyCpor > 50 ? "high" : "medium",
        label: `Supply CPOR $${supplyCpor.toFixed(2)} is high`,
        detail: `Industry midscale benchmark is $8-15/occupied room. Review consumable utilization and inventory shrinkage.`,
      });
    }
  }
  // Heuristic 2: utility CPOR spikes month-over-month
  const utility = sumLedgerByAccountCodes({
    ledger, accountCodes: CATEGORY_ACCOUNTS.utilities, propertyId, start, end,
  });
  if (roomsSold > 0) {
    const utilCpor = utility / roomsSold;
    if (utilCpor > 25) {
      findings.push({
        code: "utility.cpor.high",
        severity: utilCpor > 40 ? "high" : "medium",
        label: `Utility CPOR $${utilCpor.toFixed(2)} is elevated`,
        detail: `Investigate HVAC scheduling, vacant-room temperature setbacks, and equipment efficiency.`,
      });
    }
  }
  // Heuristic 3: AG (admin & general) > 12% of revenue is leakage signal
  const ag = sumLedgerByAccountCodes({
    ledger, accountCodes: CATEGORY_ACCOUNTS.ag, propertyId, start, end,
  });
  if (totalRevenue > 0) {
    const agPct = ag / totalRevenue;
    if (agPct > 0.12) {
      findings.push({
        code: "ag.pct.high",
        severity: agPct > 0.18 ? "high" : "medium",
        label: `A&G ${(agPct * 100).toFixed(1)}% of revenue exceeds 12% benchmark`,
        detail: `Review professional fees, software subscriptions, and management overhead.`,
      });
    }
  }
  return {
    status: "ok",
    findings,
    summary: findings.length
      ? `${findings.length} operational waste signal(s) detected.`
      : "No operational waste signals in this period.",
  };
}

/* ============ Aggregated dashboard ============ */

export function runCostIntelligence({ state, propertyId, period, forecastDays = [], targetFnbCogsPct = 0.30 }) {
  const ledger = (state.journalEntries || []).filter(j => j.posted && !j.void);
  const reports = state.reports || [];
  return {
    cpor: buildCpor({ ledger, reports, propertyId, period }),
    utilityForecast: forecastUtilityCost({ ledger, reports, propertyId, forecastDays }),
    fnb: detectFnbCostVariance({ ledger, reports, propertyId, period, targetCogsPct: targetFnbCogsPct }),
    maintenance: maintenanceSpendPrediction({ ledger, propertyId, horizonDays: 30 }),
    margin: detectMarginErosion({ ledger, reports, propertyId, periods: 6 }),
    waste: detectOperationalWaste({ ledger, reports, propertyId, period }),
  };
}

export { CATEGORY_ACCOUNTS };
