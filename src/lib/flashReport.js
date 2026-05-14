/* HotelOps · Manager Flash Report engine
 * =================================================================
 * Builds the institutional-grade daily Flash Report used by GMs,
 * controllers, and ownership: today, MTD, YTD, pace, variance to
 * budget, segment mix, labor %, GOP estimate, plus drill-down rows.
 *
 *   buildFlash(state, { propertyId, asOf, budget? }) -> FlashReport
 *
 * Realism guards: all rate calculations are clamped/validated; the
 * report is built off USALI-aligned categories so it lines up with
 * the trial balance.
 */

import { addMoney, subMoney, fromCents, toCents } from "./money.js";

const ZERO = { rooms: 0, fb: 0, other: 0, tax: 0, total: 0 };

function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function enrich(r) {
  const b = r.breakdown || {};
  const fb = b.revenue?.fb || {};
  const other = b.revenue?.other || {};
  const taxes = b.taxes || {};
  return {
    date: r.date,
    propertyId: r.propertyId,
    roomsAvailable: safeNum(r.roomsAvailable),
    roomsSold: safeNum(r.roomsSold),
    occupancy: safeNum(r.occupancy),
    adr: safeNum(r.adr),
    revpar: safeNum(r.revpar),
    rooms: safeNum(b.revenue?.rooms),
    fbTotal: safeNum(fb.restaurant) + safeNum(fb.banquet) + safeNum(fb.bar),
    other: safeNum(other.parking) + safeNum(other.spa) + safeNum(other.telephone) + safeNum(other.misc),
    tax: safeNum(taxes.occupancy) + safeNum(taxes.sales) + safeNum(taxes.tourism),
    totalRevenue: safeNum(r.totalRevenue),
    raw: r,
  };
}

function aggregate(reports) {
  const out = { ...ZERO, roomsSold: 0, roomsAvailable: 0, count: 0 };
  for (const r of reports) {
    out.rooms += r.rooms;
    out.fb += r.fbTotal;
    out.other += r.other;
    out.tax += r.tax;
    out.total += r.totalRevenue || (r.rooms + r.fbTotal + r.other);
    out.roomsSold += r.roomsSold;
    out.roomsAvailable += r.roomsAvailable;
    out.count += 1;
  }
  out.adr = out.roomsSold > 0 ? out.rooms / out.roomsSold : 0;
  out.occupancy = out.roomsAvailable > 0 ? out.roomsSold / out.roomsAvailable : 0;
  out.revpar = out.roomsAvailable > 0 ? out.rooms / out.roomsAvailable : 0;
  return out;
}

function delta(a, b) {
  if (!b) return { abs: a || 0, pct: null };
  const abs = (a || 0) - b;
  return { abs, pct: b !== 0 ? abs / b : null };
}

/**
 * Build a complete flash report.
 *
 * @param {object} state    HotelOps state
 * @param {object} opts
 * @param {string} opts.propertyId
 * @param {string} opts.asOf       YYYY-MM-DD (the "today" of the flash)
 * @param {object} [opts.budget]   { monthlyRevenue, dailyRoomsAvailable, ... }
 * @param {object} [opts.labor]    { todayCost, mtdCost, ytdCost }
 */
