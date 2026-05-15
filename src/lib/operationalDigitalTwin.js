/* HotelOps · Operational Digital Twin
 * =================================================================
 * Higher-fidelity operational model that sits on top of the kernel
 * graph. The kernel produces composite indices; the twin produces
 * the underlying operational mechanics — what each department is
 * doing, where capacity bottlenecks will hit, and which failures
 * cascade into which.
 *
 *   - Room inventory state (available/sold/OOS/dirty/clean/inspected)
 *   - Arrivals / departures / stayovers per day
 *   - Housekeeping load (rooms-to-clean, attendant capacity)
 *   - Labor coverage per department
 *   - Maintenance backlog
 *   - OTA exposure
 *   - Bottleneck prediction
 *   - Cascading failure analysis ("if X fails, what breaks?")
 *
 * Pure functions. Reads from state slices that already exist
 * (reports, shifts, schedule, maintenance) plus optional new slices
 * (rooms, housekeepingAssignments, maintenanceTickets) that the
 * caller may not populate — twin degrades gracefully.
 *
 * Dependency graph (used for cascade analysis):
 *
 *   housekeeping → room-readiness → check-in
 *   front-desk   → check-in       → guest-arrival
 *   maintenance  → room-readiness → check-in
 *   night-audit  → posting-cycle  → financial-controls
 *   labor-coverage → all-departments
 *   revenue      → forecast → staffing-plan
 *   compression  → housekeeping → front-desk → guest-arrival
 *
 * Edges marked "blocks" mean upstream failure stops the downstream
 * service. Edges marked "degrades" mean it merely slows.
 */

import { buildOperationalGraph } from "./hotelOperatingKernel.js";

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function round1(n) { return Math.round((n + Number.EPSILON) * 10) / 10; }
function pct(n) { return Math.round(n * 100); }

/* ---------- Dependency graph ---------- */

const DEPENDENCIES = [
  { from: "housekeeping",  to: "room-readiness", relation: "blocks",   reason: "rooms must be cleaned before being made available" },
  { from: "maintenance",   to: "room-readiness", relation: "blocks",   reason: "out-of-order rooms cannot be sold" },
  { from: "room-readiness", to: "check-in",      relation: "blocks",   reason: "no clean rooms = no check-in" },
  { from: "front-desk",    to: "check-in",       relation: "blocks",   reason: "no staffed desk = no check-in" },
  { from: "check-in",      to: "guest-arrival",  relation: "blocks",   reason: "check-in is the front-line guest touchpoint" },
  { from: "labor-coverage", to: "housekeeping",  relation: "degrades", reason: "thin HK coverage slows room readiness" },
  { from: "labor-coverage", to: "front-desk",    relation: "degrades", reason: "thin FD coverage slows check-in" },
  { from: "labor-coverage", to: "food-beverage", relation: "degrades", reason: "FB service depends on labor" },
  { from: "night-audit",   to: "posting-cycle",  relation: "blocks",   reason: "audit must pass to close the day" },
  { from: "posting-cycle", to: "financial-controls", relation: "blocks", reason: "without postings GL drifts" },
  { from: "revenue",       to: "forecast",       relation: "degrades", reason: "actuals feed the forecast loop" },
  { from: "forecast",      to: "staffing-plan",  relation: "blocks",   reason: "staffing depends on forecast occupancy" },
];

export { DEPENDENCIES };

/* ---------- Room inventory ---------- */

/**
 * Derive a room-inventory snapshot from state.rooms (if present) or fall
 * back to roomsSold / roomsAvailable from the day's report.
 */
export function roomInventory(state, { propertyId, asOf }) {
  // Preferred: explicit room state machine
  const rooms = (state.rooms || []).filter(r => r.propertyId === propertyId);
  if (rooms.length) {
    const counts = { total: rooms.length, occupied: 0, vacantClean: 0, vacantDirty: 0, outOfOrder: 0, outOfService: 0, inspected: 0 };
    for (const r of rooms) {
      switch ((r.status || "vacant-clean").toLowerCase()) {
        case "occupied":         counts.occupied++; break;
        case "vacant-clean":     counts.vacantClean++; break;
        case "vacant-dirty":     counts.vacantDirty++; break;
        case "out-of-order":     counts.outOfOrder++; break;
        case "out-of-service":   counts.outOfService++; break;
        case "inspected":        counts.inspected++; break;
      }
    }
    counts.sellable = counts.total - counts.outOfOrder - counts.outOfService;
    counts.readyToSell = counts.vacantClean + counts.inspected;
    return { status: "live", source: "rooms", ...counts };
  }
  // Fallback to report
  const report = (state.reports || []).find(r => r.propertyId === propertyId && r.date === asOf);
  if (!report) return { status: "no-data" };
  return {
    status: "derived",
    source: "report",
    total: safe(report.roomsAvailable),
    occupied: safe(report.roomsSold),
    sellable: safe(report.roomsAvailable),
    readyToSell: Math.max(0, safe(report.roomsAvailable) - safe(report.roomsSold)),
    outOfOrder: safe(report.roomsOOO) || 0,
  };
}

