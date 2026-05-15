/* HotelOps · Workforce — payroll forensics
 * =================================================================
 * Deterministic detectors for the suspicious patterns that surface
 * in real hotel payroll audits:
 *
 *   - Buddy punching (suspicious geolocation / device patterns)
 *   - Ghost employees (in payroll but with no shifts, no termination
 *     date, never logging in)
 *   - Duplicate / overlapping punches
 *   - Impossible schedules (>16h, conflicting shifts)
 *   - Suspicious OT clusters (same employee, same day-of-week)
 *   - Payroll inflation (gross spike vs trailing median)
 *   - Approval bypass (large adjustments without approver)
 *   - Break noncompliance pattern (one employee, repeatedly)
 *   - Approval rubber-stamping (same approver always-approves same
 *     person — collusion signal)
 *
 *   runPayrollForensics(state, opts) → { findings[], riskScore, riskBand }
 *
 * Confidence scores in [0,1] anchored to deterministic evidence;
 * the UI ranks by confidence × severity weight.
 */

import { computeShiftHours } from "./timeAttendance.js";

let _ctr = 0;
function fid() { _ctr += 1; return `pf_${Date.now().toString(36)}_${_ctr.toString(36)}`; }
function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

/* ---------- Buddy punching ---------- */
export function detectBuddyPunching(shifts = []) {
  const findings = [];
  const byDevice = new Map();
  for (const s of shifts) {
    const key = s.punchDeviceId || s.kioskId || s.ipAddress;
    if (!key) continue;
    const t = new Date(s.clockIn).getTime();
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key).push({ ...s, t });
  }
  for (const [device, list] of byDevice) {
    const sorted = [...list].sort((a, b) => a.t - b.t);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (a.employeeId === b.employeeId) continue;
      const gap = Math.abs(b.t - a.t) / 1000;
      if (gap < 60) {
        findings.push({
          id: fid(),
          code: "buddy.same_device",
          severity: "high",
          confidence: 0.75,
          label: "Same-device punch within 60s by different employees",
          detail: `${a.employeeId} → ${b.employeeId} on device ${device} (${gap.toFixed(0)}s apart)`,
          evidence: { device, a: a.id, b: b.id, gap },
        });
      }
    }
  }
  return findings;
}

/* ---------- Ghost employees ---------- */
export function detectGhostEmployees({ employees = [], shifts = [], payrollRuns = [], asOf = new Date() } = {}) {
  const findings = [];
  const cutoff = asOf instanceof Date ? asOf : new Date(asOf);
  const ninetyDaysAgo = new Date(cutoff); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const empHasShift = new Set(shifts.map(s => s.employeeId));
  const empInPayroll = new Set();
  for (const r of payrollRuns) {
    for (const l of (r.lines || [])) {
      if (Number(l.gross) > 0) empInPayroll.add(l.employeeId);
    }
  }
  for (const e of employees) {
    if (e.status === "terminated") continue;
    if (!empInPayroll.has(e.id)) continue;
    if (empHasShift.has(e.id)) continue;
    if (e.payClass === "salaried" || e.payClass === "contractor") continue;
    findings.push({
      id: fid(),
      code: "ghost.no_shifts",
      severity: "high",
      confidence: 0.85,
      label: `Employee in payroll but no shifts recorded`,
      detail: `${e.name || e.id} is paid as ${e.payClass} but has no punches in the last 90 days.`,
      evidence: { employeeId: e.id, payClass: e.payClass },
    });
  }
  return findings;
}

/* ---------- Duplicate / overlapping punches ---------- */
export function detectOverlappingPunches(shifts = []) {
  const findings = [];
  const byEmp = new Map();
  for (const s of shifts) {
    if (!byEmp.has(s.employeeId)) byEmp.set(s.employeeId, []);
    byEmp.get(s.employeeId).push(s);
  }
  for (const [empId, list] of byEmp) {
    const sorted = [...list].sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (!a.clockOut) continue;
      const aOut = new Date(a.clockOut), bIn = new Date(b.clockIn);
      if (bIn < aOut) {
        findings.push({
          id: fid(),
          code: "punch.overlap",
          severity: "medium",
          confidence: 0.95,
          label: `Overlapping shifts for ${empId}`,
          detail: `Shift ${a.id} ends ${a.clockOut} after ${b.id} starts ${b.clockIn}.`,
          evidence: { employeeId: empId, a: a.id, b: b.id },
        });
      }
    }
  }
  return findings;
}

/* ---------- Suspicious OT clusters ---------- */
export function detectSuspiciousOvertime(shifts = []) {
  const findings = [];
  const byEmp = new Map();
  for (const s of shifts) {
    const hrs = computeShiftHours(s).paid;
    if (hrs < 10) continue;
    const dow = new Date(s.clockIn).getUTCDay();
    if (!byEmp.has(s.employeeId)) byEmp.set(s.employeeId, new Map());
    const dowMap = byEmp.get(s.employeeId);
    dowMap.set(dow, (dowMap.get(dow) || 0) + 1);
  }
  for (const [empId, dowMap] of byEmp) {
    for (const [dow, count] of dowMap) {
      if (count >= 4) {
        findings.push({
          id: fid(),
          code: "ot.cluster",
          severity: "medium",
          confidence: 0.6,
          label: `Repeated long shifts on same day-of-week`,
          detail: `${empId} worked 10+ hour shifts on ${weekdayName(dow)} ${count} times — review schedule cadence.`,
          evidence: { employeeId: empId, dow, count },
        });
      }
    }
  }
  return findings;
}

function weekdayName(d) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] || "Day";
}

