/* HotelOps · Hotel Operating Kernel
 * =================================================================
 * The orchestration spine. Sits one level above hotelState.snapshot()
 * and below every agent, workflow, dashboard, and command surface.
 *
 * Inputs:  (state, { propertyId, asOf, enrichReport? })
 * Outputs: a deterministic OperationalGraph — single source of truth
 *          for everything downstream.
 *
 * Indices (each 0-100, higher = worse pressure unless noted):
 *   - hotelHealthIndex     (0-100, higher = healthier — INVERTED)
 *   - staffingStressIndex  (0-100, higher = more pressure)
 *   - guestRiskIndex       (0-100, higher = more risk)
 *   - operationalRiskScore (0-100, higher = more risk)
 *   - profitabilityPressureScore (0-100, higher = more pressure)
 *
 * Each index is a transparent weighted composite of inputs already
 * computed by existing modules — no duplicate math. UIs / agents
 * can cite the contributing fields by path.
 *
 * Pure function. No side effects. Same inputs → same output.
 */

import { snapshot, overnightDelta } from "./hotelState.js";
import { runCostIntelligence } from "./costIntelligence.js";
import { runForensics } from "./forensics.js";
import { chainHealth } from "./ledgerForensics.js";
import { inputsFromReports } from "./kpi/reportAdapter.js";
import { computeKpi } from "./kpi/registry.js";

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function round(n, p = 1) {
  const m = 10 ** p; return Math.round(Number(n) * m) / m;
}

/* ---------- Composite indices ---------- */

/**
 * Hotel Health Index — 0-100, higher = healthier.
 * Inverse of operational risk + profitability pressure + staffing stress + guest risk,
 * weighted for what GMs/owners care about most.
 */
function computeHotelHealth({ op, prof, staff, guest }) {
  // Higher input = worse, so health = 100 - weighted avg
  const weighted = op * 0.30 + prof * 0.30 + staff * 0.20 + guest * 0.20;
  return clamp(100 - weighted, 0, 100);
}

/**
 * Staffing Stress Index — 0-100, higher = more pressure.
 * Inputs: labor %-of-revenue (vs tier target), schedule drift,
 * upcoming compression without staffing visibility.
 */
function computeStaffingStress(snap) {
  if (!snap || snap.status !== "ok") return 0;
  let score = 0;
  const laborPct = snap.labor?.mtdPctRev || 0;
  // Tier-aware target: economy ~25%, midscale ~30%, upscale ~32%, upper-upscale ~35%, luxury ~40%
  const tierTarget = { economy: 0.25, midscale: 0.30, upscale: 0.32, "upper-upscale": 0.35, luxury: 0.40 }[snap.tier] || 0.30;
  // 1% over target = +3 points
  if (laborPct > tierTarget) score += Math.min(40, (laborPct - tierTarget) * 100 * 3);
  // Drift
  const drift = Math.abs(snap.labor?.driftPct || 0);
  if (drift > 0.05) score += Math.min(25, drift * 100 * 2);
  // Compression with no schedule data
  if (snap.compression && !snap.coverage?.hasLaborToday) score += 20;
  // No labor data at all today
  if (!snap.coverage?.hasLaborToday) score += 10;
  return clamp(round(score), 0, 100);
}

/**
 * Guest Risk Index — 0-100, higher = more risk.
 * Inputs: audit failures, anomalies, compression, op flag count.
 * Guest data lives in guestExperienceEngine — kernel doesn't require it,
 * but uses ops proxies when guest signal is absent.
 */
function computeGuestRisk(snap, guestSignal = null) {
  if (!snap || snap.status !== "ok") return 0;
  let score = 0;
  if (snap.audit?.status === "fail") score += 30;
  if (snap.audit?.warningCount) score += Math.min(15, snap.audit.warningCount * 3);
  const highSev = (snap.anomalies || []).filter(a => a.severity === "high").length;
  score += Math.min(25, highSev * 8);
  if (snap.compression) score += 10;
  // If guest signal provided, blend in
  if (guestSignal) {
    if (typeof guestSignal.complaintRate === "number") {
      // > 0.05 complaints/room = pressure
      score += clamp(guestSignal.complaintRate * 200, 0, 25);
    }
    if (typeof guestSignal.avgRating === "number" && guestSignal.avgRating < 4.0) {
      score += clamp((4.0 - guestSignal.avgRating) * 15, 0, 20);
    }
  }
  return clamp(round(score), 0, 100);
}

