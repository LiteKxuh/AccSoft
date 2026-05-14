/* HotelOps · Workforce — scheduling engine
 * =================================================================
 * Generates and validates hotel-native schedules tied directly to
 * forecast occupancy + arrivals/departures + room-attendant
 * productivity targets. Pure functions; no UI here.
 *
 *   buildScheduleFromForecast({ days, employees, jobCodes, occupancyDays, opts })
 *     → schedule entries with role/department alignment
 *
 *   validateSchedule({ schedule, employees, weekStart, weekEnd, rule, budget })
 *     → { ok, issues[] }   covers double-booking, OT risk, certification gaps
 *
 *   scoreScheduleEfficiency({ schedule, occupancyDays, productivityTarget })
 *     → { coverage, drift, score }
 *
 *   simulateLaborCost({ schedule, employees, blendedRate, otRule })
 *     → { totalCost, byDate, byDepartment, byEmployee }
 *
 *   publishSchedule(state, { schedule, weekStart, user })
 *     → state patch with audit-safe history
 */

import { computeOvertime, estimateGross } from "./overtimeRules.js";
import { getJobCode, DEPARTMENTS, jobCodesByDepartment } from "./jobCodes.js";
import { isActive, canWorkJob, canWorkDepartment } from "./employeeProfile.js";

const DEFAULT_SHIFT_HOURS = 8;

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

const STAFFING_RATIOS = {
  // rooms cleaned per attendant per 8h shift, by tier
  housekeeping: { economy: 18, midscale: 16, upscale: 14, "upper-upscale": 13, luxury: 11 },
  // front-desk agents required by occupancy band
  front_office: { low: 1, mid: 2, high: 3, peak: 3 },
  // banquet ratios: servers per 100 covers
  banquets: 2.5,
};

function tierForAdr(adr) {
  if (adr >= 250) return "luxury";
  if (adr >= 170) return "upper-upscale";
  if (adr >= 110) return "upscale";
  if (adr >= 70)  return "midscale";
  return "economy";
}

/**
 * Build a draft schedule for a window given occupancy days + employees.
 *
 * @param {object} input
 * @param {Array}  input.days           [{ date, occupancy, capacity, arrivals?, departures?, banquetCovers? }]
 * @param {Array}  input.employees      normalized employees
 * @param {object} [input.opts]         { tier, productivityOverride, blendedRate, otRule, frontDeskMin = 1 }
 */
export function buildScheduleFromForecast({ days = [], employees = [], opts = {} } = {}) {
  if (!Array.isArray(days) || !days.length) return { entries: [], notes: ["no days provided"] };
  if (!Array.isArray(employees) || !employees.length) return { entries: [], notes: ["no employees provided"] };

  const tier = opts.tier || "midscale";
  const hkPerShift = opts.productivityOverride || STAFFING_RATIOS.housekeeping[tier] || 14;
  const frontDeskMin = opts.frontDeskMin || 1;
  const banquetServersPer100 = STAFFING_RATIOS.banquets;
  const activeEmployees = employees.filter(isActive);

  const entries = [];
  const notes = [];

  // Buckets of employees by department
  const empByDept = new Map();
  for (const e of activeEmployees) {
    const dept = e.homeDepartment || (e.allowedDepartments?.[0]);
    if (!dept) continue;
    if (!empByDept.has(dept)) empByDept.set(dept, []);
    empByDept.get(dept).push(e);
  }

  for (const day of days) {
    const occ = safe(day.occupancy);
    const cap = safe(day.capacity);
    const roomsToClean = Math.round(occ * cap);
    const arrivals = safe(day.arrivals);
    const departures = safe(day.departures);
    const covers = safe(day.banquetCovers);

    // Housekeeping
    const hkHeadcount = roomsToClean > 0 ? Math.ceil(roomsToClean / hkPerShift) : 0;
    appendDepartmentShifts({
      entries, notes,
      empByDept, day, dept: "housekeeping",
      jobCodeId: "room_attendant", count: hkHeadcount, shiftHours: DEFAULT_SHIFT_HOURS,
    });

    // Front office staffing curve
    const fdBand = occ < 0.5 ? "low" : occ < 0.75 ? "mid" : occ < 0.9 ? "high" : "peak";
    const fdCount = Math.max(frontDeskMin, STAFFING_RATIOS.front_office[fdBand] || frontDeskMin);
    // Bump for arrival/departure peaks
    const fdAdjusted = arrivals + departures > cap * 0.6 ? fdCount + 1 : fdCount;
    appendDepartmentShifts({
      entries, notes,
      empByDept, day, dept: "front_office",
      jobCodeId: "front_desk_agent", count: fdAdjusted, shiftHours: DEFAULT_SHIFT_HOURS,
    });

    // Banquets (only when covers > 0)
    if (covers > 0) {
      const bqCount = Math.ceil((covers / 100) * banquetServersPer100);
      appendDepartmentShifts({
        entries, notes,
        empByDept, day, dept: "banquets",
        jobCodeId: "banquet_server", count: bqCount, shiftHours: DEFAULT_SHIFT_HOURS,
      });
    }
  }

  return { entries, notes };
}

