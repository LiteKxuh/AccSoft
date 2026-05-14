/* HotelOps · Labor Optimization Engine
 * =================================================================
 * Concrete labor primitives for hospitality back-office:
 *
 *   roomsPerAttendant({ housekeepingHours, roomsCleaned })
 *     → industry productivity metric. Hotels target 14-18 rooms /
 *       8-hour shift for limited service, 12-14 for full service.
 *
 *   schedulesEfficiency({ schedule, actuals, occupancy })
 *     → 0-100 score of how well the schedule matched what actually
 *       happened. Penalizes both over- and under-coverage.
 *
 *   overtimePredictor({ shifts, employees, windowDays })
 *     → list of employees likely to hit OT this week based on
 *       hours-to-date. Deterministic, no model.
 *
 *   occupancyDrivenStaffing({ forecastOcc, capacity, productivity })
 *     → recommended housekeeping headcount per day.
 *
 *   scheduleSimulation({ schedule, occupancy, productivityTarget })
 *     → cost / coverage estimate for the proposed schedule.
 *
 * Realism: industry benchmarks built in; absurd recommendations
 * (e.g. "30 attendants for 100-room hotel") never emitted.
 */

const PROD_BENCHMARKS = {
  economy:        { roomsPerShift: 18, hoursPerShift: 8, target: 14 },
  midscale:       { roomsPerShift: 16, hoursPerShift: 8, target: 13 },
  upscale:        { roomsPerShift: 14, hoursPerShift: 8, target: 12 },
  "upper-upscale": { roomsPerShift: 13, hoursPerShift: 8, target: 11 },
  luxury:         { roomsPerShift: 11, hoursPerShift: 8, target: 10 },
};

const OT_THRESHOLD_HOURS = 40;

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

/* ---------- Rooms-per-attendant ---------- */

export function roomsPerAttendant({ housekeepingHours, roomsCleaned, tier = "midscale" }) {
  if (!(housekeepingHours > 0) || !(roomsCleaned >= 0)) {
    return { status: "missing-input" };
  }
  const bench = PROD_BENCHMARKS[tier] || PROD_BENCHMARKS.midscale;
  const roomsPerHour = roomsCleaned / housekeepingHours;
  const roomsPerShift = roomsPerHour * bench.hoursPerShift;
  const verdict = roomsPerShift >= bench.target ? "above-target"
    : roomsPerShift >= bench.target * 0.85 ? "near-target"
    : "below-target";
  return {
    status: "ok",
    roomsPerHour,
    roomsPerShift,
    target: bench.target,
    verdict,
    bench,
    headline: `${roomsPerShift.toFixed(1)} rooms/shift · target ${bench.target} for ${tier}`,
  };
}

/* ---------- Schedule efficiency ---------- */

/**
 * Score how well the schedule matched actual demand.
 *   coverageRatio = actual / scheduled — close to 1 is good
 *   demandFit = how well scheduled hours tracked occupancy
 */
export function schedulesEfficiency({ scheduleHours, actualHours, occupancyDays = [] }) {
  if (!(scheduleHours > 0)) return { status: "missing-schedule" };
  const drift = (actualHours - scheduleHours) / scheduleHours;
  // Penalty: 1 - |drift| × 4, floored at 0. So 25% drift → 0 score.
  const driftScore = Math.max(0, 1 - Math.abs(drift) * 4) * 100;

  // Demand fit: if no occupancy data, treat as neutral
  let demandFit = 70;
  if (occupancyDays.length >= 5) {
    // High variance between scheduled hours and occupancy = poor fit
    const occVar = occupancyVariance(occupancyDays);
    demandFit = Math.max(0, 100 - occVar * 200);
  }

  const score = Math.round(driftScore * 0.6 + demandFit * 0.4);
  return {
    status: "ok",
    score,
    drift,
    driftScore: Math.round(driftScore),
    demandFit: Math.round(demandFit),
    band: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "watch" : "poor",
    headline: `Efficiency ${score}/100 · ${(drift * 100).toFixed(1)}% drift`,
  };
}

function occupancyVariance(days) {
  // Coefficient of variation of daily occupancy. Higher = more demand swing.
  const occs = days.map(d => safe(d.occupancy)).filter(v => v > 0);
  if (occs.length < 2) return 0;
  const mean = occs.reduce((s, v) => s + v, 0) / occs.length;
  if (!mean) return 0;
  const variance = occs.reduce((s, v) => s + (v - mean) ** 2, 0) / occs.length;
  return Math.sqrt(variance) / mean;
}

/* ---------- Overtime predictor ---------- */