/* ---------- Arrivals / departures ---------- */

export function arrivalDepartureLoad(state, { propertyId, asOf }) {
  const reservations = (state.reservations || []).filter(r => r.propertyId === propertyId);
  const arriving = reservations.filter(r => r.arrival === asOf && r.status !== "cancelled").length;
  const departing = reservations.filter(r => r.departure === asOf && r.status !== "cancelled").length;
  const stayover = reservations.filter(r => r.arrival < asOf && r.departure > asOf && r.status !== "cancelled").length;
  return { status: "ok", arriving, departing, stayover };
}

/* ---------- Housekeeping load ---------- */

/**
 * Compute rooms-to-clean today and required attendant capacity.
 * Assumes a standard attendant productivity of 14 rooms/shift (tier-adjusted).
 */
export function housekeepingLoad(state, { propertyId, asOf, productivityPerShift = null }) {
  const inv = roomInventory(state, { propertyId, asOf });
  const ad = arrivalDepartureLoad(state, { propertyId, asOf });
  // Rooms-to-clean = departures + dirty stayovers
  const dirty = (inv.vacantDirty || 0) + safe(ad.departing);
  // Tier-aware productivity defaults
  const tierProd = productivityPerShift || 14;
  const shiftsNeeded = Math.ceil(dirty / tierProd);
  // Compare to actual scheduled HK shifts today
  const schedule = (state.schedule || []).filter(s =>
    (!s.propertyId || s.propertyId === propertyId) && s.date === asOf
  );
  const hkScheduled = schedule.filter(s => /housekeep|hk/i.test(s.role || s.position || s.department || "")).length;
  return {
    status: "ok",
    roomsToClean: dirty,
    productivityPerShift: tierProd,
    shiftsNeeded,
    shiftsScheduled: hkScheduled,
    gap: shiftsNeeded - hkScheduled,
    status_: shiftsNeeded - hkScheduled > 1 ? "understaffed" : shiftsNeeded - hkScheduled < -1 ? "overstaffed" : "balanced",
  };
}

/* ---------- Labor coverage ---------- */

export function laborCoverage(state, { propertyId, asOf }) {
  const schedule = (state.schedule || []).filter(s =>
    (!s.propertyId || s.propertyId === propertyId) && s.date === asOf
  );
  const byDept = new Map();
  for (const s of schedule) {
    const dept = (s.department || s.role || "unknown").toLowerCase();
    byDept.set(dept, (byDept.get(dept) || 0) + 1);
  }
  return {
    status: "ok",
    shiftsScheduled: schedule.length,
    byDepartment: Object.fromEntries(byDept),
  };
}

/* ---------- Maintenance backlog ---------- */

export function maintenanceBacklog(state, { propertyId, asOf }) {
  const tickets = (state.maintenanceTickets || []).filter(t =>
    (!t.propertyId || t.propertyId === propertyId) && t.status !== "closed"
  );
  const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of tickets) {
    const p = (t.priority || "medium").toLowerCase();
    if (byPriority[p] !== undefined) byPriority[p]++;
  }
  // Aged tickets — older than 7 days
  const aged = tickets.filter(t => {
    if (!t.createdAt) return false;
    const days = (new Date(asOf).getTime() - new Date(t.createdAt).getTime()) / 86_400_000;
    return days > 7;
  }).length;
  return {
    status: tickets.length ? "ok" : "no-tickets",
    openTickets: tickets.length,
    byPriority,
    agedTickets: aged,
    healthBand: byPriority.critical > 0 ? "critical" : byPriority.high > 3 || aged > 5 ? "elevated" : "ok",
  };
}

