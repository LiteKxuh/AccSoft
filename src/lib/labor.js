/* HotelOps · Labor cost analytics
 * =================================================================
 * CPOR (Cost Per Occupied Room), labor % of revenue, scheduled vs.
 * actual hours, productivity by department. Pure functions — given
 * shifts/schedule/employees/reports, compute analytics.
 */

const DEPT_KEYWORDS = {
  Rooms: ["housekeep", "front desk", "guest service", "concierge", "bell", "valet"],
  "F&B": ["restaurant", "kitchen", "bartender", "server", "cook", "chef", "host", "barback", "banquet", "catering"],
  Maintenance: ["maintenance", "engineer", "facilities", "groundskeep"],
  Sales: ["sales", "marketing", "revenue manager"],
  "G&A": ["accounting", "hr", "general manager", "controller", "office", "admin"],
};

export function classifyEmployeeDepartment(emp) {
  if (!emp) return "Other";
  if (emp.department) return emp.department;
  const t = `${emp.title || ""}`.toLowerCase();
  for (const [dept, keys] of Object.entries(DEPT_KEYWORDS)) {
    if (keys.some(k => t.includes(k))) return dept;
  }
  return "Other";
}

/** Hours worked per employee in [start,end] — end is inclusive of the full day. */
export function computeHours({ shifts = [], schedule = [], start, end }) {
  const startD = start ? new Date(start) : new Date(0);
  const endD = end ? endOfDay(end) : new Date();
  const inRange = (d) => { const x = new Date(d); return x >= startD && x <= endD; };

  const actualByEmp = {};
  const schedByEmp = {};

  shifts.filter(s => inRange(s.clockIn || s.date)).forEach(s => {
    const id = s.employeeId;
    const hrs = computeShiftHours(s);
    actualByEmp[id] = (actualByEmp[id] || 0) + hrs;
  });
  schedule.filter(s => inRange(s.date)).forEach(s => {
    const id = s.employeeId;
    const hrs = scheduleHours(s);
    schedByEmp[id] = (schedByEmp[id] || 0) + hrs;
  });

  return { actualByEmp, schedByEmp };
}

