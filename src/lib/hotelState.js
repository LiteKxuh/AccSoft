/* HotelOps · Hotel state engine ("digital twin")
 * =================================================================
 * Continuously-derivable snapshot of a property's operational reality.
 * Pure function over existing state — no extra storage, no mutations.
 *
 * The result is the substrate that:
 *   - Workflow rules evaluate against ("if occupancy > 92% and labor
 *     coverage < threshold, raise alert")
 *   - AI agents read from (instead of re-deriving each call)
 *   - Executive dashboards render
 *   - Forensics engine compares against historical baselines
 *
 * One snapshot per (property, asOf). Multi-property roll-ups call
 * snapshot() per property and combine.
 *
 * Shape:
 *   {
 *     propertyId, asOf, tier, today: {...}, mtd: {...}, ytd: {...},
 *     ledger: { ap, ar, cashCovered },
 *     labor: { mtdCost, mtdPctRev, todayCost, scheduleDrift },
 *     audit: { health, openFindings },
 *     anomalies: [...],
 *     pace: { rooms, revenueProjection14d },
 *     capex: { spend, budget, overBudget },
 *     approvals: { pendingJE, pendingAP, $ },
 *     compression: boolean,
 *     riskFlags: [...],
 *     coverage: { hasReportToday, hasLaborToday, hasBudget }
 *   }
 */

import { runNightAudit } from "./nightAudit.js";
import { localAnomalies, buildBaseline } from "./aiOps.js";
import { laborKPIs, scheduleVsActual } from "./labor.js";
import { buildPace } from "./paceReport.js";
import { apAging, arAging } from "./aging.js";
import { summarizePortfolio as capexSummary } from "./capex.js";
import { entryTotals } from "./gl.js";
import { toCents, fromCents } from "./money.js";

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }

function classifyTier(adr) {
  if (adr >= 250) return "luxury";
  if (adr >= 170) return "upper-upscale";
  if (adr >= 110) return "upscale";
  if (adr >= 70)  return "midscale";
  return "economy";
}

