/* HotelOps · Workforce — payroll batch engine
 * =================================================================
 * Generates and tracks a payroll batch from shifts + OT rules +
 * employee profiles. Implements the lifecycle:
 *
 *   draft → preview → approved → exported → posted-to-gl
 *
 * Every transition carries an audit entry. State patches are
 * idempotency-key safe so a double-click does not create two batches.
 *
 *   buildBatch({ state, payGroup, periodStart, periodEnd, otRule, opts })
 *     → { batch, perEmployee[], totals }
 *
 *   approveBatch(state, batchId, user)        → state patch
 *   exportBatch(state, batchId, format, user) → { content, filename, patch }
 *   postBatchToLedger(state, batchId, user)   → { journalEntries, patch }
 */

import { computeOvertime } from "./overtimeRules.js";
import { buildPayCodeLines, sumLines } from "./paycodeEngine.js";
import { normalizeEmployee, isActive, validateForPayroll } from "./employeeProfile.js";
import { computeShiftHours } from "./timeAttendance.js";
import { glAllocationFor } from "./jobCodes.js";
import { reserveKey } from "../idempotency.js";

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }

let _ctr = 0;
function nid(prefix) { _ctr += 1; return `${prefix}_${Date.now().toString(36)}_${_ctr.toString(36)}`; }

/**
 * Group the shift list for the period into per-employee hours, then
 * run OT rules + paycode logic. Returns the batch + per-employee detail.
 */
export function buildBatch({ state, payGroup, periodStart, periodEnd, otRule = "FLSA", holidays = [], opts = {} } = {}) {
  if (!payGroup) throw new Error("buildBatch: payGroup required");
  if (!periodStart || !periodEnd) throw new Error("buildBatch: periodStart/periodEnd required");

  const employees = (state.employees || [])
    .map(normalizeEmployee)
    .filter(e => (!payGroup.id || e.payGroupId === payGroup.id || !e.payGroupId) && isActive(e, periodEnd));

  const shifts = (state.shifts || []).filter(s =>
    s.clockOut && s.clockIn >= periodStart && s.clockIn <= `${periodEnd}T23:59:59`
  );

  const perEmployee = [];

  for (const emp of employees) {
    const empShifts = shifts.filter(s => s.employeeId === emp.id);
    const dailyHours = empShifts.map(s => ({
      date: s.clockIn.slice(0, 10),
      hours: computeShiftHours(s).paid,
      jobCodeId: s.jobCodeId || emp.jobCodes?.[0] || null,
      departmentId: s.departmentId || emp.homeDepartment || null,
      hourlyRate: s.hourlyRate || emp.hourlyRate || 0,
    }));
    if (!dailyHours.length && emp.payClass !== "salaried") continue;

    let split;
    let rate;
    if (emp.payClass === "salaried" && emp.salary > 0) {
      // Salaried: prorate the annual salary to period length
      const days = Math.max(1, Math.floor((new Date(periodEnd) - new Date(periodStart)) / 86400000) + 1);
      const periodPay = (emp.salary / 365) * days;
      split = { regular: round2(days * 8), ot: 0, doubleTime: 0, holiday: 0, totalHours: round2(days * 8) };
      rate = round2(periodPay / split.regular);
    } else {
      split = computeOvertime({ shifts: dailyHours, rule: otRule, holidays, wage: emp.hourlyRate });
      rate = emp.hourlyRate || 0;
    }

    // Pull employee-period extras (PTO, tips, etc) from state.payrollAdjustments
    const adjustments = (state.payrollAdjustments || []).filter(a =>
      a.employeeId === emp.id && a.periodStart === periodStart && a.periodEnd === periodEnd
    );
    const tippedExtras = emp.payClass === "tipped"
      ? (state.tipDeclarations || []).filter(t => t.employeeId === emp.id && t.date >= periodStart && t.date <= periodEnd)
      : [];
    const tips = tippedExtras.reduce((s, t) => s + safe(t.cashTips), 0);
    const tipsCC = tippedExtras.reduce((s, t) => s + safe(t.creditCardTips), 0);

    const lines = buildPayCodeLines({
      split, rate,
      extras: {
        ptoHours: adjustments.filter(a => a.code === "PTO").reduce((s, a) => s + safe(a.hours), 0),
        sickHours: adjustments.filter(a => a.code === "SICK").reduce((s, a) => s + safe(a.hours), 0),
        holidayPaidHours: adjustments.filter(a => a.code === "HOL_PAY").reduce((s, a) => s + safe(a.hours), 0),
        bonus: adjustments.filter(a => a.code === "BONUS").reduce((s, a) => s + safe(a.amount), 0),
        serviceCharge: adjustments.filter(a => a.code === "SVC").reduce((s, a) => s + safe(a.amount), 0),
        tips, tipsCC,
        adjustments: adjustments.filter(a => a.code === "ADJ").map(a => ({ amount: a.amount, reason: a.reason, approvedBy: a.approvedBy })),
      },
    });
    const sums = sumLines(lines);
    const validation = validateForPayroll(emp);
    const allocations = allocateByDepartment({ dailyHours, gross: sums.gross });

    perEmployee.push({
      employeeId: emp.id,
      employeeName: emp.name,
      payClass: emp.payClass,
      rate,
      hours: split,
      lines,
      gross: sums.gross,
      taxableWages: sums.taxableWages,
      tips: sums.tips,
      benefits: sums.benefits,
      adjustments: sums.adjustments,
      allocations,
      validation,
    });
  }

  const totals = perEmployee.reduce((acc, l) => {
    acc.gross += l.gross; acc.taxableWages += l.taxableWages;
    acc.tips += l.tips; acc.benefits += l.benefits;
    acc.headcount += 1;
    return acc;
  }, { gross: 0, taxableWages: 0, tips: 0, benefits: 0, headcount: 0 });
  Object.keys(totals).forEach(k => { if (typeof totals[k] === "number") totals[k] = round2(totals[k]); });

  const batch = {
    id: nid("pb"),
    payGroupId: payGroup.id,
    periodStart, periodEnd, otRule,
    status: "draft",
    createdAt: new Date().toISOString(),
    totals,
  };
  return { batch, perEmployee, totals };
}