/* ---------- Bottleneck prediction ---------- */

/**
 * Look 7 days forward and identify operational pinch points: dates when
 * (HK demand > HK capacity) OR (occupancy > sellable rooms) OR
 * (labor demand > labor schedule).
 */
export function predictBottlenecks(state, { propertyId, asOf, horizonDays = 7 }) {
  const today = new Date(asOf);
  const bottlenecks = [];
  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const ad = arrivalDepartureLoad(state, { propertyId, asOf: iso });
    const hk = housekeepingLoad(state, { propertyId, asOf: iso });
    const inv = roomInventory(state, { propertyId, asOf: iso });
    const flags = [];
    if (hk.gap > 1) flags.push({ code: "hk.gap", severity: hk.gap > 3 ? "high" : "medium", detail: `HK ${hk.gap} shift(s) short for ${hk.roomsToClean} rooms` });
    if (inv.sellable != null && ad.arriving > inv.sellable) flags.push({ code: "arrival.overflow", severity: "high", detail: `${ad.arriving} arrivals vs ${inv.sellable} sellable rooms` });
    if (ad.arriving + ad.departing > 60) flags.push({ code: "fd.surge", severity: ad.arriving + ad.departing > 100 ? "high" : "medium", detail: `${ad.arriving + ad.departing} check-in/out transactions` });
    if (flags.length) {
      bottlenecks.push({ date: iso, arriving: ad.arriving, departing: ad.departing, flags });
    }
  }
  return {
    status: "ok",
    horizonDays,
    bottlenecks,
    summary: bottlenecks.length
      ? `${bottlenecks.length} day(s) of forward operational pressure detected.`
      : "No bottlenecks in horizon.",
  };
}

/* ---------- Cascade analysis ---------- */

/**
 * Given a failing component, BFS the dependency graph to surface
 * everything that breaks downstream.
 */
export function cascadeFrom(component) {
  const visited = new Set([component]);
  const stack = [{ node: component, distance: 0, path: [component] }];
  const impact = [];
  while (stack.length) {
    const { node, distance, path } = stack.shift();
    for (const edge of DEPENDENCIES) {
      if (edge.from !== node) continue;
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      impact.push({
        downstream: edge.to,
        distance: distance + 1,
        relation: edge.relation,
        reason: edge.reason,
        path: [...path, edge.to],
      });
      stack.push({ node: edge.to, distance: distance + 1, path: [...path, edge.to] });
    }
  }
  return impact;
}

/* ---------- Full twin ---------- */

/** Build the complete operational digital twin for one property. */
export function buildOperationalTwin(state, { propertyId, asOf, enrichReport = null, productivityPerShift = null }) {
  const graph = buildOperationalGraph(state, { propertyId, asOf, enrichReport });
  if (graph.status !== "ok") return { status: graph.status, propertyId, asOf };
  const inventory = roomInventory(state, { propertyId, asOf });
  const ad = arrivalDepartureLoad(state, { propertyId, asOf });
  const hk = housekeepingLoad(state, { propertyId, asOf, productivityPerShift });
  const lc = laborCoverage(state, { propertyId, asOf });
  const mb = maintenanceBacklog(state, { propertyId, asOf });
  const bottlenecks = predictBottlenecks(state, { propertyId, asOf });
  // Surface cascading-failure exposure for whatever component is most stressed
  const cascades = [];
  if (hk.status_ === "understaffed") cascades.push({ source: "housekeeping", impact: cascadeFrom("housekeeping") });
  if (mb.healthBand === "critical" || mb.byPriority.critical > 0) cascades.push({ source: "maintenance", impact: cascadeFrom("maintenance") });
  if (graph.snap.audit?.status === "fail") cascades.push({ source: "night-audit", impact: cascadeFrom("night-audit") });
  if (lc.shiftsScheduled === 0 && hk.roomsToClean > 0) cascades.push({ source: "labor-coverage", impact: cascadeFrom("labor-coverage") });

  return {
    status: "ok",
    propertyId,
    asOf,
    indices: graph.indices,
    tier: graph.tier,
    inventory,
    arrivalsDepartures: ad,
    housekeeping: hk,
    labor: lc,
    maintenance: mb,
    bottlenecks,
    cascadeRisks: cascades,
    pressurePoints: graph.pressurePoints,
    runAt: new Date().toISOString(),
  };
}
