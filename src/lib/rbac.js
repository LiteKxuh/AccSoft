/* HotelOps · Granular RBAC
 * =================================================================
 * Action × role matrix for hospitality back-office. Built around the
 * real role hierarchy that exists in hotel management companies, not
 * generic "admin / user / viewer" buckets:
 *
 *   front-desk           — folio entry, can read flash
 *   night-auditor        — full night-audit + JE drafts
 *   agm                  — payroll-prep + JE approval up to threshold
 *   gm                   — everything in property scope + close period
 *   controller           — chart-of-accounts edit, GL audit, owner stmt
 *   regional-controller  — multi-property consolidation
 *   ownership            — owner-statement view, distribution approval
 *   accounting-clerk     — AP entry, no posting
 *   revenue-manager      — forecast, pace, segment mix
 *
 * Each role carries:
 *   actions     — set of granted action keys
 *   scope       — "self" | "property" | "region" | "portfolio"
 *   approveLimit — max JE $ they can self-approve (0 = none, Infinity = unlimited)
 *
 * Public API:
 *   can(role, action, ctx?)     → boolean
 *   scope(role)                  → scope string
 *   approveLimit(role)           → number
 *   audit(role, action, allowed) → standard event for activity log
 */

export const ACTIONS = {
  // Audit / reports
  "report.view": "View daily reports",
  "report.create": "Post a night audit / daily report",
  "report.edit-own": "Edit a draft report you created",
  "audit.run": "Run night-audit reconciliation",
  "audit.health-view": "View Audit Health score",

  // GL / journal
  "je.create": "Create a manual journal entry",
  "je.post": "Post a manual journal entry",
  "je.approve": "Approve a journal entry",
  "je.reverse": "Create a reversal of a posted JE",
  "je.view-chain": "View ledger chain / tamper evidence",
  "je.view-session": "View posting sessions",

  // AP / AR
  "ap.create": "Enter an A/P invoice",
  "ap.approve": "Approve an A/P invoice",
  "ap.pay": "Mark invoice paid / generate NACHA",
  "ar.view": "View A/R aging",
  "ar.adjust": "Adjust A/R balances",

  // Period close
  "period.close": "Close a period",
  "period.reopen": "Re-open a closed period",
  "period.view-checklist": "View the close checklist",

  // Forecasting / RM
  "forecast.view": "View forecasts",
  "forecast.create": "Create / store forecast snapshots",
  "forecast.compare": "View forecast accuracy",
  "pace.view": "View pace + pickup reports",
  "segmentmix.view": "View segment mix",

  // Payroll
  "payroll.run": "Run payroll batches",
  "payroll.view": "View payroll history",
  "employee.edit": "Edit employee records",

  // Ownership / mgmt fees
  "owner.statement.view": "View owner statements",
  "owner.distribution.approve": "Approve owner distribution",
  "mgmtfee.view": "View management fee report",
  "mgmtfee.post": "Post management fee accrual",

  // Chart of accounts
  "chart.edit": "Edit chart of accounts",
  "chart.view": "View chart of accounts",

  // Bank rec
  "bankrec.view": "View bank reconciliation",
  "bankrec.finalize": "Finalize a reconciliation",

  // Portfolio / consolidation
  "portfolio.view": "View portfolio rollup",
  "portfolio.consolidate": "Generate consolidated statements",
};

const COMMON_VIEW = ["report.view", "audit.health-view", "ar.view", "forecast.view", "pace.view", "segmentmix.view"];

/**
 * Role definitions. `actions` is the explicit grant list.
 * `scope` controls which properties the role can act on.
 * `approveLimit` is the JE dollar ceiling for self-approval.
 */