function appendDepartmentShifts({ entries, notes, empByDept, day, dept, jobCodeId, count, shiftHours }) {
  if (count <= 0) return;
  const pool = (empByDept.get(dept) || []).filter(e =>
    canWorkDepartment(e, dept) && canWorkJob(e, jobCodeId)
  );
  if (!pool.length) {
    notes.push(`${day.date} · no ${dept} employees available — ${count} shift${count === 1 ? "" : "s"} unfilled`);
    return;
  }
  for (let i = 0; i < count; i++) {
    const emp = pool[i % pool.length]; // round-robin assignment
    entries.push({
      id: `sch_${day.date}_${dept}_${i}_${emp.id}`,
      date: day.date,
      employeeId: emp.id,
      jobCodeId,
      departmentId: dept,
      hours: shiftHours,
      status: "draft",
      generatedFromForecast: true,
    });
  }
  if (count > pool.length) {
    notes.push(`${day.date} · ${dept} overfills pool by ${count - pool.length} — round-robin duplicates`);
  }
}

/**
 * Validate a schedule for OT exposure, double-booking, and certification gaps.
 */
export function validateSchedule({ schedule = [], employees = [], weekStart, weekEnd, rule = "FLSA" } = {}) {
  const issues = [];
  const empById = new Map(employees.map(e => [e.id, e]));
  // Same-day double-booking
  const byEmpDate = new Map();
  for (const s of schedule) {
    const key = `${s.employeeId}::${s.date}`;
    byEmpDate.set(key, (byEmpDate.get(key) || 0) + safe(s.hours));
    if ((byEmpDate.get(key) || 0) > 16) {
      issues.push({ severity: "high", code: "impossible-hours", detail: `${s.employeeId} scheduled >16h on ${s.date}` });
    }
  }
  // OT projection per employee
  const byEmp = new Map();
  for (const s of schedule) {
    if (!s.date || !s.hours) continue;
    if (!byEmp.has(s.employeeId)) byEmp.set(s.employeeId, []);
    byEmp.get(s.employeeId).push({ date: s.date, hours: safe(s.hours) });
  }
  for (const [empId, shifts] of byEmp) {
    const emp = empById.get(empId);
    if (!emp || !emp.overtimeEligible) continue;
    const split = computeOvertime({ shifts, rule, wage: emp.hourlyRate });
    if (split.ot > 0) {
      issues.push({
        severity: split.ot > 8 ? "medium" : "low",
        code: "ot-projected",
        detail: `${emp.name || empId}: ${split.regular}h reg + ${split.ot}h OT projected`,
      });
    }
    if (split.doubleTime > 0) {
      issues.push({
        severity: "high",
        code: "double-time-projected",
        detail: `${emp.name || empId}: ${split.doubleTime}h double-time projected`,
      });
    }
  }
  // Certification gaps (when jobCode declares required certs)
  for (const s of schedule) {
    const jc = getJobCode(s.jobCodeId);
    if (!jc?.requiredCerts) continue;
    const emp = empById.get(s.employeeId);
    if (!emp) continue;
    const has = new Set(emp.certifications || []);
    const missing = jc.requiredCerts.filter(c => !has.has(c));
    if (missing.length) {
      issues.push({ severity: "medium", code: "cert-missing", detail: `${emp.name || s.employeeId} missing ${missing.join(", ")} for ${jc.label}` });
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Score how well a schedule matches forecast demand.
 */
export function scoreScheduleEfficiency({ schedule = [], occupancyDays = [], productivityTarget = 14, blendedRate = 22 }) {
  if (!schedule.length || !occupancyDays.length) {
    return { score: null, status: "insufficient-data" };
  }
  // Group schedule by date / department
  const byDate = new Map();
  for (const s of schedule) {
    if (!byDate.has(s.date)) byDate.set(s.date, { hkCount: 0, fdCount: 0, totalHours: 0, totalCost: 0 });
    const d = byDate.get(s.date);
    if (s.departmentId === "housekeeping") d.hkCount += 1;
    if (s.departmentId === "front_office") d.fdCount += 1;
    d.totalHours += safe(s.hours);
    d.totalCost += safe(s.hours) * (safe(s.hourlyRate) || blendedRate);
  }
  let totalGap = 0;
  let totalOver = 0;
  const lines = [];
  for (const day of occupancyDays) {
    const sched = byDate.get(day.date);
    if (!sched) continue;
    const roomsToClean = Math.round(safe(day.occupancy) * safe(day.capacity));
    const requiredHk = Math.ceil(roomsToClean / productivityTarget);
    const hkFit = sched.hkCount - requiredHk;
    if (hkFit < 0) totalGap += Math.abs(hkFit);
    else totalOver += hkFit;
    lines.push({
      date: day.date,
      occupancy: day.occupancy,
      requiredHk,
      scheduledHk: sched.hkCount,
      fit: hkFit,
      totalCost: round2(sched.totalCost),
    });
  }
  // Score: 100 baseline, -10 per gap, -5 per overstaff
  const score = Math.max(0, Math.min(100, 100 - totalGap * 10 - totalOver * 5));
  return {
    status: "ok",
    score,
    band: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "watch" : "poor",
    totalGap,
    totalOver,
    lines,
  };
}

/**
 * Estimate labor cost for a proposed schedule using OT rules + employee rates.
 */
export function simulateLaborCost({ schedule = [], employees = [], blendedRate = 22, otRule = "FLSA" } = {}) {
  const empById = new Map(employees.map(e => [e.id, e]));
  // Group by employee then OT
  const byEmp = new Map();
  for (const s of schedule) {
    if (!byEmp.has(s.employeeId)) byEmp.set(s.employeeId, []);
    byEmp.get(s.employeeId).push({ date: s.date, hours: safe(s.hours), jobCodeId: s.jobCodeId, departmentId: s.departmentId, hourlyRate: s.hourlyRate });
  }

  let totalCost = 0;
  const byEmployee = [];
  const byDate = new Map();
  const byDepartment = new Map();
  for (const [empId, shifts] of byEmp) {
    const emp = empById.get(empId);
    const rate = safe(emp?.hourlyRate) || safe(shifts[0]?.hourlyRate) || blendedRate;
    const split = computeOvertime({ shifts: shifts.map(s => ({ date: s.date, hours: s.hours })), rule: otRule, wage: rate });
    const gross = estimateGross({ split, hourlyRate: rate });
    totalCost += gross;
    byEmployee.push({ employeeId: empId, name: emp?.name || empId, gross, ...split });
    // Allocate by date weighting / department
    for (const sh of shifts) {
      const dayCost = round2(sh.hours * rate); // straight-time allocation
      byDate.set(sh.date, (byDate.get(sh.date) || 0) + dayCost);
      const dept = sh.departmentId || "Other";
      byDepartment.set(dept, (byDepartment.get(dept) || 0) + dayCost);
    }
  }

  return {
    totalCost: round2(totalCost),
    byDate: Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, cost]) => ({ date, cost: round2(cost) })),
    byDepartment: Array.from(byDepartment.entries()).sort((a, b) => b[1] - a[1]).map(([dept, cost]) => ({ department: dept, cost: round2(cost) })),
    byEmployee: byEmployee.sort((a, b) => b.gross - a.gross),
  };
}

/**
 * Publish a schedule into state with audit history.
 */
export function publishSchedule(state, { schedule = [], weekStart, user }) {
  const existing = state.schedule || [];
  const filtered = existing.filter(s => !schedule.find(n => n.id === s.id));
  const published = schedule.map(s => ({
    ...s,
    status: "published",
    publishedAt: new Date().toISOString(),
    publishedBy: user?.id || null,
    history: [...(s.history || []), { at: new Date().toISOString(), by: user?.id || null, action: "publish" }],
  }));
  return { schedule: [...filtered, ...published] };
}

export { STAFFING_RATIOS, tierForAdr };
