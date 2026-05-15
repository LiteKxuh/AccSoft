/* HotelOps · Risk Intelligence Engine
 * =================================================================
 * Single unified risk view across every existing detector:
 *
 *   - Financial forensics       (forensics.js)
 *   - Ledger forensics + chain  (ledgerForensics.js)
 *   - Payroll forensics         (workforce/payrollForensics.js)
 *   - Operational waste         (costIntelligence.js)
 *   - A/P aging exposure        (aging.js)
 *   - Capex over-budget         (kernel)
 *
 * Produces:
 *   - findings[]   (every detection, sorted by risk-weighted score)
 *   - heatmap      (by category × severity)
 *   - timeline     (findings rolled up by week)
 *   - riskScore    (0-100)
 *   - riskBand     ("clean"|"low"|"elevated"|"high"|"critical")
 *   - byCategory   {financial, ledger, payroll, operational, ap, capex}
 *   - topActions   (prioritized triage list — what to look at first)
 *
 * Pure function, deterministic. The UI/agents read this and never
 * re-implement detection.
 */

import { runForensics } from "./forensics.js";
import { chainHealth } from "./ledgerForensics.js";
import { runPayrollForensics } from "./workforce/payrollForensics.js";
import { detectOperationalWaste } from "./costIntelligence.js";
import { apAging } from "./aging.js";

const SEVERITY_WEIGHT = { high: 8, medium: 3, low: 1, info: 0 };
const SEVERITY_RANK = { high: 3, medium: 2, low: 1, info: 0 };

function normalize(finding, category) {
  return {
    id: finding.id || `f_${Math.random().toString(36).slice(2, 10)}`,
    category,
    code: finding.code,
    severity: finding.severity || "medium",
    confidence: typeof finding.confidence === "number" ? finding.confidence : 0.5,
    label: finding.label,
    detail: finding.detail || null,
    evidence: finding.evidence || null,
    date: extractDate(finding),
  };
}

function extractDate(f) {
  if (!f) return null;
  if (f.date) return f.date;
  if (f.evidence?.date) return f.evidence.date;
  if (f.evidence?.week) return f.evidence.week;
  return null;
}

function weekOf(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // ISO week (Monday)
  const t = new Date(d.getTime());
  t.setUTCHours(0, 0, 0, 0);
  t.setUTCDate(t.getUTCDate() - (t.getUTCDay() || 7) + 1);
  return t.toISOString().slice(0, 10);
}

/**
 * Run the full risk intelligence pass.
 *
 * @param {object} state               app state slice (already filtered to property if desired)
 * @param {object} opts                { propertyId, period: { start, end }, asOf }
 */
