/* HotelOps · Profitability Intelligence Engine
 * =================================================================
 * Identifies hidden profit opportunities. The Revenue AI engine moves
 * the top line; this one optimizes what falls through to the bottom.
 *
 *   - GOP optimization (which lines can be trimmed without revenue impact)
 *   - margin leakage detection (cost growing faster than revenue)
 *   - departmental efficiency scoring (rooms/F&B/A&G/maintenance)
 *   - cost-per-occupied-room analysis (CPOR by category, vs benchmark)
 *   - labor productivity scoring (rooms attended, F&B covers per labor hr)
 *   - OTA acquisition cost vs direct profitability
 *   - hidden opportunity ranking
 *
 * Pure functions. Reads from the existing ledger + reports + (optional)
 * shifts/payroll for labor productivity.
 *
 * Tier-aware benchmarks (USALI):
 *   economy:        labor 22%, F&B COGS 32%, AG 9%
 *   midscale:       labor 28%, F&B COGS 30%, AG 10%
 *   upscale:        labor 32%, F&B COGS 28%, AG 11%
 *   upper-upscale:  labor 35%, F&B COGS 28%, AG 12%
 *   luxury:         labor 38%, F&B COGS 28%, AG 13%
 */

import { toCents, fromCents } from "./money.js";
import { CATEGORY_ACCOUNTS, buildCpor } from "./costIntelligence.js";

const TIER_BENCHMARK = {
  economy:        { labor: 0.22, fbCogs: 0.32, ag: 0.09, supplies: 0.04, gop: 0.42 },
  midscale:       { labor: 0.28, fbCogs: 0.30, ag: 0.10, supplies: 0.05, gop: 0.38 },
  upscale:        { labor: 0.32, fbCogs: 0.28, ag: 0.11, supplies: 0.06, gop: 0.34 },
  "upper-upscale":{ labor: 0.35, fbCogs: 0.28, ag: 0.12, supplies: 0.06, gop: 0.30 },
  luxury:         { labor: 0.38, fbCogs: 0.28, ag: 0.13, supplies: 0.07, gop: 0.26 },
};

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function pct(n) { return Math.round(n * 1000) / 10; }
function classifyTier(adr) {
  if (adr >= 250) return "luxury";
  if (adr >= 170) return "upper-upscale";
  if (adr >= 110) return "upscale";
  if (adr >= 70)  return "midscale";
  return "economy";
}

function sumLines(ledger, accountCodes, propertyId, start, end) {
  const codes = new Set(accountCodes.map(String));
  let cents = 0;
  for (const e of (ledger || [])) {
    if (!e.posted || e.void) continue;
    if (propertyId && e.propertyId && e.propertyId !== propertyId) continue;
    if (start && e.date < start) continue;
    if (end && e.date > end) continue;
    for (const l of (e.lines || [])) {
      if (codes.has(String(l.accountCode))) cents += toCents(l.debit) - toCents(l.credit);
    }
  }
  return fromCents(cents);
}

function totalRev(reports, propertyId, start, end) {
  return (reports || []).reduce((s, r) => {
    if (propertyId && r.propertyId !== propertyId) return s;
    if (start && r.date < start) return s;
    if (end && r.date > end) return s;
    return s + safe(r.totalRevenue);
  }, 0);
}

function roomsSold(reports, propertyId, start, end) {
  return (reports || []).reduce((s, r) => {
    if (propertyId && r.propertyId !== propertyId) return s;
    if (start && r.date < start) return s;
    if (end && r.date > end) return s;
    return s + safe(r.roomsSold);
  }, 0);
}

function medianAdr(reports, propertyId) {
  const adrs = (reports || [])
    .filter(r => (!propertyId || r.propertyId === propertyId) && safe(r.adr) > 0)
    .map(r => safe(r.adr))
    .sort((a, b) => a - b);
  if (!adrs.length) return 0;
  return adrs[Math.floor(adrs.length / 2)];
}

/* ---------- GOP optimization ---------- */

/**
 * Compute current GOP-side cost structure and compare each line to tier
 * benchmark. Return which lines have headroom (could be trimmed) vs which
 * are tight (cutting risks service quality).
 */