export const ROLES = {
  "front-desk": {
    label: "Front Desk",
    actions: new Set([
      "report.view", "report.create", "audit.health-view",
    ]),
    scope: "property",
    approveLimit: 0,
  },
  "night-auditor": {
    label: "Night Auditor",
    actions: new Set([
      "report.view", "report.create", "report.edit-own",
      "audit.run", "audit.health-view",
      "je.create", "je.view-chain",
      "ap.create",
    ]),
    scope: "property",
    approveLimit: 0,
  },
  "agm": {
    label: "Assistant GM",
    actions: new Set([
      ...COMMON_VIEW,
      "report.create", "report.edit-own",
      "audit.run",
      "je.create", "je.post", "je.approve", "je.view-chain", "je.view-session",
      "ap.create", "ap.approve",
      "payroll.view",
      "period.view-checklist",
      "bankrec.view",
    ]),
    scope: "property",
    approveLimit: 5000,
  },
  "gm": {
    label: "General Manager",
    actions: new Set([
      ...COMMON_VIEW,
      "report.create", "report.edit-own",
      "audit.run",
      "je.create", "je.post", "je.approve", "je.reverse", "je.view-chain", "je.view-session",
      "ap.create", "ap.approve", "ap.pay",
      "payroll.run", "payroll.view", "employee.edit",
      "period.close", "period.view-checklist",
      "bankrec.view", "bankrec.finalize",
      "forecast.create",
      "chart.view",
    ]),
    scope: "property",
    approveLimit: 25_000,
  },
  "controller": {
    label: "Controller",
    actions: new Set([
      ...COMMON_VIEW,
      "report.view",
      "audit.health-view",
      "je.create", "je.post", "je.approve", "je.reverse", "je.view-chain", "je.view-session",
      "ap.create", "ap.approve", "ap.pay",
      "ar.adjust",
      "period.close", "period.reopen", "period.view-checklist",
      "bankrec.view", "bankrec.finalize",
      "forecast.create", "forecast.compare",
      "chart.view", "chart.edit",
      "mgmtfee.view", "mgmtfee.post",
      "owner.statement.view",
    ]),
    scope: "portfolio",
    approveLimit: 250_000,
  },
  "regional-controller": {
    label: "Regional Controller",
    actions: new Set([
      ...COMMON_VIEW,
      "je.create", "je.post", "je.approve", "je.reverse", "je.view-chain", "je.view-session",
      "ap.approve", "ap.pay",
      "period.close", "period.reopen", "period.view-checklist",
      "bankrec.view", "bankrec.finalize",
      "forecast.compare",
      "chart.view",
      "mgmtfee.view", "mgmtfee.post",
      "owner.statement.view",
      "portfolio.view", "portfolio.consolidate",
    ]),
    scope: "region",
    approveLimit: 100_000,
  },
  "ownership": {
    label: "Ownership",
    actions: new Set([
      "report.view",
      "forecast.view", "forecast.compare",
      "pace.view", "segmentmix.view",
      "owner.statement.view", "owner.distribution.approve",
      "mgmtfee.view",
      "portfolio.view",
      "je.view-chain", "je.view-session",
    ]),
    scope: "portfolio",
    approveLimit: Infinity,
  },
  "accounting-clerk": {
    label: "Accounting Clerk",
    actions: new Set([
      "report.view",
      "ap.create",
      "je.create",
      "ar.view",
      "chart.view",
    ]),
    scope: "property",
    approveLimit: 0,
  },
  "revenue-manager": {
    label: "Revenue Manager",
    actions: new Set([
      "report.view",
      "forecast.view", "forecast.create", "forecast.compare",
      "pace.view", "segmentmix.view",
      "audit.health-view",
    ]),
    scope: "property",
    approveLimit: 0,
  },
};

export function can(role, action, ctx = {}) {
  const def = ROLES[role];
  if (!def) return false;
  if (!def.actions.has(action)) return false;
  // Scope check: callers can pass propertyId / region; we accept ownership scopes liberally
  if (ctx.scope) {
    const required = ctx.scope;
    if (required === "portfolio" && def.scope !== "portfolio") return false;
    if (required === "region" && !(def.scope === "region" || def.scope === "portfolio")) return false;
    if (required === "property" && !(def.scope === "property" || def.scope === "region" || def.scope === "portfolio")) return false;
  }
  // Approval limit check for JE approvals
  if (action === "je.approve" && ctx.amount != null) {
    if ((def.approveLimit ?? 0) < ctx.amount) return false;
  }
  return true;
}

export function scope(role) {
  return ROLES[role]?.scope || "self";
}

export function approveLimit(role) {
  const v = ROLES[role]?.approveLimit;
  return v == null ? 0 : v;
}

export function listRoles() {
  return Object.entries(ROLES).map(([id, def]) => ({
    id, label: def.label, scope: def.scope, approveLimit: def.approveLimit, actionCount: def.actions.size,
  }));
}

export function actionsFor(role) {
  return Array.from(ROLES[role]?.actions || []);
}

export function audit(role, action, allowed, ctx = {}) {
  return {
    ts: new Date().toISOString(),
    role, action, allowed,
    ...ctx,
  };
}