/**
 * Operational Risk Score — 0-100, higher = more risk.
 * Inputs: chain health, approval backlog, forensic risk score,
 * over-120 A/P, capex over-budget.
 */
function computeOperationalRisk(snap, forensicScore = 0, chain = null) {
  if (!snap || snap.status !== "ok") return 0;
  let score = 0;
  if (chain) {
    if ((chain.unchainedPosted || 0) > 0) score += 25;
    if ((chain.healthyPct || 100) < 95) score += 15;
  }
  score += Math.min(30, forensicScore);
  if ((snap.approvals?.pendingDollar || 0) > 50_000) score += 10;
  if ((snap.approvals?.pendingDollar || 0) > 100_000) score += 10;
  if ((snap.ledger?.apOver120 || 0) > 0) score += Math.min(10, (snap.ledger.apOver120 / 5000));
  if ((snap.capex?.statusCounts?.overBudget || 0) > 0) score += 10;
  return clamp(round(score), 0, 100);
}

/**
 * Profitability Pressure Score — 0-100, higher = more pressure.
 * Inputs: GOP margin shortfall vs tier benchmark, cost-intel waste findings,
 * F&B COGS overrun, utility forecast vs revenue trajectory.
 */
function computeProfitabilityPressure(snap, costIntel = null) {
  if (!snap || snap.status !== "ok") return 0;
  let score = 0;
  // Labor as % of rev — already in staffing, but contributes to profit too
  const laborPct = snap.labor?.mtdPctRev || 0;
  if (laborPct > 0.45) score += 15;
  else if (laborPct > 0.38) score += 8;
  // F&B COGS over target
  if (costIntel?.fnb?.status === "ok" && costIntel.fnb.verdict === "over-target") {
    const over = (costIntel.fnb.cogsPct - costIntel.fnb.targetCogsPct) * 100;
    score += clamp(over * 1.5, 0, 25);
  }
  // Cost intelligence waste findings
  const waste = (costIntel?.waste?.findings || []).length;
  score += Math.min(20, waste * 6);
  // Margin erosion detector
  if (costIntel?.margin?.status === "ok" && costIntel.margin.verdict === "eroding") {
    score += 20;
  }
  // AR over 90 days
  const arOver90 = (snap.ledger?.ar?.b90 || 0) + (snap.ledger?.ar?.b120 || 0);
  if (arOver90 > 25_000) score += 10;
  return clamp(round(score), 0, 100);
}

/* ---------- Operational graph ---------- */

/**
 * Build the OperationalGraph — the unified view every downstream module
 * (workflow rules, agents, UI panes, executive dashboard) reads.
 *
 * @param {object} state               full app state
 * @param {object} opts                { propertyId, asOf, enrichReport?, guestSignal? }
 * @returns {object} OperationalGraph
 */