export function analyzeGopOptimization({ ledger = [], reports = [], propertyId = null, period = null, laborCost = null } = {}) {
  const { start = null, end = null } = period || {};
  const rev = totalRev(reports, propertyId, start, end);
  if (rev <= 0) return { status: "no-revenue" };
  const adr = medianAdr(reports, propertyId);
  const tier = classifyTier(adr);
  const bench = TIER_BENCHMARK[tier];

  // Cost lines pulled from CATEGORY_ACCOUNTS
  const fbCogs = sumLines(ledger, CATEGORY_ACCOUNTS.fb_cost, propertyId, start, end);
  const supplies = sumLines(ledger, CATEGORY_ACCOUNTS.supplies, propertyId, start, end);
  const ag = sumLines(ledger, CATEGORY_ACCOUNTS.ag, propertyId, start, end);
  const utilities = sumLines(ledger, CATEGORY_ACCOUNTS.utilities, propertyId, start, end);
  const maint = sumLines(ledger, CATEGORY_ACCOUNTS.maintenance, propertyId, start, end);

  const lines = [
    { line: "labor",    actual: safe(laborCost), benchmarkPct: bench.labor,    actualPct: rev > 0 ? safe(laborCost) / rev : null },
    { line: "fbCogs",   actual: fbCogs,          benchmarkPct: bench.fbCogs,   actualPct: rev > 0 ? fbCogs / rev : null },
    { line: "ag",       actual: ag,              benchmarkPct: bench.ag,       actualPct: rev > 0 ? ag / rev : null },
    { line: "supplies", actual: supplies,        benchmarkPct: bench.supplies, actualPct: rev > 0 ? supplies / rev : null },
    { line: "utilities", actual: utilities,      benchmarkPct: 0.06,           actualPct: rev > 0 ? utilities / rev : null },
    { line: "maintenance", actual: maint,        benchmarkPct: 0.045,          actualPct: rev > 0 ? maint / rev : null },
  ];

  const opportunities = [];
  for (const ln of lines) {
    if (ln.actualPct == null || ln.actual == null) continue;
    const diff = ln.actualPct - ln.benchmarkPct;
    ln.overUnderPct = round2(diff * 100);
    ln.dollarsAtRisk = round2(diff * rev);
    if (diff > 0.01) {
      opportunities.push({
        code: `gop.${ln.line}.over`,
        severity: diff > 0.05 ? "high" : diff > 0.03 ? "medium" : "low",
        line: ln.line,
        actualPct: round2(ln.actualPct),
        benchmarkPct: ln.benchmarkPct,
        dollarsAtRisk: round2(diff * rev),
        rationale: `${ln.line} at ${pct(ln.actualPct)}% vs benchmark ${pct(ln.benchmarkPct)}% — opportunity ~$${round2(diff * rev).toFixed(0)}.`,
      });
    }
  }
  opportunities.sort((a, b) => b.dollarsAtRisk - a.dollarsAtRisk);

  // Aggregate GOP estimate (revenue - the lines above)
  const totalCost = lines.reduce((s, ln) => s + safe(ln.actual), 0);
  const gop = rev - totalCost;
  const gopPct = gop / rev;
  return {
    status: "ok",
    tier,
    period,
    revenue: round2(rev),
    totalCost: round2(totalCost),
    gop: round2(gop),
    gopPct: round2(gopPct),
    benchmarkGopPct: bench.gop,
    gopGap: round2(bench.gop - gopPct),
    lines: lines.map(l => ({ ...l, actual: round2(l.actual || 0) })),
    opportunities,
  };
}

/* ---------- Margin leakage detection ---------- */

/**
 * For each month in the trailing window, compute (cost growth rate) vs
 * (revenue growth rate). If cost grows faster than revenue 2+ months, leak.
 */
export function detectMarginLeakage({ ledger = [], reports = [], propertyId = null, monthsBack = 6 } = {}) {
  const today = new Date();
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const rev = totalRev(reports, propertyId, start, end);
    // Cost: all 5xxx + 6xxx categories combined
    const fb = sumLines(ledger, CATEGORY_ACCOUNTS.fb_cost, propertyId, start, end);
    const ag = sumLines(ledger, CATEGORY_ACCOUNTS.ag, propertyId, start, end);
    const sup = sumLines(ledger, CATEGORY_ACCOUNTS.supplies, propertyId, start, end);
    const util = sumLines(ledger, CATEGORY_ACCOUNTS.utilities, propertyId, start, end);
    const maint = sumLines(ledger, CATEGORY_ACCOUNTS.maintenance, propertyId, start, end);
    const cost = fb + ag + sup + util + maint;
    months.push({ month: start.slice(0, 7), revenue: round2(rev), cost: round2(cost) });
  }
  // Compute MoM growth rates
  const growth = [];
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1], cur = months[i];
    const revGrowth = prev.revenue > 0 ? (cur.revenue - prev.revenue) / prev.revenue : null;
    const costGrowth = prev.cost > 0 ? (cur.cost - prev.cost) / prev.cost : null;
    growth.push({
      month: cur.month,
      revGrowth: revGrowth == null ? null : round2(revGrowth),
      costGrowth: costGrowth == null ? null : round2(costGrowth),
      leakage: revGrowth != null && costGrowth != null && costGrowth > revGrowth + 0.01,
    });
  }
  const leakMonths = growth.filter(g => g.leakage).length;
  return {
    status: "ok",
    months,
    growth,
    leakageMonths: leakMonths,
    verdict: leakMonths >= 2 ? "leaking" : leakMonths === 1 ? "watch" : "stable",
    explanation: leakMonths >= 2
      ? `Costs outpaced revenue in ${leakMonths} of the last ${growth.length} months — investigate variable cost discipline.`
      : "Cost growth tracking revenue.",
  };
}

