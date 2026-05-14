/* HotelOps · Workforce — pay-code engine
 * =================================================================
 * Pay codes are the granular line items that make up a payroll
 * check. Standard hospitality codes:
 *
 *   REG  — regular hours × rate
 *   OT   — overtime hours × rate × 1.5
 *   DT   — double-time hours × rate × 2
 *   HOL  — holiday premium (additional 0.5× over straight)
 *   PTO  — paid time off
 *   SICK — sick pay
 *   HOL_PAY — paid holiday off
 *   BONUS — discretionary bonus
 *   SVC  — service charge allocation
 *   TIPS — cash tips reported
 *   TIPS_CC — credit card tip allocation
 *   ADJ  — manager adjustment (must carry reason + approver)
 *
 * Each pay code has:
 *   - id
 *   - label
 *   - category: "earnings" | "benefit" | "tip" | "adjustment"
 *   - taxableAsWage: boolean
 *   - includedInOvertimeBase: boolean (FLSA regular rate)
 *   - glAccount: where to post the payroll expense
 */

export const PAY_CODES = [
  { id: "REG",      label: "Regular",                category: "earnings",    taxableAsWage: true,  includedInOvertimeBase: true,  glAccount: null },
  { id: "OT",       label: "Overtime (1.5×)",        category: "earnings",    taxableAsWage: true,  includedInOvertimeBase: false, glAccount: null },
  { id: "DT",       label: "Double Time (2×)",       category: "earnings",    taxableAsWage: true,  includedInOvertimeBase: false, glAccount: null },
  { id: "HOL",      label: "Holiday Premium (0.5×)", category: "earnings",    taxableAsWage: true,  includedInOvertimeBase: false, glAccount: null },
  { id: "PTO",      label: "PTO",                    category: "benefit",     taxableAsWage: true,  includedInOvertimeBase: false, glAccount: "5040" },
  { id: "SICK",     label: "Sick Pay",               category: "benefit",     taxableAsWage: true,  includedInOvertimeBase: false, glAccount: "5040" },
  { id: "HOL_PAY",  label: "Paid Holiday",           category: "benefit",     taxableAsWage: true,  includedInOvertimeBase: false, glAccount: "5040" },
  { id: "BONUS",    label: "Bonus",                  category: "earnings",    taxableAsWage: true,  includedInOvertimeBase: true,  glAccount: null },
  { id: "SVC",      label: "Service Charge",         category: "earnings",    taxableAsWage: true,  includedInOvertimeBase: true,  glAccount: null },
  { id: "TIPS",     label: "Reported Tips (cash)",   category: "tip",         taxableAsWage: true,  includedInOvertimeBase: false, glAccount: null },
  { id: "TIPS_CC",  label: "Tips (credit card)",     category: "tip",         taxableAsWage: true,  includedInOvertimeBase: false, glAccount: null },
  { id: "ADJ",      label: "Manager Adjustment",     category: "adjustment",  taxableAsWage: true,  includedInOvertimeBase: false, glAccount: null, requiresApproval: true },
];

const BY_ID = new Map(PAY_CODES.map(p => [p.id, p]));

export function getPayCode(id) { return BY_ID.get(id) || null; }

/**
 * Build the line items for a single employee from an OT split + extras.
 *
 * @param {object} input
 * @param {object} input.split   from computeOvertime
 * @param {number} input.rate
 * @param {object} [input.extras] { ptoHours, sickHours, holidayPaidHours, bonus, tips, tipsCC, serviceCharge, adjustments }
 * @returns {Array} pay-code lines
 */
export function buildPayCodeLines({ split, rate, extras = {} }) {
  const lines = [];
  const r = Number(rate) || 0;
  if (!split) split = { regular: 0, ot: 0, doubleTime: 0, holiday: 0 };

  if (split.regular > 0) lines.push({ code: "REG", hours: split.regular, rate: r, amount: round2(split.regular * r) });
  if (split.ot > 0)      lines.push({ code: "OT",  hours: split.ot, rate: r * 1.5, amount: round2(split.ot * r * 1.5) });
  if (split.doubleTime > 0) lines.push({ code: "DT", hours: split.doubleTime, rate: r * 2, amount: round2(split.doubleTime * r * 2) });
  if (split.holiday > 0) lines.push({ code: "HOL", hours: split.holiday, rate: r * 0.5, amount: round2(split.holiday * r * 0.5) });

  const ext = extras || {};
  if (ext.ptoHours > 0)         lines.push({ code: "PTO", hours: ext.ptoHours, rate: r, amount: round2(ext.ptoHours * r) });
  if (ext.sickHours > 0)        lines.push({ code: "SICK", hours: ext.sickHours, rate: r, amount: round2(ext.sickHours * r) });
  if (ext.holidayPaidHours > 0) lines.push({ code: "HOL_PAY", hours: ext.holidayPaidHours, rate: r, amount: round2(ext.holidayPaidHours * r) });
  if (ext.bonus > 0)            lines.push({ code: "BONUS", hours: 0, rate: 0, amount: round2(ext.bonus) });
  if (ext.serviceCharge > 0)    lines.push({ code: "SVC", hours: 0, rate: 0, amount: round2(ext.serviceCharge) });
  if (ext.tips > 0)             lines.push({ code: "TIPS", hours: 0, rate: 0, amount: round2(ext.tips) });
  if (ext.tipsCC > 0)           lines.push({ code: "TIPS_CC", hours: 0, rate: 0, amount: round2(ext.tipsCC) });
  if (Array.isArray(ext.adjustments)) {
    for (const a of ext.adjustments) {
      if (!(Number(a.amount) !== 0)) continue;
      if (!a.reason) throw new Error("paycode ADJ: reason required");
      if (!a.approvedBy) throw new Error("paycode ADJ: approvedBy required");
      lines.push({ code: "ADJ", hours: 0, rate: 0, amount: round2(a.amount), reason: a.reason, approvedBy: a.approvedBy });
    }
  }

  return lines;
}

export function sumLines(lines) {
  let gross = 0, taxableWages = 0, tips = 0, benefits = 0, adjustments = 0;
  for (const l of (lines || [])) {
    const def = BY_ID.get(l.code);
    const amt = Number(l.amount) || 0;
    gross += amt;
    if (def?.taxableAsWage) taxableWages += amt;
    if (def?.category === "tip") tips += amt;
    if (def?.category === "benefit") benefits += amt;
    if (def?.category === "adjustment") adjustments += amt;
  }
  return {
    gross: round2(gross),
    taxableWages: round2(taxableWages),
    tips: round2(tips),
    benefits: round2(benefits),
    adjustments: round2(adjustments),
  };
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
