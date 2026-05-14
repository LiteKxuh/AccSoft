/* HotelOps · CapEx + FF&E reserve tracking
 * =================================================================
 * Real hotel asset managers track:
 *
 *   - CapEx projects (room renovation, HVAC replacement, lobby refresh)
 *     each with a budget, spend-to-date, expected completion, vendor.
 *   - FF&E reserve account: a liability funded by % of revenue that
 *     pays for those projects. The roll-forward is:
 *       opening + contributions - draws = closing
 *
 * Public API:
 *   makeProject({ propertyId, name, budget, ... })
 *   projectStatus(project)                       → "planned"|"in-progress"|"complete"|"over-budget"
 *   buildReserveRollForward({ contributions, draws, openingBalance, start, end })
 *   summarizePortfolio(projects)
 *
 * Realism guards:
 *   budget >= 0
 *   spend-to-date >= 0
 *   spend > budget triggers "over-budget" status, never silent
 */

import { toCents, fromCents } from "./money.js";

let _ctr = 0;
function nid(prefix) {
  _ctr += 1;
  return `${prefix}_${Date.now().toString(36)}_${_ctr.toString(36)}`;
}

const STATUSES = ["planned", "in-progress", "complete", "on-hold", "cancelled"];

export function makeProject({
  propertyId,
  name,
  category = "FF&E",
  budget,
  plannedStart = null,
  plannedComplete = null,
  vendor = null,
  notes = null,
}) {
  if (!propertyId) throw new Error("capex project requires propertyId");
  if (!name) throw new Error("capex project requires a name");
  if (!(Number(budget) >= 0)) throw new Error("capex project budget must be >= 0");
  return {
    id: nid("cx"),
    propertyId,
    name,
    category,
    budget: Number(budget),
    spendToDate: 0,
    status: "planned",
    plannedStart,
    plannedComplete,
    actualComplete: null,
    vendor,
    notes,
    createdAt: new Date().toISOString(),
    history: [],
  };
}

export function projectStatus(project) {
  if (!project) return "planned";
  if (project.status === "cancelled" || project.status === "on-hold") return project.status;
  if (project.spendToDate > project.budget) return "over-budget";
  if (project.actualComplete) return "complete";
  if (project.spendToDate > 0) return "in-progress";
  return "planned";
}

/**
 * Record spend on a project. Pure — returns updated project.
 * @param {object} project
 * @param {object} entry { amount, date, invoiceId?, description }
 */
export function recordSpend(project, entry) {
  if (!project) throw new Error("recordSpend: missing project");
  const amt = Number(entry.amount);
  if (!(amt > 0)) throw new Error("recordSpend: amount must be > 0");
  const next = { ...project };
  next.spendToDate = fromCents(toCents(next.spendToDate) + toCents(amt));
  next.history = [
    ...(next.history || []),
    {
      id: nid("cxs"),
      amount: amt,
      date: entry.date || new Date().toISOString().slice(0, 10),
      invoiceId: entry.invoiceId || null,
      description: entry.description || "",
      recordedAt: new Date().toISOString(),
    },
  ];
  next.status = projectStatus(next);
  return next;
}

/**
 * Roll-forward of the FF&E reserve over a window. Caller supplies the
 * opening balance + contribution list (from management agreement
 * accruals) + draws (capex project spends posted against the reserve).
 */
export function buildReserveRollForward({ openingBalance = 0, contributions = [], draws = [], start = null, end = null }) {
  const inWin = (d) => (!start || d >= start) && (!end || d <= end);
  const contribsIn = (contributions || []).filter(c => inWin(c.date));
  const drawsIn = (draws || []).filter(d => inWin(d.date));
  const contribTotal = fromCents(contribsIn.reduce((s, c) => s + toCents(c.amount), 0));
  const drawTotal = fromCents(drawsIn.reduce((s, d) => s + toCents(d.amount), 0));
  const closing = fromCents(toCents(openingBalance) + toCents(contribTotal) - toCents(drawTotal));
  return {
    openingBalance,
    contributions: contribsIn,
    draws: drawsIn,
    contribTotal,
    drawTotal,
    closing,
  };
}

export function summarizePortfolio(projects, propertyId = null) {
  const own = (projects || []).filter(p => !propertyId || p.propertyId === propertyId);
  let budget = 0, spend = 0, planned = 0, inProgress = 0, complete = 0, over = 0;
  for (const p of own) {
    budget += p.budget;
    spend += p.spendToDate;
    const st = projectStatus(p);
    if (st === "planned") planned++;
    else if (st === "in-progress") inProgress++;
    else if (st === "complete") complete++;
    else if (st === "over-budget") over++;
  }
  return {
    count: own.length,
    budget,
    spend,
    remaining: fromCents(toCents(budget) - toCents(spend)),
    pctSpent: budget > 0 ? spend / budget : 0,
    statusCounts: { planned, inProgress, complete, overBudget: over },
  };
}

export { STATUSES };
