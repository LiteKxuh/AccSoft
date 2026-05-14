/* HotelOps · Default automation rules
 * =================================================================
 * Real hospitality operational rules. Each is a pure trigger over a
 * hotelState snapshot. New rules go here, not scattered in the UI.
 *
 * The catalog is intentionally small and high-signal — these are
 * conditions a controller / GM / RM would actually want surfaced.
 * Better to ship 10 reliable rules than 50 noisy ones.
 */

function pct(n, d = 0) { return `${(n * 100).toFixed(d)}%`; }
function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const DEFAULT_RULES = [
  // ----- Audit -----
  {
    id: "rules.audit.hard_fail",
    enabled: true,
    label: "Night audit hard-fail blocks roll",
    description: "Surface any property whose audit reconciliation returned a hard failure.",
    trigger: ({ snap }) => snap.audit?.status === "fail",
    produce: ({ snap }) => ({
      label: `Night audit FAILED for ${snap.asOf} · score ${snap.audit?.score}/100`,
      severity: "high",
      action: "escalate",
      payload: { failureCount: snap.audit?.failureCount, score: snap.audit?.score, suggestedRecipient: "controller" },
      dedupeKey: `audit_fail::${snap.propertyId}::${snap.asOf}`,
    }),
  },

  // ----- Anomaly -----
  {
    id: "rules.anomaly.high",
    enabled: true,
    label: "High-severity operational anomaly",
    description: "Same-day-of-week deviation or settlement gap >35%.",
    trigger: ({ snap }) => snap.anomalies?.some(a => a.severity === "high"),
    produce: ({ snap }) => {
      const top = snap.anomalies.find(a => a.severity === "high");
      return {
        label: `Anomaly · ${top.label}`,
        severity: "high",
        action: "alert",
        payload: { code: top.code, detail: top.detail },
        dedupeKey: `anomaly::${top.code}::${snap.propertyId}::${snap.asOf}`,
      };
    },
  },

  // ----- Labor -----
  {
    id: "rules.labor.overspend",
    enabled: true,
    label: "MTD labor cost exceeding target",
    description: "Labor cost over 35% of revenue triggers controller review.",
    trigger: ({ snap }) => snap.labor?.mtdPctRev > 0.35 && snap.mtd.revenue > 0,
    produce: ({ snap }) => ({
      label: `Labor MTD ${pct(snap.labor.mtdPctRev, 1)} of revenue · target 30%`,
      severity: snap.labor.mtdPctRev > 0.45 ? "high" : "medium",
      action: "task",
      payload: { suggestedRecipient: "gm", topic: "labor-variance", mtdCost: snap.labor.mtdCost, mtdRevenue: snap.mtd.revenue },
      dedupeKey: `labor.overspend::${snap.propertyId}::${snap.asOf.slice(0, 7)}`,
    }),
  },

  // ----- Schedule drift -----
  {
    id: "rules.labor.schedule_drift",
    enabled: true,
    label: "Actual hours drifting from schedule",
    description: "Clocked hours more than 12% above scheduled hours MTD.",
    trigger: ({ snap }) => Math.abs(snap.labor?.driftPct || 0) > 0.12 && snap.labor?.scheduledHours > 0,
    produce: ({ snap }) => ({
      label: `Schedule drift ${pct(snap.labor.driftPct, 1)} (actual ${snap.labor.actualHours.toFixed(0)}h vs scheduled ${snap.labor.scheduledHours.toFixed(0)}h)`,
      severity: "medium",
      action: "task",
      payload: { suggestedRecipient: "gm" },
      dedupeKey: `labor.drift::${snap.propertyId}::${snap.asOf.slice(0, 7)}`,
    }),
  },

  // ----- Approvals backlog -----
  {
    id: "rules.approvals.backlog",
    enabled: true,
    label: "Approval backlog over $25k",
    description: "Pending JE + AP approvals over $25,000 in dollar volume.",
    trigger: ({ snap }) => (snap.approvals?.pendingDollar || 0) > 25_000,
    produce: ({ snap }) => ({
      label: `${snap.approvals.pendingJE + snap.approvals.pendingAP} items pending · ${money(snap.approvals.pendingDollar)}`,
      severity: snap.approvals.pendingDollar > 100_000 ? "high" : "medium",
      action: "task",
      payload: { suggestedRecipient: "controller", count: snap.approvals.pendingJE + snap.approvals.pendingAP },
      dedupeKey: `approvals.backlog::${snap.propertyId}::${snap.asOf.slice(0, 10)}`,
    }),
  },

  // ----- AP aging -----
  {
    id: "rules.ap.over120",
    enabled: true,
    label: "A/P aged over 120 days",
    description: "Invoices outstanding 120+ days require vendor outreach.",
    trigger: ({ snap }) => (snap.ledger?.apOver120 || 0) > 0,
    produce: ({ snap }) => ({
      label: `${money(snap.ledger.apOver120)} of A/P over 120 days`,
      severity: "medium",
      action: "task",
      payload: { suggestedRecipient: "controller", amount: snap.ledger.apOver120 },
      dedupeKey: `ap.over120::${snap.propertyId}::${snap.asOf.slice(0, 10)}`,
    }),
  },

  // ----- Forward compression -----
  {
    id: "rules.compression.forward",
    enabled: true,
    label: "Forward 7-day compression detected",
    description: "Projected occupancy near tier cap — revenue management should review rate ceilings.",
    trigger: ({ snap }) => snap.compression === true,
    produce: ({ snap }) => ({
      label: `Compression on next 7 days · review rate ceilings`,
      severity: "low",
      action: "recommendation",
      payload: { suggestedRecipient: "revenue-manager", tier: snap.tier, washFactor: snap.pace?.washFactor },
      dedupeKey: `compression::${snap.propertyId}::${snap.asOf.slice(0, 10)}`,
    }),
  },

  // ----- CapEx over budget -----
  {
    id: "rules.capex.overbudget",
    enabled: true,
    label: "CapEx project over budget",
    description: "Any capital project where spend exceeds the original budget.",
    trigger: ({ snap }) => (snap.capex?.statusCounts?.overBudget || 0) > 0,
    produce: ({ snap }) => ({
      label: `${snap.capex.statusCounts.overBudget} CapEx project(s) over budget`,
      severity: "medium",
      action: "task",
      payload: { suggestedRecipient: "controller" },
      dedupeKey: `capex.overbudget::${snap.propertyId}::${snap.asOf.slice(0, 10)}`,
    }),
  },

  // ----- Settlement gap -----
  {
    id: "rules.settlement.gap",
    enabled: true,
    label: "Settlement does not match revenue + tax",
    description: "Cash + CC + AR settlements off by more than 2% from total revenue + tax.",
    trigger: ({ snap }) => snap.anomalies?.some(a => a.code === "settlement.gap"),
    produce: ({ snap }) => {
      const a = snap.anomalies.find(x => x.code === "settlement.gap");
      return {
        label: a?.label || "Settlement gap detected",
        severity: "high",
        action: "escalate",
        payload: { detail: a?.detail, suggestedRecipient: "night-auditor" },
        dedupeKey: `settle.gap::${snap.propertyId}::${snap.asOf}`,
      };
    },
  },

  // ----- Missing budget -----
  {
    id: "rules.coverage.missing_budget",
    enabled: true,
    label: "No budget loaded for current month",
    description: "Variance reports cannot run without a budget for the period.",
    trigger: ({ snap }) => snap.coverage?.hasBudget === false,
    produce: ({ snap }) => ({
      label: `No budget for ${snap.asOf.slice(0, 7)} — variance reports unavailable`,
      severity: "low",
      action: "task",
      payload: { suggestedRecipient: "controller" },
      dedupeKey: `missing.budget::${snap.propertyId}::${snap.asOf.slice(0, 7)}`,
    }),
  },
];

export function listRules() {
  return DEFAULT_RULES.map(r => ({ id: r.id, label: r.label, description: r.description, enabled: r.enabled !== false }));
}

export function ruleById(id) {
  return DEFAULT_RULES.find(r => r.id === id) || null;
}