function dayBefore(iso) {
  const d = new Date(iso); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function monthRange(iso) {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return { start: `${iso.slice(0, 7)}-01`, end: `${iso.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
}

function ytdRange(iso) {
  return { start: `${iso.slice(0, 4)}-01-01`, end: iso };
}

/**
 * @param {object} state
 * @param {object} opts  { propertyId, asOf, enrichReport? }
 */
export function snapshot(state, { propertyId, asOf, enrichReport = null } = {}) {
  if (!propertyId || !asOf) {
    return { propertyId, asOf, status: "missing-input" };
  }
  const enrich = enrichReport || ((r) => r);
  const propReports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
  if (!propReports.length) {
    return { propertyId, asOf, status: "no-reports", coverage: { hasReportToday: false, hasLaborToday: false, hasBudget: false } };
  }

  const today = propReports.find(r => r.date === asOf);
  const yesterday = propReports.find(r => r.date === dayBefore(asOf));
  const mtd = monthRange(asOf);
  const ytd = ytdRange(asOf);

  // Aggregations
  const mtdReports = propReports.filter(r => r.date >= mtd.start && r.date <= asOf);
  const ytdReports = propReports.filter(r => r.date >= ytd.start && r.date <= asOf);

  const sum = (arr, fn) => arr.reduce((s, r) => s + safe(fn(r)), 0);
  const mtdRev = sum(mtdReports, r => r.totalRevenue);
  const mtdRoomsSold = sum(mtdReports, r => r.roomsSold);
  const mtdRoomsAvail = sum(mtdReports, r => r.roomsAvailable);
  const mtdRoomRev = sum(mtdReports, r => r.breakdown?.revenue?.rooms ?? r.roomRevenue);

  const ytdRev = sum(ytdReports, r => r.totalRevenue);
  const ytdRoomsSold = sum(ytdReports, r => r.roomsSold);
  const ytdRoomsAvail = sum(ytdReports, r => r.roomsAvailable);

  const tierAdr = (() => {
    const last30 = propReports.filter(r => r.date < asOf).slice(-30).map(r => safe(r.adr)).filter(v => v > 0).sort((a, b) => a - b);
    return last30.length ? last30[Math.floor(last30.length / 2)] : 0;
  })();
  const tier = classifyTier(tierAdr);

  // Audit health
  const auditResult = today ? runNightAudit(today, state.properties?.find(p => p.id === propertyId)?.settings || null) : null;

  // Anomalies
  const baseline = buildBaseline(propReports, propertyId, asOf);
  const anomalyList = today ? localAnomalies(today, baseline) : [];

  // Labor — filter state slices by property first since laborKPIs takes flat collections
  const shifts = (state.shifts || []).filter(s => !s.propertyId || s.propertyId === propertyId);
  const schedule = (state.schedule || []).filter(s => !s.propertyId || s.propertyId === propertyId);
  const payrollRunsForProp = (state.payrollRuns || []).filter(r => !r.propertyId || r.propertyId === propertyId);
  const employees = state.employees || [];
  const propReportsForLabor = propReports;
  const mtdLaborKpi = laborKPIs({ shifts, schedule, payrollRuns: payrollRunsForProp, employees, reports: propReportsForLabor, start: mtd.start, end: asOf });
  const todayLaborKpi = laborKPIs({ shifts, schedule, payrollRuns: payrollRunsForProp, employees, reports: propReportsForLabor, start: asOf, end: asOf });
  const driftMtd = scheduleVsActual({ shifts, schedule, employees, start: mtd.start, end: asOf });

  // Ledger snapshots
  const ap = apAging({
    invoices: state.invoices || [], vendors: state.vendors || [], propIds: [propertyId], asOf: new Date(asOf),
  });
  const ar = arAging({ reports: state.reports || [], propIds: [propertyId], asOf: new Date(asOf), enrich });

  // Cash covered = sum of bank account balances. Approximate via posted JEs touching isBank accounts.
  const chart = state.chartOfAccounts?.length ? state.chartOfAccounts : null;
  const bankCodes = new Set((chart || []).filter(a => a.isBank).map(a => a.code));
  const cashCents = bankCodes.size > 0
    ? (state.journalEntries || [])
        .filter(j => j.posted && !j.void && j.propertyId === propertyId && j.date <= asOf)
        .reduce((s, j) => {
          let lineSum = 0;
          for (const l of (j.lines || [])) {
            if (bankCodes.has(String(l.accountCode))) {
              lineSum += toCents(l.debit) - toCents(l.credit);
            }
          }
          return s + lineSum;
        }, 0)
    : 0;

  // Approvals queue
  const pendingJEs = (state.journalEntries || []).filter(e =>
    !e.void && e.posted && e.approvalState === "pending" && e.propertyId === propertyId
  );
  const pendingAP = (state.invoices || []).filter(i => i.propertyId === propertyId && i.approvalState === "pending" && i.status !== "void");
  const pendingDollar = pendingJEs.reduce((s, e) => s + entryTotals(e).debit, 0) + pendingAP.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  // Pace
  let pace = null;
  try {
    pace = buildPace({ reports: propReports, asOf, options: { horizon: 14 } });
  } catch { pace = null; }

  // Capex
  const capex = capexSummary(state.capexProjects || [], propertyId);

  // Compression detection: forward 7-day projected occupancy median > tier cap × 0.95
  let compression = false;
  if (pace?.status === "ok") {
    const next7 = pace.forward.slice(0, 7).map(p => p.projectedOccupancy).filter(v => v > 0).sort((a, b) => a - b);
    if (next7.length) {
      const medianFwd = next7[Math.floor(next7.length / 2)];
      compression = medianFwd >= (pace.market.occCap || 0.95) * 0.95;
    }
  }

  // Coverage
  const coverage = {
    hasReportToday: !!today,
    hasLaborToday: (state.shifts || []).some(s => s.propertyId === propertyId && (s.clockIn || s.date || "").slice(0, 10) === asOf),
    hasBudget: !!(state.budgets || []).find(b => b.propertyId === propertyId && b.month === asOf.slice(0, 7)),
    hasOwnership: ((state.ownerships || []).filter(o => o.propertyId === propertyId).length > 0),
  };

  // Aggregate risk flags
  const riskFlags = [];
  if (auditResult && auditResult.status === "fail") riskFlags.push({ code: "audit.fail", severity: "high", label: "Night audit hard-fail" });
  if (anomalyList.some(a => a.severity === "high")) riskFlags.push({ code: "anomaly.high", severity: "high", label: "High-severity anomaly detected" });
  if (pendingDollar > 50000) riskFlags.push({ code: "approvals.backlog", severity: "medium", label: `$${pendingDollar.toFixed(0)} pending approval` });
  if (mtdRev > 0 && (mtdLaborKpi?.laborCost / mtdRev) > 0.40) riskFlags.push({ code: "labor.high", severity: "medium", label: `Labor ${(((mtdLaborKpi?.laborCost || 0) / mtdRev) * 100).toFixed(0)}% of revenue` });
  if (ap.totals.b120 > 0) riskFlags.push({ code: "ap.over120", severity: "medium", label: `${ap.totals.b120.toFixed(0)} A/P over 120 days` });
  if (capex.statusCounts?.overBudget > 0) riskFlags.push({ code: "capex.overbudget", severity: "medium", label: `${capex.statusCounts.overBudget} CapEx project(s) over budget` });
  if (compression) riskFlags.push({ code: "compression", severity: "low", label: "Forward compression detected — review pricing controls" });

  const totalScheduled = (driftMtd?.rows || []).reduce((s, r) => s + (r.scheduled || 0), 0);
  const totalActual = (driftMtd?.rows || []).reduce((s, r) => s + (r.actual || 0), 0);
  return {
    propertyId,
    asOf,
    tier,
    status: "ok",
    today: today ? {
      revenue: safe(today.totalRevenue),
      rooms: safe(today.breakdown?.revenue?.rooms ?? today.roomRevenue),
      roomsSold: safe(today.roomsSold),
      roomsAvailable: safe(today.roomsAvailable),
      occupancy: safe(today.occupancy),
      adr: safe(today.adr),
      revpar: safe(today.revpar),
    } : null,
    yesterday: yesterday ? {
      revenue: safe(yesterday.totalRevenue),
      occupancy: safe(yesterday.occupancy),
      adr: safe(yesterday.adr),
    } : null,
    mtd: {
      revenue: mtdRev,
      roomsSold: mtdRoomsSold,
      roomsAvailable: mtdRoomsAvail,
      occupancy: mtdRoomsAvail > 0 ? mtdRoomsSold / mtdRoomsAvail : 0,
      adr: mtdRoomsSold > 0 ? mtdRoomRev / mtdRoomsSold : 0,
      revpar: mtdRoomsAvail > 0 ? mtdRoomRev / mtdRoomsAvail : 0,
    },
    ytd: {
      revenue: ytdRev,
      roomsSold: ytdRoomsSold,
      roomsAvailable: ytdRoomsAvail,
      occupancy: ytdRoomsAvail > 0 ? ytdRoomsSold / ytdRoomsAvail : 0,
    },
    ledger: {
      ap: ap.totals,
      ar: ar.totals,
      apOver120: ap.totals.b120 || 0,
      cashCovered: fromCents(cashCents),
    },
    labor: {
      mtdCost: mtdLaborKpi?.laborCost || 0,
      mtdPctRev: mtdRev > 0 ? (mtdLaborKpi?.laborCost || 0) / mtdRev : 0,
      todayCost: todayLaborKpi?.laborCost || 0,
      scheduledHours: totalScheduled,
      actualHours: totalActual,
      driftPct: totalScheduled > 0 ? (totalActual - totalScheduled) / totalScheduled : 0,
    },
    audit: auditResult ? { score: auditResult.score, status: auditResult.status, failureCount: auditResult.checks.filter(c => c.status === "fail").length, warningCount: auditResult.checks.filter(c => c.status === "warn").length } : null,
    anomalies: anomalyList,
    pace: pace?.status === "ok" ? {
      market: pace.market,
      projection7: pace.projection.d7,
      projection14: pace.projection.d14,
      pickupRooms: pace.pickup?.rooms || 0,
      washFactor: pace.washFactor,
    } : null,
    capex,
    approvals: {
      pendingJE: pendingJEs.length,
      pendingAP: pendingAP.length,
      pendingDollar,
    },
    compression,
    riskFlags,
    coverage,
  };
}

/** Build snapshots for every accessible property; useful for executive views. */
export function portfolioSnapshot(state, { propertyIds, asOf, enrichReport = null } = {}) {
  return (propertyIds || []).map(pid => snapshot(state, { propertyId: pid, asOf, enrichReport }));
}

/** "What changed overnight" — diff today's snapshot vs yesterday's. */
export function overnightDelta(state, { propertyId, asOf, enrichReport = null }) {
  const today = snapshot(state, { propertyId, asOf, enrichReport });
  const yest = snapshot(state, { propertyId, asOf: dayBefore(asOf), enrichReport });
  if (today.status !== "ok" || yest.status !== "ok" || !today.today || !yest.today) {
    return { propertyId, asOf, status: "insufficient-history" };
  }
  const d = {
    revenue: (today.today?.revenue || 0) - (yest.today?.revenue || 0),
    occupancy: (today.today?.occupancy || 0) - (yest.today?.occupancy || 0),
    adr: (today.today?.adr || 0) - (yest.today?.adr || 0),
    apPending: today.approvals.pendingAP - yest.approvals.pendingAP,
    jePending: today.approvals.pendingJE - yest.approvals.pendingJE,
    auditScore: (today.audit?.score || 0) - (yest.audit?.score || 0),
    newRiskFlags: today.riskFlags.filter(t => !yest.riskFlags.find(y => y.code === t.code)),
    resolvedRiskFlags: yest.riskFlags.filter(y => !today.riskFlags.find(t => t.code === y.code)),
  };
  return { propertyId, asOf, status: "ok", delta: d, today, yesterday: yest };
}