export function overtimePredictor({ shifts, employees, weekStart, weekEnd }) {
  const weekStartD = new Date(weekStart);
  const weekEndD = new Date(weekEnd); weekEndD.setHours(23, 59, 59, 999);
  const eById = new Map((employees || []).map(e => [e.id, e]));
  const byEmp = new Map();
  for (const s of (shifts || [])) {
    const d = new Date(s.clockIn || s.date);
    if (d < weekStartD || d > weekEndD) continue;
    const start = new Date(s.clockIn);
    const end = s.clockOut ? new Date(s.clockOut) : null;
    if (!end || isNaN(start) || isNaN(end)) continue;
    const hrs = Math.max(0, (end - start) / (3600 * 1000) - (Number(s.breakMinutes) || 0) / 60);
    byEmp.set(s.employeeId, (byEmp.get(s.employeeId) || 0) + hrs);
  }
  const predictions = [];
  for (const [empId, hours] of byEmp) {
    if (hours <= 0) continue;
    const e = eById.get(empId);
    const daysIntoWeek = Math.max(1, Math.ceil((Date.now() - weekStartD.getTime()) / 86400000));
    const projectionFactor = daysIntoWeek > 0 ? 7 / Math.min(7, daysIntoWeek) : 1;
    const projectedHours = hours * projectionFactor;
    const overOT = projectedHours - OT_THRESHOLD_HOURS;
    predictions.push({
      employeeId: empId,
      employeeName: e?.name || empId,
      hoursToDate: hours,
      projectedHours,
      overTimeRisk: overOT > 0 ? "yes" : overOT > -4 ? "borderline" : "no",
      otHoursProjected: Math.max(0, overOT),
    });
  }
  return predictions.sort((a, b) => b.projectedHours - a.projectedHours);
}

/* ---------- Occupancy-driven staffing ---------- */

/**
 * Recommend a housekeeping headcount for a future date given forecast occupancy
 * and a productivity benchmark.
 */
export function occupancyDrivenStaffing({ forecastOcc, capacity, tier = "midscale", productivityOverride = null }) {
  const occ = safe(forecastOcc);
  const cap = safe(capacity);
  if (!cap) return { status: "missing-capacity" };
  const bench = PROD_BENCHMARKS[tier] || PROD_BENCHMARKS.midscale;
  const target = productivityOverride || bench.target;
  const roomsToClean = Math.round(occ * cap);
  const headcount = roomsToClean > 0 ? Math.ceil(roomsToClean / target) : 0;
  const totalHours = headcount * bench.hoursPerShift;
  return {
    status: "ok",
    occupancy: occ,
    roomsToClean,
    headcount,
    totalHours,
    productivityTarget: target,
    rationale: `${roomsToClean} rooms ÷ ${target} rooms/attendant = ${headcount} attendants × ${bench.hoursPerShift}h = ${totalHours}h.`,
  };
}

/* ---------- Schedule simulation ---------- */

/**
 * Cost and coverage estimate for a proposed schedule.
 */
export function scheduleSimulation({ schedule, employees, blendedHourlyRate = 22, productivityTarget = 14, occupancyDays = [] }) {
  const eById = new Map((employees || []).map(e => [e.id, e]));
  const byDate = new Map();
  for (const s of (schedule || [])) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  const lines = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, list]) => {
    const totalHours = list.reduce((s, x) => s + safe(x.hours || x.scheduledHours || 8), 0);
    const totalCost = list.reduce((s, x) => {
      const emp = eById.get(x.employeeId);
      const rate = safe(emp?.hourlyRate) || blendedHourlyRate;
      return s + rate * safe(x.hours || 8);
    }, 0);
    const occ = occupancyDays.find(o => o.date === date);
    const roomsNeeded = occ ? Math.round(safe(occ.occupancy) * safe(occ.capacity)) : null;
    const requiredAttendants = roomsNeeded != null ? Math.ceil(roomsNeeded / productivityTarget) : null;
    const scheduledAttendants = list.length;
    const fit = requiredAttendants != null
      ? scheduledAttendants - requiredAttendants
      : null;
    return {
      date,
      totalHours,
      totalCost,
      scheduledAttendants,
      requiredAttendants,
      fit, // positive = overstaffed, negative = understaffed
      occupancy: occ?.occupancy,
    };
  });
  return {
    status: "ok",
    lines,
    totalCost: lines.reduce((s, l) => s + l.totalCost, 0),
    totalHours: lines.reduce((s, l) => s + l.totalHours, 0),
  };
}

export { PROD_BENCHMARKS };