export function runRiskIntelligence(state, opts = {}) {
  const { propertyId = null, period = null, asOf = new Date().toISOString().slice(0, 10) } = opts;

  // Property-scoped view (defensive — many detectors expect flat collections)
  const scopedState = propertyId ? {
    ...state,
    journalEntries: (state.journalEntries || []).filter(j => !propertyId || j.propertyId === propertyId),
    invoices: (state.invoices || []).filter(i => !propertyId || i.propertyId === propertyId),
    reports: (state.reports || []).filter(r => !propertyId || r.propertyId === propertyId),
    shifts: (state.shifts || []).filter(s => !propertyId || !s.propertyId || s.propertyId === propertyId),
    payrollRuns: (state.payrollRuns || []).filter(r => !propertyId || !r.propertyId || r.propertyId === propertyId),
    payrollAdjustments: (state.payrollAdjustments || []).filter(a => !propertyId || !a.propertyId || a.propertyId === propertyId),
  } : state;

  // 1. Financial forensics
  const financial = runForensics(scopedState);
  // 2. Ledger chain (portfolio-level — chain integrity is per-tenant, not per-property)
  const chain = chainHealth(state);
  // 3. Payroll forensics
  const payroll = runPayrollForensics(scopedState);
  // 4. Operational waste
  const waste = period ? detectOperationalWaste({
    ledger: scopedState.journalEntries || [], reports: scopedState.reports || [],
    propertyId, period,
  }) : { findings: [] };
  // 5. AP over-aged
  const ap = apAging({
    invoices: state.invoices || [], vendors: state.vendors || [],
    propIds: propertyId ? [propertyId] : null, asOf: new Date(asOf),
  });
  const apFindings = [];
  if ((ap.totals?.b120 || 0) > 0) {
    apFindings.push({
      id: `ap_${asOf}`,
      code: "ap.over120",
      severity: ap.totals.b120 > 50_000 ? "high" : "medium",
      confidence: 1.0,
      label: `$${ap.totals.b120.toFixed(0)} A/P over 120 days`,
      detail: "Vendor-relationship and audit-risk exposure. Clear or document the cause.",
      evidence: { amount: ap.totals.b120 },
    });
  }
  if ((ap.totals?.b90 || 0) > 0) {
    apFindings.push({
      id: `ap_${asOf}_90`,
      code: "ap.over90",
      severity: ap.totals.b90 > 75_000 ? "medium" : "low",
      confidence: 0.9,
      label: `$${ap.totals.b90.toFixed(0)} A/P in 90-120 bucket`,
      detail: "Aged invoices about to roll into over-120.",
      evidence: { amount: ap.totals.b90 },
    });
  }
  // 6. Chain findings
  const chainFindings = [];
  if ((chain.unchainedPosted || 0) > 0) {
    chainFindings.push({
      id: `chain_${asOf}`,
      code: "chain.unchained",
      severity: "high",
      confidence: 1.0,
      label: `${chain.unchainedPosted} posted JE(s) missing chain hash`,
      detail: "Auditability gap — re-stamp via Forensics admin tool.",
      evidence: { unchainedPosted: chain.unchainedPosted },
    });
  }
  if (typeof chain.healthyPct === "number" && chain.healthyPct < 0.95 && (chain.totalEntries || 0) > 0) {
    chainFindings.push({
      id: `chain_health_${asOf}`,
      code: "chain.health.low",
      severity: "medium",
      confidence: 0.85,
      label: `Chain healthy on ${(chain.healthyPct * 100).toFixed(1)}% of entries`,
      detail: "Investigate unsigned recent entries.",
      evidence: { healthyPct: chain.healthyPct },
    });
  }

  // Normalize all into unified findings
  const findings = [
    ...financial.findings.map(f => normalize(f, "financial")),
    ...chainFindings.map(f => normalize(f, "ledger")),
    ...payroll.findings.map(f => normalize(f, "payroll")),
    ...(waste.findings || []).map(f => normalize(f, "operational")),
    ...apFindings.map(f => normalize(f, "ap")),
  ];

  // Sort by risk-weighted score (confidence × severity rank)
  findings.sort((a, b) => (b.confidence * (SEVERITY_RANK[b.severity] || 0)) - (a.confidence * (SEVERITY_RANK[a.severity] || 0)));

  // Aggregate score
  const score = findings.reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity] || 1), 0);
  // Same banding scheme used by financial + payroll engines
  const riskBand = score === 0 ? "clean"
    : score < 5 ? "low"
    : score < 15 ? "elevated"
    : score < 30 ? "high"
    : "critical";

  // Heatmap: rows = category, cols = severity
  const heatmap = buildHeatmap(findings);
  // Timeline: findings rolled into weekly buckets
  const timeline = buildTimeline(findings);
  // By-category counts
  const byCategory = {};
  for (const f of findings) {
    byCategory[f.category] = byCategory[f.category] || { count: 0, weighted: 0 };
    byCategory[f.category].count++;
    byCategory[f.category].weighted += SEVERITY_WEIGHT[f.severity] || 1;
  }
  // Top actions — first 6 highest-weighted findings paired with a generic next-step
  const topActions = findings.slice(0, 6).map(f => ({
    code: f.code,
    severity: f.severity,
    label: f.label,
    action: actionFor(f),
  }));

  return {
    status: "ok",
    runAt: new Date().toISOString(),
    propertyId,
    findings,
    counts: findings.reduce((acc, f) => { acc[f.code] = (acc[f.code] || 0) + 1; return acc; }, {}),
    riskScore: score,
    riskBand,
    byCategory,
    heatmap,
    timeline,
    topActions,
    subSystems: {
      financial: { riskScore: financial.riskScore, riskBand: financial.riskBand, counts: financial.counts },
      payroll: { riskScore: payroll.riskScore, riskBand: payroll.riskBand, counts: payroll.counts },
      chain: { totalEntries: chain.totalEntries, healthyPct: chain.healthyPct, unchainedPosted: chain.unchainedPosted },
      ap: { totals: ap.totals },
      operational: { count: (waste.findings || []).length },
    },
  };
}