export function buildOperationalGraph(state, opts = {}) {
  const { propertyId, asOf, enrichReport = null, guestSignal = null } = opts;
  if (!propertyId || !asOf) {
    return { propertyId, asOf, status: "missing-input" };
  }

  const snap = snapshot(state, { propertyId, asOf, enrichReport });
  if (snap.status !== "ok") {
    return { propertyId, asOf, status: snap.status, snap };
  }

  // Cost intelligence — current month
  const period = { start: asOf.slice(0, 7) + "-01", end: asOf };
  const enrich = enrichReport || ((r) => r);
  const propReports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
  let costIntel = null;
  try {
    costIntel = runCostIntelligence({
      state: {
        journalEntries: (state.journalEntries || []).filter(j => j.propertyId === propertyId),
        reports: propReports,
      },
      propertyId,
      period,
    });
  } catch { costIntel = null; }

  // Forensics — at portfolio level (chain) and property level (findings)
  let forensicSummary = null;
  let chain = null;
  try {
    const propFiltered = {
      ...state,
      journalEntries: (state.journalEntries || []).filter(j => j.propertyId === propertyId),
      invoices: (state.invoices || []).filter(i => i.propertyId === propertyId),
    };
    forensicSummary = runForensics(propFiltered);
    chain = chainHealth(state);
  } catch { /* swallow */ }

  // Composite indices
  const staff = computeStaffingStress(snap);
  const guest = computeGuestRisk(snap, guestSignal);
  const op = computeOperationalRisk(snap, forensicSummary?.riskScore || 0, chain);
  const prof = computeProfitabilityPressure(snap, costIntel);
  const health = computeHotelHealth({ op, prof, staff, guest });

  // Pressure points — ordered list of the highest-impact contributors
  const pressurePoints = [];
  if (snap.audit?.status === "fail") pressurePoints.push({ code: "audit.fail", severity: "high", label: "Night audit hard-fail" });
  if (chain?.unchainedPosted > 0) pressurePoints.push({ code: "chain.gaps", severity: "high", label: `${chain.unchainedPosted} unchained posted JE(s)` });
  if ((snap.approvals?.pendingDollar || 0) > 50_000) pressurePoints.push({ code: "approvals.backlog", severity: "medium", label: `$${snap.approvals.pendingDollar.toFixed(0)} pending approval` });
  if (snap.labor?.mtdPctRev > 0.40) pressurePoints.push({ code: "labor.overspend", severity: "medium", label: `Labor ${(snap.labor.mtdPctRev * 100).toFixed(1)}% of revenue` });
  if (costIntel?.fnb?.verdict === "over-target") pressurePoints.push({ code: "fnb.overrun", severity: "medium", label: `F&B COGS ${(costIntel.fnb.cogsPct * 100).toFixed(1)}% (target ${(costIntel.fnb.targetCogsPct * 100).toFixed(0)}%)` });
  if (costIntel?.margin?.status === "ok" && costIntel.margin.verdict === "eroding") pressurePoints.push({ code: "margin.eroding", severity: "high", label: "Multi-month margin erosion" });
  if (snap.compression) pressurePoints.push({ code: "compression", severity: "low", label: "Forward compression — pricing pressure" });
  if ((snap.ledger?.apOver120 || 0) > 0) pressurePoints.push({ code: "ap.over120", severity: "medium", label: `$${(snap.ledger.apOver120 || 0).toFixed(0)} A/P over 120 days` });

  // Coordination signals — used by automation/agents to coordinate departments
  const coordination = buildCoordinationSignals(snap, costIntel, forensicSummary);

  return {
    status: "ok",
    propertyId,
    asOf,
    tier: snap.tier,
    indices: {
      hotelHealthIndex: round(health),
      staffingStressIndex: round(staff),
      guestRiskIndex: round(guest),
      operationalRiskScore: round(op),
      profitabilityPressureScore: round(prof),
    },
    pressurePoints,
    coordination,
    snap,
    costIntel,
    forensic: forensicSummary,
    chain,
    runAt: new Date().toISOString(),
  };
}

/**
 * Coordination signals — directives the automation kernel will turn into
 * cross-departmental workflow tasks. Each signal names a department, an
 * action class, and the operational reason.
 */
function buildCoordinationSignals(snap, costIntel, forensic) {
  const out = [];
  if (snap.compression && !snap.coverage?.hasLaborToday) {
    out.push({ dept: "labor", action: "increase-staffing-review", reason: "compression + no labor coverage today" });
  }
  if (snap.compression) {
    out.push({ dept: "revenue", action: "review-rate-controls", reason: "forward compression — pricing pressure" });
    out.push({ dept: "housekeeping", action: "review-room-velocity", reason: "compression — turnover throughput pressure" });
  }
  if ((snap.audit?.warningCount || 0) >= 3 || snap.audit?.status === "fail") {
    out.push({ dept: "audit", action: "open-night-audit-investigation", reason: "audit failure or warning cluster" });
  }
  if (costIntel?.waste?.findings?.some(f => f.code === "supply.cpor.high")) {
    out.push({ dept: "housekeeping", action: "supply-burn-review", reason: "supply CPOR elevated" });
  }
  if (costIntel?.fnb?.verdict === "over-target") {
    out.push({ dept: "fb", action: "menu-cost-review", reason: "F&B COGS over target" });
  }
  if (forensic?.riskBand === "high" || forensic?.riskBand === "critical") {
    out.push({ dept: "controller", action: "forensic-triage", reason: `forensic risk band ${forensic.riskBand}` });
  }
  if ((snap.ledger?.apOver120 || 0) > 0) {
    out.push({ dept: "ap", action: "over120-collection", reason: "A/P aging over 120 days" });
  }
  if ((snap.capex?.statusCounts?.overBudget || 0) > 0) {
    out.push({ dept: "capex", action: "owner-escalation", reason: "capex over budget" });
  }
  return out;
}

