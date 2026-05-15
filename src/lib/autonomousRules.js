/* HotelOps · Autonomous operational rules
 * =================================================================
 * Higher-order rules that operate against the OperationalGraph rather
 * than the raw snapshot. These read the kernel's composite indices +
 * coordination signals + costIntel + forensic summary and turn them
 * into actionable workflow tasks.
 *
 * Pure functions. Each rule:
 *   - Takes the OperationalGraph
 *   - Returns an array of automation events (same shape as DEFAULT_RULES
 *     emits via workflowEngine) so they can be applied with applyEvents.
 *
 * Categories:
 *   - staffing interventions
 *   - predictive maintenance triggers
 *   - payroll freeze
 *   - revenue review
 *   - guest sentiment escalation
 *   - audit / forensic escalation
 *
 * Rules are intentionally severity-tiered and dedupe-aware. They are
 * what make the platform feel "semi-autonomous."
 */

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function dedupe(rule, graph, suffix = "") {
  return `${rule}::${graph.propertyId}::${graph.asOf}${suffix ? `::${suffix}` : ""}`;
}

/* ---------- Staffing intervention ---------- */

function staffingInterventionRule(graph, twin) {
  const events = [];
  if (graph.indices?.staffingStressIndex >= 60) {
    events.push({
      ruleId: "auto.staffing.intervention",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: graph.indices.staffingStressIndex >= 80 ? "high" : "medium",
      label: `Staffing stress index ${graph.indices.staffingStressIndex}/100`,
      action: "task",
      payload: {
        category: "staffing",
        suggestedRecipient: "gm",
        actions: [
          "Review the next 72 hours of schedule vs forecast occupancy",
          "Identify shifts on understaffed days, escalate to DOH/FOM",
        ],
      },
      dedupeKey: dedupe("auto.staffing.intervention", graph),
    });
  }
  // Twin-aware: HK understaffed
  if (twin?.housekeeping?.status_ === "understaffed" && (twin.housekeeping.gap || 0) >= 2) {
    events.push({
      ruleId: "auto.staffing.hk_understaff",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: twin.housekeeping.gap >= 4 ? "high" : "medium",
      label: `Housekeeping short ${twin.housekeeping.gap} shift(s) for ${twin.housekeeping.roomsToClean} rooms`,
      action: "task",
      payload: { category: "housekeeping", suggestedRecipient: "doh", gap: twin.housekeeping.gap },
      dedupeKey: dedupe("auto.staffing.hk_understaff", graph),
    });
  }
  return events;
}

/* ---------- Predictive maintenance ---------- */

function predictiveMaintenanceRule(graph, twin) {
  const events = [];
  // Maintenance backlog with aged tickets
  if (twin?.maintenance?.healthBand === "elevated" || twin?.maintenance?.healthBand === "critical") {
    events.push({
      ruleId: "auto.maintenance.backlog",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: twin.maintenance.healthBand === "critical" ? "high" : "medium",
      label: `Maintenance backlog ${twin.maintenance.healthBand} — ${twin.maintenance.openTickets} open, ${twin.maintenance.agedTickets} aged`,
      action: "task",
      payload: {
        category: "maintenance",
        suggestedRecipient: "doe",
        breakdown: twin.maintenance.byPriority,
      },
      dedupeKey: dedupe("auto.maintenance.backlog", graph),
    });
  }
  // Maintenance spend prediction inside costIntel
  const maint = graph.costIntel?.maintenance;
  if (maint?.status === "ok" && maint.recentSpike) {
    events.push({
      ruleId: "auto.maintenance.spike",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: "medium",
      label: `Maintenance spend spike detected — ${maint.notes}`,
      action: "alert",
      payload: { category: "maintenance", suggestedRecipient: "controller", projection: maint.projection },
      dedupeKey: dedupe("auto.maintenance.spike", graph),
    });
  }
  return events;
}

/* ---------- Payroll freeze ---------- */

function payrollFreezeRule(graph) {
  const events = [];
  // Trigger if forensic findings include payroll-related codes with high severity
  const payrollFindings = (graph.forensic?.findings || []).filter(f =>
    /^payroll\./.test(f.code) && f.severity === "high"
  );
  if (payrollFindings.length >= 1) {
    events.push({
      ruleId: "auto.payroll.freeze",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: "high",
      label: `Payroll freeze recommended — ${payrollFindings.length} high-severity payroll finding(s)`,
      action: "escalate",
      payload: {
        category: "payroll",
        suggestedRecipient: "controller",
        findings: payrollFindings.slice(0, 3).map(f => ({ code: f.code, label: f.label })),
      },
      dedupeKey: dedupe("auto.payroll.freeze", graph),
    });
  }
  return events;
}

/* ---------- Revenue review ---------- */

function revenueReviewRule(graph) {
  const events = [];
  // Profitability pressure or margin erosion → revenue review
  if (graph.indices?.profitabilityPressureScore >= 50) {
    events.push({
      ruleId: "auto.revenue.review",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: graph.indices.profitabilityPressureScore >= 70 ? "high" : "medium",
      label: `Profitability pressure ${graph.indices.profitabilityPressureScore}/100 — schedule revenue review`,
      action: "task",
      payload: {
        category: "revenue",
        suggestedRecipient: "revenue-manager",
        priorities: [
          "Review BAR ceilings on upcoming compression nights",
          "Audit OTA mix vs direct",
          "Re-baseline group displacement assumptions",
        ],
      },
      dedupeKey: dedupe("auto.revenue.review", graph),
    });
  }
  // Forecast volatility — covered by margin erosion in profitability or via signal
  if (graph.costIntel?.margin?.status === "ok" && graph.costIntel.margin.verdict === "eroding") {
    events.push({
      ruleId: "auto.margin.eroding",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: "high",
      label: "Multi-month margin erosion — controller + RM review",
      action: "escalate",
      payload: { category: "profitability", suggestedRecipient: "controller" },
      dedupeKey: dedupe("auto.margin.eroding", graph),
    });
  }
  return events;
}