/* ---------- Departmental efficiency scoring ---------- */

/**
 * Score each department 0-100 against tier benchmarks. Departments with
 * a score below 60 surface as "underperforming."
 */
export function scoreDepartmentalEfficiency({ ledger = [], reports = [], propertyId = null, period = null, laborCost = null } = {}) {
  const gop = analyzeGopOptimization({ ledger, reports, propertyId, period, laborCost });
  if (gop.status !== "ok") return gop;
  const out = gop.lines.map(ln => {
    if (ln.actualPct == null) return { line: ln.line, score: null, status: "no-data" };
    // Score = 100 if at or below benchmark, scales down as you go over
    let score = 100;
    if (ln.actualPct > ln.benchmarkPct) {
      const ratio = ln.actualPct / ln.benchmarkPct;
      score = Math.max(0, Math.round(100 - (ratio - 1) * 100));
    }
    return {
      line: ln.line,
      actualPct: round2(ln.actualPct),
      benchmarkPct: ln.benchmarkPct,
      score,
      status: score >= 80 ? "strong" : score >= 60 ? "watch" : "underperforming",
    };
  });
  const valid = out.filter(o => typeof o.score === "number");
  const avg = valid.length ? Math.round(valid.reduce((s, o) => s + o.score, 0) / valid.length) : null;
  return {
    status: "ok",
    tier: gop.tier,
    revenue: gop.revenue,
    departments: out,
    averageScore: avg,
    underperforming: out.filter(o => o.status === "underperforming").map(o => o.line),
  };
}

/* ---------- Labor productivity scoring ---------- */

/**
 * Compute rooms-per-attendant and revenue-per-labor-hour over the period.
 * Compares against industry-tier productivity expectations.
 */
export function scoreLaborProductivity({ shifts = [], reports = [], propertyId = null, period = null } = {}) {
  const { start = null, end = null } = period || {};
  const inWin = (d) => (!start || d >= start) && (!end || d <= end);
  const propShifts = (shifts || []).filter(s => (!propertyId || s.propertyId === propertyId));
  const totalHours = propShifts.reduce((sum, s) => {
    if (!s.clockIn) return sum;
    const date = String(s.clockIn).slice(0, 10);
    if (!inWin(date)) return sum;
    if (!s.clockOut) return sum;
    const hrs = (new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime()) / 3_600_000;
    return sum + Math.max(0, hrs);
  }, 0);
  const totalRooms = roomsSold(reports, propertyId, start, end);
  const totalRevenue = totalRev(reports, propertyId, start, end);
  if (totalHours <= 0 || totalRooms <= 0) return { status: "insufficient-data" };

  const roomsPerLaborHour = totalRooms / totalHours;
  const revenuePerLaborHour = totalRevenue / totalHours;
  // Benchmark: midscale → 0.25 rooms-per-hr, $80 rev/hr
  const benchRoomsPerHr = 0.22;
  const benchRevPerHr = 90;
  return {
    status: "ok",
    totalHours: round2(totalHours),
    totalRooms,
    totalRevenue: round2(totalRevenue),
    roomsPerLaborHour: round2(roomsPerLaborHour),
    revenuePerLaborHour: round2(revenuePerLaborHour),
    benchmark: { roomsPerLaborHour: benchRoomsPerHr, revenuePerLaborHour: benchRevPerHr },
    verdict: roomsPerLaborHour < benchRoomsPerHr * 0.8 ? "low-productivity"
           : roomsPerLaborHour > benchRoomsPerHr * 1.2 ? "high-productivity"
           : "on-track",
  };
}

/* ---------- OTA acquisition cost ---------- */

const DEFAULT_OTA_COMMISSION = 0.18;
const DIRECT_BOOKING_COST = 0.02;

