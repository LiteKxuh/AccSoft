/* HotelOps · Workforce — time & attendance engine
 * =================================================================
 * Enterprise-grade clock/punch logic. All shift records flow through
 * here so missed punches, break compliance, and overnight rollover
 * are handled uniformly.
 *
 *   normalizePunch(raw)                  → validated punch record
 *   computeShiftHours(shift, opts)       → { gross, paid, breakMinutes, mealCompliance }
 *   detectMissedPunches(shifts, asOf)    → [{ shift, issue }]
 *   detectOvertimeRisk(shifts, employee, period, rule?)
 *   buildExceptionQueue(shifts, asOf)    → prioritized list of issues
 *   approveShiftEdit(state, shiftId, patch, user) → state patch (audit-safe)
 *
 * Idempotent — every shift edit is appended to shift.history, original
 * fields preserved.
 */

import { computeOvertime } from "./overtimeRules.js";

const MAX_REASONABLE_SHIFT_HOURS = 16;
const MEAL_BREAK_THRESHOLD_HOURS = 5;   // CA rule of thumb
const MEAL_BREAK_REQUIRED_MINUTES = 30;

function isoDateTime(d) {
  return d.toISOString();
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizePunch(raw) {
  if (!raw) throw new Error("normalizePunch: empty record");
  const clockIn = parseDate(raw.clockIn);
  if (!clockIn) throw new Error("normalizePunch: clockIn invalid");
  const clockOut = raw.clockOut ? parseDate(raw.clockOut) : null;
  if (clockOut && clockOut < clockIn) {
    // Implicit overnight rollover — bump clockOut by 24h if it falls before clockIn within 18h
    if ((clockIn - clockOut) < 18 * 3600_000) {
      clockOut.setUTCDate(clockOut.getUTCDate() + 1);
    } else {
      throw new Error("normalizePunch: clockOut before clockIn beyond reasonable rollover window");
    }
  }
  return {
    id: raw.id,
    employeeId: raw.employeeId,
    propertyId: raw.propertyId || null,
    jobCodeId: raw.jobCodeId || null,
    departmentId: raw.departmentId || null,
    clockIn: isoDateTime(clockIn),
    clockOut: clockOut ? isoDateTime(clockOut) : null,
    breakMinutes: Math.max(0, Number(raw.breakMinutes) || 0),
    notes: raw.notes || "",
    source: raw.source || "manual",
    history: raw.history || [],
  };
}

/**
 * Compute hours for a shift with break + meal compliance logic.
 */
export function computeShiftHours(shift) {
  if (!shift) return { gross: 0, paid: 0, breakMinutes: 0, mealCompliance: "n/a", overnight: false };
  const ci = parseDate(shift.clockIn);
  const co = shift.clockOut ? parseDate(shift.clockOut) : null;
  if (!ci || !co) return { gross: 0, paid: 0, breakMinutes: 0, mealCompliance: "n/a", overnight: false };
  const grossMs = co - ci;
  const grossHours = grossMs / 3600_000;
  const breakMinutes = Math.max(0, Number(shift.breakMinutes) || 0);
  const paidHours = Math.max(0, grossHours - breakMinutes / 60);
  const isOvernight = ci.getUTCDate() !== co.getUTCDate();

  let mealCompliance = "n/a";
  if (grossHours >= MEAL_BREAK_THRESHOLD_HOURS) {
    mealCompliance = breakMinutes >= MEAL_BREAK_REQUIRED_MINUTES ? "compliant" : "violation";
  }

  return {
    gross: round2(grossHours),
    paid: round2(paidHours),
    breakMinutes,
    mealCompliance,
    overnight: isOvernight,
  };
}

/**
 * Find shifts with missed clock-outs, impossible durations, or other anomalies.
 */
export function detectMissedPunches(shifts = [], asOf = new Date()) {
  const issues = [];
  const cutoff = asOf instanceof Date ? asOf : new Date(asOf);
  for (const s of shifts) {
    const ci = parseDate(s.clockIn);
    if (!ci) {
      issues.push({ shift: s, issue: "invalid-clock-in", severity: "high" });
      continue;
    }
    if (!s.clockOut) {
      const ageHours = (cutoff - ci) / 3600_000;
      if (ageHours > MAX_REASONABLE_SHIFT_HOURS) {
        issues.push({ shift: s, issue: "missed-clock-out", severity: "high", detail: `${ageHours.toFixed(1)}h since clock-in` });
      } else if (ageHours > 8) {
        issues.push({ shift: s, issue: "still-clocked-in", severity: "medium", detail: `${ageHours.toFixed(1)}h` });
      }
      continue;
    }
    const hours = computeShiftHours(s);
    if (hours.gross > MAX_REASONABLE_SHIFT_HOURS) {
      issues.push({ shift: s, issue: "implausible-duration", severity: "high", detail: `${hours.gross}h shift` });
    }
    if (hours.mealCompliance === "violation") {
      issues.push({ shift: s, issue: "meal-break-violation", severity: "medium", detail: `${hours.gross}h shift with ${hours.breakMinutes}min break` });
    }
  }
  return issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
}

function severityWeight(s) { return s === "high" ? 3 : s === "medium" ? 2 : 1; }

/**
 * For a given employee over a period, predict whether they'll trip OT.
 */
export function detectOvertimeRisk({ shifts, employee, periodStart, periodEnd, rule = "FLSA" }) {
  const empShifts = shifts.filter(s => s.employeeId === employee.id && s.clockIn >= periodStart && s.clockIn <= periodEnd + "T23:59:59");
  const dailyHours = empShifts.map(s => ({ date: s.clockIn.slice(0, 10), hours: computeShiftHours(s).paid }));
  const split = computeOvertime({ shifts: dailyHours, rule, wage: employee.hourlyRate });
  const risk = split.ot > 0 || split.doubleTime > 0 ? "yes" : split.totalHours > 36 ? "borderline" : "no";
  return { split, risk };
}

/**
 * Aggregated exception queue with severity ranking — what the manager
 * should review first.
 */
export function buildExceptionQueue(shifts = [], asOf = new Date()) {
  const missed = detectMissedPunches(shifts, asOf);
  return missed.map(m => ({
    shiftId: m.shift.id,
    employeeId: m.shift.employeeId,
    date: (m.shift.clockIn || "").slice(0, 10),
    issue: m.issue,
    severity: m.severity,
    detail: m.detail || "",
  }));
}

/** Audit-safe edit: append the change to shift.history. */
export function approveShiftEdit(shift, patch, user) {
  if (!shift) throw new Error("approveShiftEdit: shift required");
  if (!patch || typeof patch !== "object") throw new Error("approveShiftEdit: patch required");
  const history = [
    ...(shift.history || []),
    {
      at: new Date().toISOString(),
      by: user?.id || null,
      reason: patch._reason || patch.reason || "manager-edit",
      before: pickEditableFields(shift),
      after: pickEditableFields(patch),
    },
  ];
  const next = {
    ...shift,
    ...patch,
    history,
    lastEditedAt: new Date().toISOString(),
    lastEditedBy: user?.id || null,
  };
  delete next._reason;
  delete next.reason;
  return next;
}

function pickEditableFields(o) {
  if (!o) return {};
  const fields = ["clockIn", "clockOut", "breakMinutes", "jobCodeId", "departmentId", "notes"];
  const out = {};
  for (const f of fields) if (o[f] !== undefined) out[f] = o[f];
  return out;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