function buildHeatmap(findings) {
  const cats = ["financial", "ledger", "payroll", "operational", "ap"];
  const sevs = ["high", "medium", "low"];
  const cells = [];
  for (const c of cats) {
    for (const s of sevs) {
      const count = findings.filter(f => f.category === c && f.severity === s).length;
      cells.push({ category: c, severity: s, count });
    }
  }
  return cells;
}

function buildTimeline(findings) {
  const byWeek = new Map();
  for (const f of findings) {
    const wk = weekOf(f.date) || "unknown";
    if (!byWeek.has(wk)) byWeek.set(wk, { week: wk, high: 0, medium: 0, low: 0, total: 0 });
    const row = byWeek.get(wk);
    row[f.severity] = (row[f.severity] || 0) + 1;
    row.total++;
  }
  return Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week));
}

function actionFor(f) {
  switch (f.code) {
    case "duplicate.exact":
    case "duplicate.likely":
      return "Open the AP module → Duplicate Review and validate against vendor portal.";
    case "ghost.revenue":
      return "Re-post the report's JE via the Reports Hub → Replay tool.";
    case "refund.large":
      return "Pull the JE, attach guest-folio backup, and route to GM approval.";
    case "payroll.outlier":
    case "payroll.inflation":
      return "Inspect the payroll run for that period; verify approver chain and adjustment log.";
    case "bypass.je":
    case "bypass.ap":
      return "Open Approval Inbox → enforce retroactive approval or void.";
    case "vendor.new_large":
      return "Pull onboarding documentation; verify W-9 / COI / ACH banking.";
    case "chain.unchained":
    case "chain.health.low":
      return "Run Forensics → Re-stamp Chain (controller-only tool).";
    case "ap.over120":
    case "ap.over90":
      return "Push the over-aged invoices through the Aging pane and contact the vendor.";
    case "supply.cpor.high":
      return "Schedule housekeeping supply audit; verify inventory issuance.";
    case "utility.cpor.high":
      return "Run a thermostat-setback audit; verify utility-meter accuracy.";
    case "ag.pct.high":
      return "Review software/subscription line items for unused licenses.";
    case "buddy.punch":
      return "Open the Time & Attendance pane and review the device punch log.";
    case "ghost.employee":
      return "Verify the employee in HRIS and confirm termination status.";
    case "ot.suspicious":
      return "Pull the schedule and audit OT approvals for that day-of-week pattern.";
    default:
      return "Review the finding evidence and route to the responsible department.";
  }
}

/* ---------- Portfolio aggregation ---------- */

/** Run the engine across multiple properties and roll up. */
export function runPortfolioRisk(state, opts = {}) {
  const { propertyIds = [], period = null, asOf = new Date().toISOString().slice(0, 10) } = opts;
  if (!propertyIds.length) return { status: "no-properties", asOf };
  const perProperty = propertyIds.map(pid => ({
    propertyId: pid,
    ...runRiskIntelligence(state, { propertyId: pid, period, asOf }),
  }));
  const totalScore = perProperty.reduce((s, r) => s + (r.riskScore || 0), 0);
  const worst = [...perProperty].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)).slice(0, 5);
  return {
    status: "ok",
    asOf,
    propertyCount: perProperty.length,
    totalScore,
    avgScore: perProperty.length ? Math.round(totalScore / perProperty.length) : 0,
    worst: worst.map(w => ({ propertyId: w.propertyId, riskScore: w.riskScore, riskBand: w.riskBand })),
    perProperty,
  };
}