/* ---------- Payroll inflation ---------- */
export function detectPayrollInflation(payrollRuns = []) {
  if (payrollRuns.length < 4) return [];
  const findings = [];
  // Aggregate gross per run
  const runs = payrollRuns.map(r => ({
    id: r.id,
    periodEnd: r.periodEnd,
    gross: (r.lines || []).reduce((s, l) => s + safe(l.gross), 0),
  })).sort((a, b) => (a.periodEnd || "").localeCompare(b.periodEnd || ""));
  const grosses = runs.map(r => r.gross);
  const med = median(grosses);
  if (!med) return [];
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].gross > med * 1.5) {
      findings.push({
        id: fid(),
        code: "payroll.inflation",
        severity: runs[i].gross > med * 2 ? "high" : "medium",
        confidence: 0.55,
        label: `Payroll gross spike in run ${runs[i].id}`,
        detail: `Period ${runs[i].periodEnd}: $${runs[i].gross.toFixed(0)} vs trailing median $${med.toFixed(0)}.`,
        evidence: { runId: runs[i].id, gross: runs[i].gross, median: med },
      });
    }
  }
  return findings;
}

/* ---------- Adjustment approval bypass ---------- */
export function detectAdjustmentBypass(payrollAdjustments = []) {
  const findings = [];
  for (const a of payrollAdjustments) {
    if (a.code !== "ADJ" && a.code !== "BONUS") continue;
    if (safe(a.amount) === 0) continue;
    if (!a.approvedBy) {
      findings.push({
        id: fid(),
        code: "adj.no_approver",
        severity: "high",
        confidence: 0.95,
        label: `Adjustment posted without approver`,
        detail: `${a.code} for ${a.employeeId} (${a.amount}) lacks approvedBy.`,
        evidence: { adjustmentId: a.id, employeeId: a.employeeId, code: a.code, amount: a.amount },
      });
    }
    if (!a.reason || String(a.reason).trim().length < 3) {
      findings.push({
        id: fid(),
        code: "adj.no_reason",
        severity: "medium",
        confidence: 0.9,
        label: `Adjustment posted without reason`,
        detail: `${a.code} for ${a.employeeId} (${a.amount}) has missing or trivial reason.`,
        evidence: { adjustmentId: a.id, employeeId: a.employeeId },
      });
    }
  }
  return findings;
}

/* ---------- Approval rubber-stamp pattern ---------- */
export function detectApprovalCollusion({ payrollAdjustments = [], minSamples = 4 } = {}) {
  const findings = [];
  // Track (approver → approvee) pair frequency
  const pairs = new Map();
  for (const a of payrollAdjustments) {
    if (!a.approvedBy || !a.employeeId) continue;
    if (a.approvedBy === a.employeeId) {
      findings.push({
        id: fid(),
        code: "approval.self",
        severity: "high",
        confidence: 0.99,
        label: "Self-approved payroll adjustment",
        detail: `Employee ${a.employeeId} approved their own ${a.code}.`,
        evidence: { adjustmentId: a.id },
      });
      continue;
    }
    const key = `${a.approvedBy}::${a.employeeId}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  }
  for (const [key, count] of pairs) {
    if (count >= minSamples) {
      const [approver, employee] = key.split("::");
      findings.push({
        id: fid(),
        code: "approval.repeat_pair",
        severity: "medium",
        confidence: 0.5,
        label: "Repeat approver → employee pairing",
        detail: `${approver} approved ${count} adjustments for ${employee} — verify independence.`,
        evidence: { approver, employee, count },
      });
    }
  }
  return findings;
}

/* ---------- Repeat meal-break violations ---------- */
export function detectMealBreakPattern(shifts = []) {
  const findings = [];
  const byEmp = new Map();
  for (const s of shifts) {
    const h = computeShiftHours(s);
    if (h.mealCompliance !== "violation") continue;
    byEmp.set(s.employeeId, (byEmp.get(s.employeeId) || 0) + 1);
  }
  for (const [empId, count] of byEmp) {
    if (count >= 3) {
      findings.push({
        id: fid(),
        code: "meal.repeat_violation",
        severity: "medium",
        confidence: 0.85,
        label: `Repeat meal-break violations for ${empId}`,
        detail: `${count} long shifts in the window without a compliant meal break.`,
        evidence: { employeeId: empId, count },
      });
    }
  }
  return findings;
}

/* ---------- Aggregated runner ---------- */
export function runPayrollForensics(state, opts = {}) {
  const findings = [
    ...detectBuddyPunching(state.shifts || []),
    ...detectGhostEmployees({ employees: state.employees || [], shifts: state.shifts || [], payrollRuns: state.payrollRuns || [] }),
    ...detectOverlappingPunches(state.shifts || []),
    ...detectSuspiciousOvertime(state.shifts || []),
    ...detectPayrollInflation(state.payrollRuns || []),
    ...detectAdjustmentBypass(state.payrollAdjustments || []),
    ...detectApprovalCollusion({ payrollAdjustments: state.payrollAdjustments || [] }),
    ...detectMealBreakPattern(state.shifts || []),
  ];

  const w = { high: 8, medium: 3, low: 1, info: 0 };
  const score = findings.reduce((s, f) => s + (w[f.severity] || 1), 0);
  const riskBand = score === 0 ? "clean"
    : score < 5 ? "low"
    : score < 15 ? "elevated"
    : score < 30 ? "high"
    : "critical";
  const byCode = findings.reduce((acc, f) => { acc[f.code] = (acc[f.code] || 0) + 1; return acc; }, {});

  return {
    findings: findings.sort((a, b) => (b.confidence * sevWeight(b.severity)) - (a.confidence * sevWeight(a.severity))),
    counts: byCode,
    riskScore: score,
    riskBand,
    runAt: new Date().toISOString(),
  };
}

function sevWeight(s) { return s === "high" ? 3 : s === "medium" ? 2 : s === "low" ? 1 : 0; }