function computeShiftHours(s) {
  if (s.hours != null) return Number(s.hours) || 0;
  if (s.clockIn && s.clockOut) {
    const ms = new Date(s.clockOut) - new Date(s.clockIn);
    return Math.max(0, ms / 3600000);
  }
  return 0;
}
function scheduleHours(s) {
  if (s.hours != null) return Number(s.hours) || 0;
  if (s.startTime && s.endTime) {
    const a = parseClock(s.startTime);
    const b = parseClock(s.endTime);
    if (a != null && b != null) return Math.max(0, (b - a) / 60);
  }
  return 0;
}
function parseClock(t) {
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Compute total labor $ for [start,end] from shifts + payroll runs. */
export function computeLaborCost({ shifts = [], payrollRuns = [], employees = [], start, end }) {
  const startD = start ? new Date(start) : new Date(0);
  const endD = end ? endOfDay(end) : new Date();
  const empMap = Object.fromEntries(employees.map(e => [e.id, e]));

  // Prefer payroll runs as authoritative when present.
  const runs = payrollRuns.filter(r => {
    const d = new Date(r.payDate || r.runDate || r.periodEnd);
    return d >= startD && d <= endD;
  });
  if (runs.length) {
    const total = runs.reduce((s, r) => {
      const gross = Number(r.gross || r.totalGross || 0);
      if (gross) return s + gross;
      // Fallback: sum line items
      return s + (r.lines || r.entries || []).reduce((ss, l) => ss + Number(l.gross || l.amount || 0), 0);
    }, 0);
    return { total, source: "payroll", runs: runs.length };
  }

  // Shift-based estimate
  let total = 0;
  shifts.filter(s => {
    const d = new Date(s.clockIn || s.date);
    return d >= startD && d <= endD;
  }).forEach(s => {
    const e = empMap[s.employeeId];
    if (!e) return;
    const hrs = computeShiftHours(s);
    const rate = Number(e.hourlyRate || 0) || (Number(e.salary || 0) / 2080);
    total += hrs * rate;
  });
  return { total, source: "shifts", runs: 0 };
}

/** Count rooms sold across reports in [start,end] — end inclusive. */
export function roomsSoldInRange(reports = [], start, end) {
  const startD = start ? new Date(start) : new Date(0);
  const endD = end ? endOfDay(end) : new Date();
  return reports.filter(r => {
    const d = new Date(r.date);
    return d >= startD && d <= endD;
  }).reduce((s, r) => s + (Number(r.rooms?.sold) || Number(r.roomsSold) || 0), 0);
}

/** Sum total revenue (rooms + F&B + other) across reports in [start,end] — end inclusive. */
export function totalRevenueInRange(reports = [], start, end) {
  const startD = start ? new Date(start) : new Date(0);
  const endD = end ? endOfDay(end) : new Date();
  return reports.filter(r => {
    const d = new Date(r.date);
    return d >= startD && d <= endD;
  }).reduce((s, r) => {
    const room = Number(r.revenue?.rooms || r.roomRevenue || 0);
    const fb = (r.revenue?.fb?.restaurant || 0) + (r.revenue?.fb?.bar || 0) + (r.revenue?.fb?.banquet || 0);
    const other = (r.revenue?.other?.parking || 0) + (r.revenue?.other?.spa || 0) + (r.revenue?.other?.misc || 0) + (r.revenue?.other?.telephone || 0);
    return s + room + fb + other;
  }, 0);
}

/** Headline KPIs for a date range. */
export function laborKPIs({ shifts, schedule, payrollRuns, employees, reports, start, end }) {
  const { actualByEmp, schedByEmp } = computeHours({ shifts, schedule, start, end });
  const cost = computeLaborCost({ shifts, payrollRuns, employees, start, end });
  const sold = roomsSoldInRange(reports, start, end);
  const revenue = totalRevenueInRange(reports, start, end);
  const actualHours = sumValues(actualByEmp);
  const schedHours = sumValues(schedByEmp);

  return {
    laborCost: round2(cost.total),
    laborCostSource: cost.source,
    actualHours: round2(actualHours),
    scheduledHours: round2(schedHours),
    overage: round2(actualHours - schedHours),
    cpor: sold ? round2(cost.total / sold) : null,
    laborPctRevenue: revenue ? round2(cost.total / revenue) : null,
    avgHourlyRate: actualHours ? round2(cost.total / actualHours) : null,
    roomsSold: sold,
    revenue: round2(revenue),
  };
}

/** Productivity by department. Returns array sorted by laborCost desc. */
export function productivityByDept({ shifts, payrollRuns, employees, reports, start, end }) {
  const startD = start ? new Date(start) : new Date(0);
  const endD = end ? endOfDay(end) : new Date();
  const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
  const sold = roomsSoldInRange(reports, start, end);

  const byDept = {};
  // Try payroll first
  const runs = payrollRuns.filter(r => {
    const d = new Date(r.payDate || r.runDate || r.periodEnd);
    return d >= startD && d <= endD;
  });
  if (runs.length) {
    runs.forEach(r => {
      (r.lines || r.entries || []).forEach(l => {
        const e = empMap[l.employeeId];
        if (!e) return;
        const dept = classifyEmployeeDepartment(e);
        const gross = Number(l.gross || l.amount || 0);
        const hrs = Number(l.hours || 0);
        if (!byDept[dept]) byDept[dept] = { dept, hours: 0, cost: 0, headcount: new Set() };
        byDept[dept].hours += hrs;
        byDept[dept].cost += gross;
        byDept[dept].headcount.add(l.employeeId);
      });
    });
  } else {
    shifts.filter(s => {
      const d = new Date(s.clockIn || s.date);
      return d >= startD && d <= endD;
    }).forEach(s => {
      const e = empMap[s.employeeId];
      if (!e) return;
      const dept = classifyEmployeeDepartment(e);
      const hrs = computeShiftHours(s);
      const rate = Number(e.hourlyRate || 0) || (Number(e.salary || 0) / 2080);
      if (!byDept[dept]) byDept[dept] = { dept, hours: 0, cost: 0, headcount: new Set() };
      byDept[dept].hours += hrs;
      byDept[dept].cost += hrs * rate;
      byDept[dept].headcount.add(s.employeeId);
    });
  }

  return Object.values(byDept)
    .map(d => ({
      dept: d.dept,
      hours: round2(d.hours),
      cost: round2(d.cost),
      headcount: d.headcount.size,
      avgRate: d.hours ? round2(d.cost / d.hours) : 0,
      cpor: sold ? round2(d.cost / sold) : null,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/** Variance row: scheduled vs actual hours by employee. */
export function scheduleVsActual({ shifts, schedule, employees, start, end }) {
  const { actualByEmp, schedByEmp } = computeHours({ shifts, schedule, start, end });
  const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
  const allIds = new Set([...Object.keys(actualByEmp), ...Object.keys(schedByEmp)]);
  return [...allIds]
    .map(id => {
      const e = empMap[id];
      const actual = round2(actualByEmp[id] || 0);
      const sched = round2(schedByEmp[id] || 0);
      return {
        employeeId: id,
        name: e ? `${e.firstName || ""} ${e.lastName || ""}`.trim() : id,
        dept: classifyEmployeeDepartment(e),
        scheduled: sched,
        actual,
        variance: round2(actual - sched),
        variancePct: sched ? round2((actual - sched) / sched) : null,
      };
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

function sumValues(o) { return Object.values(o).reduce((s, v) => s + v, 0); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function endOfDay(d) {
  // Treat d as UTC; add ~24h so the final millisecond of the day is included
  // regardless of the runner's timezone.
  const x = new Date(d);
  return new Date(x.getTime() + 24 * 3600 * 1000 - 1);
}
