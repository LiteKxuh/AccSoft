/* HotelOps · Budget engine
 * =================================================================
 * Hotel-industry-standard monthly budget with USALI revenue lines.
 *
 * Shape:
 *   {
 *     id, propertyId, month: "YYYY-MM",
 *     rooms: { revenue, occupancy, adr },
 *     fb: { restaurant, bar, banquet },
 *     other: { parking, spa, telephone, misc },
 *     notes,
 *   }
 *
 * Semantics:
 *  - Budgets are stored per property × per month.
 *  - "actual" for a budget is the sum of posted reports in that month for
 *    that property.
 *  - Variance = actual - budget. Positive = ahead of plan.
 *
 * autoSeedBudget() looks at the available history for each property and
 * generates a forward-looking budget = prior-month-actual × (1 + growthPct),
 * so the user sees a populated Budget tab on first load.
 */

export function monthOf(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

export function emptyBudget(propertyId, month) {
  return {
    id: `b_${propertyId}_${month}`,
    propertyId,
    month,
    rooms: { revenue: 0, occupancy: 0, adr: 0 },
    fb: { restaurant: 0, bar: 0, banquet: 0 },
    other: { parking: 0, spa: 0, telephone: 0, misc: 0 },
    taxes: { occupancy: 0, sales: 0, tourism: 0 },
    notes: "",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Roll up actuals for a single property+month from the reports list.
 * @param {Array} reports  enriched reports
 */
export function actualsFor(reports, propertyId, month) {
  const rs = reports.filter(r => r.propertyId === propertyId && monthOf(r.date) === month);
  if (!rs.length) return null;

  const sum = (fn) => rs.reduce((s, r) => s + (fn(r) || 0), 0);
  const avg = (fn) => rs.length ? sum(fn) / rs.length : 0;
  const roomsRev = sum(r => r.breakdown?.revenue?.rooms ?? r.roomRevenue);
  const roomsSold = sum(r => r.breakdown?.rooms?.sold ?? r.roomsSold);
  const roomsAvail = sum(r => r.breakdown?.rooms?.available ?? r.roomsAvailable);

  return {
    days: rs.length,
    rooms: {
      revenue: roomsRev,
      occupancy: roomsAvail ? roomsSold / roomsAvail : 0,
      adr: roomsSold ? roomsRev / roomsSold : 0,
      sold: roomsSold,
      available: roomsAvail,
    },
    fb: {
      restaurant: sum(r => r.breakdown?.revenue?.fb?.restaurant ?? 0),
      bar: sum(r => r.breakdown?.revenue?.fb?.bar ?? 0),
      banquet: sum(r => r.breakdown?.revenue?.fb?.banquet ?? 0),
    },
    other: {
      parking: sum(r => r.breakdown?.revenue?.other?.parking ?? 0),
      spa: sum(r => r.breakdown?.revenue?.other?.spa ?? 0),
      telephone: sum(r => r.breakdown?.revenue?.other?.telephone ?? 0),
      misc: sum(r => r.breakdown?.revenue?.other?.misc ?? r.otherRevenue ?? 0),
    },
    taxes: {
      occupancy: sum(r => r.breakdown?.taxes?.occupancy ?? 0),
      sales: sum(r => r.breakdown?.taxes?.sales ?? 0),
      tourism: sum(r => r.breakdown?.taxes?.tourism ?? 0),
    },
    totalRevenue: sum(r => r.totalRevenue),
  };
}

/**
 * Total budget for a row (sum of revenue lines).
 */
export function budgetTotal(b) {
  if (!b) return 0;
  return (
    (b.rooms?.revenue || 0)
    + (b.fb?.restaurant || 0) + (b.fb?.bar || 0) + (b.fb?.banquet || 0)
    + (b.other?.parking || 0) + (b.other?.spa || 0) + (b.other?.telephone || 0) + (b.other?.misc || 0)
  );
}

/**
 * Compute pace: how the month-to-date actuals compare to the prorated budget.
 * `daysInMonth` defaults to days-elapsed-vs-month.
 */
export function pacing(actual, budget, asOfDate) {
  if (!budget) return null;
  const total = budgetTotal(budget);
  if (!total) return null;
  const month = budget.month;
  const [yy, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const dt = asOfDate ? new Date(asOfDate) : new Date();
  const dayInMonth = (dt.getFullYear() === yy && dt.getMonth() === mm - 1) ? dt.getDate() : daysInMonth;
  const expectedToDate = total * (dayInMonth / daysInMonth);
  const actualToDate = actual?.totalRevenue || 0;
  return {
    daysInMonth,
    dayInMonth,
    expectedToDate,
    actualToDate,
    variance: actualToDate - expectedToDate,
    variancePct: expectedToDate ? (actualToDate - expectedToDate) / expectedToDate : 0,
  };
}

/**
 * Auto-seed budgets for the next 3 months for a property based on the prior
 * 30-day actuals × (1 + growthPct), distributed by month.
 */
export function autoSeedBudgets(properties, reports, growthPct = 0.06, monthsForward = 3) {
  const out = [];
  const now = new Date();
  properties.forEach((p) => {
    // Use the most-recent 30 days as baseline daily run-rate
    const recent = reports
      .filter(r => r.propertyId === p.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);
    if (!recent.length) return;
    const dailyRoomRev = recent.reduce((s, r) => s + (r.roomRevenue || 0), 0) / recent.length;
    const dailyFbRest = recent.reduce((s, r) => s + (r.breakdown?.revenue?.fb?.restaurant || 0), 0) / recent.length;
    const dailyFbBar = recent.reduce((s, r) => s + (r.breakdown?.revenue?.fb?.bar || 0), 0) / recent.length;
    const dailyFbBanquet = recent.reduce((s, r) => s + (r.breakdown?.revenue?.fb?.banquet || 0), 0) / recent.length;
    const dailyParking = recent.reduce((s, r) => s + (r.breakdown?.revenue?.other?.parking || 0), 0) / recent.length;
    const dailySpa = recent.reduce((s, r) => s + (r.breakdown?.revenue?.other?.spa || 0), 0) / recent.length;
    const dailyMisc = recent.reduce((s, r) => s + (r.breakdown?.revenue?.other?.misc || r.otherRevenue || 0), 0) / recent.length;
    const avgOcc = recent.reduce((s, r) => s + (r.occupancy || 0), 0) / recent.length;
    const avgAdr = recent.reduce((s, r) => s + (r.adr || 0), 0) / recent.length;

    for (let i = 0; i < monthsForward; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const month = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const days = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
      const factor = 1 + growthPct;
      out.push({
        id: `b_${p.id}_${month}`,
        propertyId: p.id,
        month,
        rooms: {
          revenue: Math.round(dailyRoomRev * days * factor),
          occupancy: Math.min(0.95, avgOcc * (1 + growthPct * 0.5)),
          adr: Math.round(avgAdr * factor * 100) / 100,
        },
        fb: {
          restaurant: Math.round(dailyFbRest * days * factor),
          bar: Math.round(dailyFbBar * days * factor),
          banquet: Math.round(dailyFbBanquet * days * factor),
        },
        other: {
          parking: Math.round(dailyParking * days * factor),
          spa: Math.round(dailySpa * days * factor),
          telephone: 0,
          misc: Math.round(dailyMisc * days * factor),
        },
        taxes: { occupancy: 0, sales: 0, tourism: 0 },
        notes: "Auto-seeded from prior 30-day actuals + 6% growth",
        createdAt: new Date().toISOString(),
        autoSeeded: true,
      });
    }
  });
  return out;
}