export function analyzeOtaProfitability({ reports = [], period = null, propertyId = null, otaCommission = DEFAULT_OTA_COMMISSION } = {}) {
  const { start = null, end = null } = period || {};
  const inWin = (d) => (!start || d >= start) && (!end || d <= end);
  const items = (reports || []).filter(r => (!propertyId || r.propertyId === propertyId) && inWin(r.date));
  let otaRev = 0, directRev = 0;
  for (const r of items) {
    const segs = r.breakdown?.segments;
    if (!segs) continue;
    for (const [seg, vals] of Object.entries(segs)) {
      const rev = safe(vals?.revenue);
      if (/(ota|expedia|booking|priceline|agoda|airbnb)/i.test(seg)) otaRev += rev;
      else if (/direct|brand/i.test(seg)) directRev += rev;
    }
  }
  if (otaRev === 0 && directRev === 0) return { status: "no-segment-data" };
  const otaCost = otaRev * otaCommission;
  const directCost = directRev * DIRECT_BOOKING_COST;
  // What if you shifted 25% of OTA → direct?
  const shiftableRev = otaRev * 0.25;
  const savings = shiftableRev * (otaCommission - DIRECT_BOOKING_COST);
  return {
    status: "ok",
    otaRevenue: round2(otaRev),
    otaCost: round2(otaCost),
    directRevenue: round2(directRev),
    directCost: round2(directCost),
    netOtaContribution: round2(otaRev - otaCost),
    netDirectContribution: round2(directRev - directCost),
    shiftOpportunity: { shiftableRevenue: round2(shiftableRev), savings: round2(savings) },
    recommendation: savings > 5_000
      ? `Shifting 25% of OTA volume to direct would save ~$${round2(savings).toFixed(0)} in commission.`
      : null,
  };
}

/* ---------- Hidden opportunity ranking ---------- */

/**
 * Aggregate every signal into a ranked profit-opportunity list.
 */
export function rankProfitOpportunities({ ledger = [], reports = [], shifts = [], propertyId = null, period = null, laborCost = null } = {}) {
  const opps = [];
  const gop = analyzeGopOptimization({ ledger, reports, propertyId, period, laborCost });
  if (gop.status === "ok") {
    for (const o of gop.opportunities) {
      opps.push({ ...o, source: "gop-optimization" });
    }
  }
  const leak = detectMarginLeakage({ ledger, reports, propertyId });
  if (leak.status === "ok" && leak.verdict === "leaking") {
    opps.push({
      code: "margin.leaking",
      severity: "high",
      label: `Margin leakage detected (${leak.leakageMonths} months)`,
      rationale: leak.explanation,
      dollarsAtRisk: null,
      source: "margin-leakage",
    });
  }
  const ota = analyzeOtaProfitability({ reports, period, propertyId });
  if (ota.status === "ok" && (ota.shiftOpportunity?.savings || 0) > 5_000) {
    opps.push({
      code: "ota.shift",
      severity: "medium",
      label: `Shift 25% OTA → direct for ~$${ota.shiftOpportunity.savings.toFixed(0)} savings`,
      rationale: ota.recommendation,
      dollarsAtRisk: ota.shiftOpportunity.savings,
      source: "ota-profitability",
    });
  }
  const lp = scoreLaborProductivity({ shifts, reports, propertyId, period });
  if (lp.status === "ok" && lp.verdict === "low-productivity") {
    opps.push({
      code: "labor.productivity.low",
      severity: "medium",
      label: `Low labor productivity: ${lp.roomsPerLaborHour} rooms/labor-hr vs ${lp.benchmark.roomsPerLaborHour} bench`,
      rationale: "Review scheduling and rooms-per-attendant targets.",
      source: "labor-productivity",
    });
  }
  // Sort by dollarsAtRisk descending; severity tiebreak
  const sevRank = { high: 3, medium: 2, low: 1 };
  opps.sort((a, b) => {
    const sevDiff = (sevRank[b.severity] || 1) - (sevRank[a.severity] || 1);
    if (sevDiff !== 0) return sevDiff;
    return (b.dollarsAtRisk || 0) - (a.dollarsAtRisk || 0);
  });
  return {
    status: "ok",
    opportunities: opps,
    summary: {
      total: opps.length,
      high: opps.filter(o => o.severity === "high").length,
      medium: opps.filter(o => o.severity === "medium").length,
      totalDollarsAtRisk: round2(opps.reduce((s, o) => s + (o.dollarsAtRisk || 0), 0)),
    },
  };
}

/* ---------- Aggregated runner ---------- */

export function runProfitability({ state, propertyId, period, laborCost = null } = {}) {
  const ledger = (state.journalEntries || []).filter(j => j.posted && !j.void);
  const reports = state.reports || [];
  const shifts = state.shifts || [];
  return {
    propertyId,
    period,
    gop: analyzeGopOptimization({ ledger, reports, propertyId, period, laborCost }),
    marginLeakage: detectMarginLeakage({ ledger, reports, propertyId }),
    departmentalEfficiency: scoreDepartmentalEfficiency({ ledger, reports, propertyId, period, laborCost }),
    laborProductivity: scoreLaborProductivity({ shifts, reports, propertyId, period }),
    otaProfitability: analyzeOtaProfitability({ reports, period, propertyId }),
    opportunities: rankProfitOpportunities({ ledger, reports, shifts, propertyId, period, laborCost }),
    runAt: new Date().toISOString(),
  };
}

export { TIER_BENCHMARK };