/* ---------- Guest sentiment escalation ---------- */

function guestSentimentRule(graph) {
  const events = [];
  if (graph.indices?.guestRiskIndex >= 50) {
    events.push({
      ruleId: "auto.guest.escalation",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: graph.indices.guestRiskIndex >= 70 ? "high" : "medium",
      label: `Guest risk index ${graph.indices.guestRiskIndex}/100`,
      action: "task",
      payload: {
        category: "guest-experience",
        suggestedRecipient: "gm",
        nextSteps: [
          "Walk a sample of rooms with DOH",
          "Review the latest 10 guest feedback entries",
          "Verify maintenance backlog isn't impacting guest-facing items",
        ],
      },
      dedupeKey: dedupe("auto.guest.escalation", graph),
    });
  }
  return events;
}

/* ---------- Audit / forensic escalation ---------- */

function auditForensicRule(graph) {
  const events = [];
  if (graph.indices?.operationalRiskScore >= 50) {
    events.push({
      ruleId: "auto.audit.escalation",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: graph.indices.operationalRiskScore >= 70 ? "high" : "medium",
      label: `Operational risk score ${graph.indices.operationalRiskScore}/100`,
      action: "task",
      payload: {
        category: "audit",
        suggestedRecipient: "controller",
        pressurePoints: (graph.pressurePoints || []).slice(0, 5),
      },
      dedupeKey: dedupe("auto.audit.escalation", graph),
    });
  }
  // Specific: chain gaps
  const chainGap = (graph.pressurePoints || []).find(p => p.code === "chain.gaps");
  if (chainGap) {
    events.push({
      ruleId: "auto.audit.chain_gap",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: "high",
      label: chainGap.label,
      action: "escalate",
      payload: { category: "audit", suggestedRecipient: "controller", code: chainGap.code },
      dedupeKey: dedupe("auto.audit.chain_gap", graph),
    });
  }
  return events;
}

/* ---------- Cascade-aware AP escalation ---------- */

function apEscalationRule(graph) {
  const events = [];
  const apOver120 = (graph.pressurePoints || []).find(p => p.code === "ap.over120");
  if (apOver120) {
    events.push({
      ruleId: "auto.ap.over120",
      propertyId: graph.propertyId,
      asOf: graph.asOf,
      severity: "medium",
      label: apOver120.label,
      action: "task",
      payload: { category: "ap", suggestedRecipient: "ap-clerk" },
      dedupeKey: dedupe("auto.ap.over120", graph),
    });
  }
  return events;
}

/* ---------- Public API ---------- */

/**
 * Run every autonomous rule against an OperationalGraph (and optional twin).
 * Returns events ready to be passed to workflowEngine.applyEvents.
 */
export function evaluateAutonomous(graph, twin = null) {
  if (!graph || graph.status !== "ok") return [];
  const all = [
    ...staffingInterventionRule(graph, twin),
    ...predictiveMaintenanceRule(graph, twin),
    ...payrollFreezeRule(graph),
    ...revenueReviewRule(graph),
    ...guestSentimentRule(graph),
    ...auditForensicRule(graph),
    ...apEscalationRule(graph),
  ];
  // Stamp createdAt and a stable id so downstream code can apply them
  return all.map(ev => ({
    ...ev,
    id: `autoev_${ev.ruleId}_${graph.propertyId}_${graph.asOf}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  }));
}

/** Run autonomous rules across every property's graph in a portfolio. */
export function evaluatePortfolioAutonomous(graphs, twins = {}) {
  const out = [];
  for (const g of (graphs || [])) {
    out.push(...evaluateAutonomous(g, twins[g.propertyId] || null));
  }
  return out;
}

/** Catalog of rule metadata for the UI / settings panes. */
export const AUTONOMOUS_RULES = [
  { id: "auto.staffing.intervention", category: "staffing", title: "Staffing stress intervention" },
  { id: "auto.staffing.hk_understaff", category: "staffing", title: "HK understaffing" },
  { id: "auto.maintenance.backlog", category: "maintenance", title: "Maintenance backlog elevated" },
  { id: "auto.maintenance.spike", category: "maintenance", title: "Maintenance spend spike" },
  { id: "auto.payroll.freeze", category: "payroll", title: "Payroll freeze recommendation" },
  { id: "auto.revenue.review", category: "revenue", title: "Revenue review trigger" },
  { id: "auto.margin.eroding", category: "profitability", title: "Multi-month margin erosion" },
  { id: "auto.guest.escalation", category: "guest", title: "Guest sentiment escalation" },
  { id: "auto.audit.escalation", category: "audit", title: "Operational risk escalation" },
  { id: "auto.audit.chain_gap", category: "audit", title: "Ledger chain gap" },
  { id: "auto.ap.over120", category: "ap", title: "A/P over 120 days" },
];