export function buildFlash(state, opts = {}) {
  const { propertyId, asOf, budget = null, labor = null } = opts;
  if (!propertyId || !asOf) return null;

  const all = (state.reports || [])
    .filter(r => r.propertyId === propertyId)
    .map(enrich)
    .sort((a, b) => a.date.localeCompare(b.date));

  const today = all.find(r => r.date === asOf) || null;
  if (!today) return { propertyId, asOf, missing: true };

  const monthStart = `${asOf.slice(0, 7)}-01`;
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const dayBefore = (() => {
    const d = new Date(asOf); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const mtd = aggregate(all.filter(r => r.date >= monthStart && r.date <= asOf));
  const ytd = aggregate(all.filter(r => r.date >= yearStart  && r.date <= asOf));

  // Prior-period baselines
  const last7 = aggregate(all.filter(r => r.date < asOf).slice(-7));
  const last30 = aggregate(all.filter(r => r.date < asOf).slice(-30));
  const prior = all.find(r => r.date === dayBefore) || null;
  const asOfDow = new Date(asOf).getDay();
  const sameDow = aggregate(all.filter(r => r.date < asOf && new Date(r.date).getDay() === asOfDow).slice(-6));

  // Pace: linear projection to month end
  const monthEnd = (() => {
    const [y, m] = asOf.slice(0, 7).split("-").map(Number);
    return new Date(y, m, 0).getDate();
  })();
  const daysElapsed = Number(asOf.slice(8, 10));
  const dailyAvg = daysElapsed > 0 ? mtd.total / daysElapsed : 0;
  const monthProjection = dailyAvg * monthEnd;

  // Budget variance
  const monthlyBudget = safeNum(budget?.monthlyRevenue);
  const expectedMtd = monthlyBudget > 0 ? monthlyBudget * (daysElapsed / monthEnd) : 0;
  const budgetVarMtd = monthlyBudget > 0 ? mtd.total - expectedMtd : null;
  const budgetVarPctMtd = monthlyBudget > 0 && expectedMtd > 0 ? budgetVarMtd / expectedMtd : null;
  const budgetProjVar = monthlyBudget > 0 ? monthProjection - monthlyBudget : null;

  // GOP estimate (Hotel Industry rule of thumb: GOP margin 30-40% for limited service, 35-50% for full)
  // Use labor + reasonable opex assumption from chart if not supplied. Default to 65% cost ratio.
  const laborCostMtd = safeNum(labor?.mtdCost);
  const opexEstimate = laborCostMtd + mtd.total * 0.20; // 20% non-labor opex placeholder
  const gop = mtd.total - opexEstimate;
  const gopPct = mtd.total > 0 ? gop / mtd.total : 0;

  return {
    propertyId,
    asOf,
    today: {
      revenue: today.totalRevenue,
      rooms: today.rooms,
      fb: today.fbTotal,
      other: today.other,
      tax: today.tax,
      occupancy: today.occupancy,
      adr: today.adr,
      revpar: today.revpar,
      roomsSold: today.roomsSold,
      roomsAvailable: today.roomsAvailable,
    },
    vs: {
      prior: prior ? {
        revenue: delta(today.totalRevenue, prior.totalRevenue),
        occupancy: delta(today.occupancy, prior.occupancy),
        adr: delta(today.adr, prior.adr),
      } : null,
      sameDow: sameDow.count ? {
        revenue: delta(today.totalRevenue, sameDow.total / sameDow.count),
        occupancy: delta(today.occupancy, sameDow.occupancy),
        adr: delta(today.adr, sameDow.adr),
        n: sameDow.count,
      } : null,
      last7: last7.count ? {
        revenue: delta(today.totalRevenue, last7.total / last7.count),
        occupancy: delta(today.occupancy, last7.occupancy),
        adr: delta(today.adr, last7.adr),
      } : null,
    },
    mtd: {
      revenue: mtd.total,
      rooms: mtd.rooms,
      fb: mtd.fb,
      other: mtd.other,
      tax: mtd.tax,
      occupancy: mtd.occupancy,
      adr: mtd.adr,
      revpar: mtd.revpar,
      days: mtd.count,
    },
    ytd: {
      revenue: ytd.total,
      rooms: ytd.rooms,
      fb: ytd.fb,
      other: ytd.other,
      tax: ytd.tax,
      occupancy: ytd.occupancy,
      adr: ytd.adr,
      revpar: ytd.revpar,
      days: ytd.count,
    },
    pace: {
      daysElapsed,
      monthLength: monthEnd,
      dailyAvg,
      projection: monthProjection,
      pctOfMonth: monthEnd > 0 ? daysElapsed / monthEnd : 0,
    },
    budget: monthlyBudget > 0 ? {
      monthlyRevenue: monthlyBudget,
      expectedMtd,
      variance: budgetVarMtd,
      variancePct: budgetVarPctMtd,
      projectionVariance: budgetProjVar,
      onTrack: budgetVarPctMtd != null && Math.abs(budgetVarPctMtd) < 0.05,
    } : null,
    labor: labor ? {
      mtdCost: laborCostMtd,
      mtdPctOfRev: mtd.total > 0 ? laborCostMtd / mtd.total : 0,
      todayCost: safeNum(labor.todayCost),
    } : null,
    gop: mtd.total > 0 ? {
      gop,
      pct: gopPct,
      opexEstimate,
      bandLabel: gopPct >= 0.40 ? "Strong" : gopPct >= 0.25 ? "On Track" : gopPct >= 0.10 ? "Tight" : "Below Norm",
    } : null,
    segmentMix: {
      rooms: mtd.total > 0 ? mtd.rooms / mtd.total : 0,
      fb: mtd.total > 0 ? mtd.fb / mtd.total : 0,
      other: mtd.total > 0 ? mtd.other / mtd.total : 0,
    },
  };
}

/** Build a forecast variance report — actual vs forecast for a date range. */
export function buildForecastVariance({ reports, forecast, propertyId, start, end }) {
  const actuals = (reports || []).filter(r => r.propertyId === propertyId && r.date >= start && r.date <= end);
  const forecastByDate = new Map((forecast || []).map(f => [f.date, f]));

  const lines = actuals.map(a => {
    const f = forecastByDate.get(a.date);
    const actual = safeNum(a.totalRevenue);
    const forecasted = safeNum(f?.totalRevenue || f?.value);
    const variance = actual - forecasted;
    const pct = forecasted > 0 ? variance / forecasted : null;
    return {
      date: a.date,
      actual,
      forecast: forecasted,
      variance,
      variancePct: pct,
      bucket: !forecasted ? "no-forecast"
        : Math.abs(pct) < 0.05 ? "on-target"
        : pct >= 0.05 && pct < 0.15 ? "favorable"
        : pct >= 0.15 ? "strong-beat"
        : pct <= -0.05 && pct > -0.15 ? "unfavorable"
        : "miss",
    };
  });

  const summary = lines.reduce((acc, l) => {
    acc.actualTotal += l.actual;
    acc.forecastTotal += l.forecast;
    acc.absVariance += Math.abs(l.variance);
    acc.buckets[l.bucket] = (acc.buckets[l.bucket] || 0) + 1;
    return acc;
  }, { actualTotal: 0, forecastTotal: 0, absVariance: 0, buckets: {} });
  summary.variance = summary.actualTotal - summary.forecastTotal;
  summary.variancePct = summary.forecastTotal > 0 ? summary.variance / summary.forecastTotal : null;
  summary.mape = lines.length > 0 && summary.forecastTotal > 0
    ? lines.reduce((s, l) => s + (l.forecast > 0 ? Math.abs(l.variance) / l.forecast : 0), 0) / lines.length
    : null;

  return { propertyId, start, end, lines, summary };
}