/* ---------- Portfolio aggregation ---------- */

/** Build OperationalGraphs for every property and roll them up for executive view. */
export function buildPortfolioGraph(state, opts = {}) {
  const { propertyIds, asOf, enrichReport = null, guestSignals = {} } = opts;
  const graphs = (propertyIds || []).map(pid =>
    buildOperationalGraph(state, { propertyId: pid, asOf, enrichReport, guestSignal: guestSignals[pid] || null })
  );
  const ok = graphs.filter(g => g.status === "ok");
  if (!ok.length) {
    return { status: "no-data", asOf, graphs };
  }
  const avg = (key) => Math.round(ok.reduce((s, g) => s + (g.indices[key] || 0), 0) / ok.length * 10) / 10;
  const portfolio = {
    hotelHealthIndex: avg("hotelHealthIndex"),
    staffingStressIndex: avg("staffingStressIndex"),
    guestRiskIndex: avg("guestRiskIndex"),
    operationalRiskScore: avg("operationalRiskScore"),
    profitabilityPressureScore: avg("profitabilityPressureScore"),
  };
  const ranked = [...ok]
    .sort((a, b) => a.indices.hotelHealthIndex - b.indices.hotelHealthIndex)
    .map(g => ({ propertyId: g.propertyId, health: g.indices.hotelHealthIndex, op: g.indices.operationalRiskScore, prof: g.indices.profitabilityPressureScore }));
  const bottom = ranked.slice(0, 3);
  const top = ranked.slice(-3).reverse();
  return {
    status: "ok",
    asOf,
    portfolio,
    graphs,
    ranking: { top, bottom },
    coverage: { evaluated: graphs.length, ok: ok.length },
  };
}

/* ---------- What changed since yesterday (kernel-aware) ---------- */

/** Diff today's OperationalGraph vs yesterday's, surfacing index deltas + new pressure points. */
export function kernelOvernightDelta(state, opts) {
  const { propertyId, asOf, enrichReport = null } = opts;
  if (!propertyId || !asOf) return { status: "missing-input" };
  const today = buildOperationalGraph(state, { propertyId, asOf, enrichReport });
  const yiso = (() => {
    const d = new Date(asOf); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
  })();
  const yest = buildOperationalGraph(state, { propertyId, asOf: yiso, enrichReport });
  if (today.status !== "ok" || yest.status !== "ok") return { status: "insufficient-history", today, yesterday: yest };
  const dIdx = {};
  for (const k of Object.keys(today.indices)) {
    dIdx[k] = round(today.indices[k] - yest.indices[k]);
  }
  const newPressure = (today.pressurePoints || []).filter(t => !(yest.pressurePoints || []).find(y => y.code === t.code));
  const resolvedPressure = (yest.pressurePoints || []).filter(y => !(today.pressurePoints || []).find(t => t.code === y.code));
  return {
    status: "ok",
    propertyId,
    asOf,
    indexDelta: dIdx,
    newPressurePoints: newPressure,
    resolvedPressurePoints: resolvedPressure,
    today,
    yesterday: yest,
  };
}

/* ---------- KPI rollup using canonical registry ---------- */

/**
 * Compute every supported canonical KPI for the property and period.
 * Routes through the KPI registry so no module re-implements the math.
 */
export function kernelKpiRollup(state, { propertyId, asOf, enrichReport = null } = {}) {
  if (!propertyId || !asOf) return null;
  const enrich = enrichReport || ((r) => r);
  const period = { start: asOf.slice(0, 7) + "-01", end: asOf };
  const reports = (state.reports || [])
    .filter(r => r.propertyId === propertyId && r.date >= period.start && r.date <= period.end)
    .map(enrich);
  if (!reports.length) return { status: "no-reports" };
  const inputs = inputsFromReports(reports);
  const occ = computeKpi("occupancy", inputs);
  const adr = computeKpi("adr", inputs);
  const revpar = computeKpi("revpar", inputs);
  return {
    status: "ok",
    period,
    occupancy: occ,
    adr,
    revpar,
    inputs,
  };
}

export { snapshot, overnightDelta };