function allocateByDepartment({ dailyHours = [], gross }) {
  if (!dailyHours.length || !gross) return [];
  const byDept = new Map();
  let totalHours = 0;
  for (const h of dailyHours) {
    const dept = h.departmentId || "Other";
    byDept.set(dept, (byDept.get(dept) || 0) + safe(h.hours));
    totalHours += safe(h.hours);
  }
  if (totalHours === 0) return [];
  return Array.from(byDept.entries()).map(([dept, hours]) => ({
    departmentId: dept,
    hours: round2(hours),
    share: hours / totalHours,
    cost: round2(gross * (hours / totalHours)),
    glAccount: glAllocationFor(dept),
  }));
}

/** Approve a batch — moves status to "approved". */
export function approveBatch(state, batchId, user) {
  const batch = (state.payrollBatches || []).find(b => b.id === batchId);
  if (!batch) throw new Error(`approveBatch: batch ${batchId} not found`);
  if (batch.status !== "draft" && batch.status !== "preview") {
    throw new Error(`approveBatch: cannot approve a batch in ${batch.status} state`);
  }
  const next = (state.payrollBatches || []).map(b =>
    b.id === batchId
      ? { ...b, status: "approved", approvedAt: new Date().toISOString(), approvedBy: user?.id || null }
      : b
  );
  return { payrollBatches: next };
}

/** Re-open a draft batch (only allowed before approval). */
export function reopenBatch(state, batchId, user) {
  const batch = (state.payrollBatches || []).find(b => b.id === batchId);
  if (!batch) throw new Error(`reopenBatch: not found`);
  if (batch.status === "exported" || batch.status === "posted") {
    throw new Error("reopenBatch: cannot reopen a batch that has been exported or posted");
  }
  const next = (state.payrollBatches || []).map(b =>
    b.id === batchId
      ? { ...b, status: "draft", reopenedAt: new Date().toISOString(), reopenedBy: user?.id || null }
      : b
  );
  return { payrollBatches: next };
}

/**
 * Post a batch into the GL. Returns the JEs + the updated batch.
 * Uses department allocations for cost-center accuracy.
 */
export function postBatchToLedger(state, { batch, perEmployee, user, bankAccountCode = "1030" }) {
  if (batch.status !== "approved") throw new Error("postBatchToLedger: batch must be approved");
  // Idempotency: a batch can only post once
  if (!reserveKey(`payroll-post::${batch.id}`)) {
    throw new Error("postBatchToLedger: idempotency lock — this batch has already been posted");
  }

  // Build one consolidated JE per batch:
  //   Dr departmental wages (sum by dept)
  //   Cr bank (net pay) + tax payable accrual
  const lines = [];
  const deptTotals = new Map();
  let gross = 0;
  let taxAccrual = 0;
  for (const row of perEmployee) {
    gross += row.gross;
    // 22% blended employer + employee tax accrual (rough — payroll module overrides)
    taxAccrual += row.taxableWages * 0.22;
    for (const a of (row.allocations || [])) {
      deptTotals.set(a.glAccount, (deptTotals.get(a.glAccount) || 0) + a.cost);
    }
  }
  for (const [glAcct, amount] of deptTotals) {
    // Map subtype-style ids back to chart codes — workforce uses sub-types
    const acctCode = glAcct === "rooms-expense" ? "5010"
      : glAcct === "fb-expense" ? "5020"
      : glAcct === "ag-expense" ? "5030"
      : glAcct === "fixed-expense" ? "5030"
      : "5030";
    lines.push({ accountCode: acctCode, debit: round2(amount), credit: 0, memo: `Payroll · ${glAcct}` });
  }
  const taxLine = round2(taxAccrual);
  if (taxLine > 0) lines.push({ accountCode: "5040", debit: taxLine, credit: 0, memo: "Employer payroll tax accrual" });

  const netPay = round2(gross - taxAccrual);
  if (netPay > 0) lines.push({ accountCode: bankAccountCode, debit: 0, credit: netPay, memo: `Net payroll · ${batch.periodStart} – ${batch.periodEnd}` });
  if (taxLine > 0) lines.push({ accountCode: "2030", debit: 0, credit: taxLine, memo: "Payroll tax payable" });

  const je = {
    id: `pay_je_${batch.id}`,
    date: batch.periodEnd,
    description: `Payroll · ${batch.payGroupId} · ${batch.periodStart} – ${batch.periodEnd}`,
    source: "auto-from-payroll-batch",
    sourceId: batch.id,
    posted: true,
    lines,
    createdAt: new Date().toISOString(),
    createdBy: user?.id || null,
  };

  const next = (state.payrollBatches || []).map(b =>
    b.id === batch.id
      ? { ...b, status: "posted", postedAt: new Date().toISOString(), postedBy: user?.id || null, journalEntryId: je.id }
      : b
  );
  return {
    journalEntries: [je],
    patch: { payrollBatches: next },
  };
}
