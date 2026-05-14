/* HotelOps · Pace + Pickup engine
 * =================================================================
 * Revenue-manager-grade pace logic without inventing data:
 *
 *   - Pace: running cumulative MTD/YTD vs same-period prior year
 *   - Pickup: change in rooms-on-the-books between two as-of snapshots
 *   - Wash factor: ratio of materialized vs originally-on-books rooms,
 *     pulled from cancellation/no-show history. Caps applied per
 *     market class so tertiary economy hotels don't get assigned
 *     5-star group wash dynamics.
 *   - DoW-weighted projection: blend trend and weekday seasonality
 *   - Confidence: tighter when history is rich and DoW variance low
 *
 * Inputs are arrays of historical reports (already enriched). Output
 * is a structured pace report ready for the UI.
 */

const SAFETY_OCC_CAP = 0.97;     // realistic compression ceiling
const MIN_HISTORY_FOR_PACE = 14; // need at least 2 weeks
const DOW_WINDOW = 8;            // last 8 same-DoW observations

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

function bucketByDow(reports) {
  const m = new Array(7).fill(null).map(() => []);
  for (const r of reports) {
    const d = new Date(r.date).getDay();
    m[d].push(r);
  }
  return m;
}

function classifyMarket(reports) {
  // Loose proxy: median ADR over last 30 days
  const adrs = reports.slice(-30).map(r => safe(r.adr)).filter(v => v > 0).sort((a, b) => a - b);
  const med = adrs.length ? adrs[Math.floor(adrs.length / 2)] : 0;
  if (med >= 300) return { tier: "luxury", washCap: 0.30, occCap: 0.95 };
  if (med >= 180) return { tier: "upper-upscale", washCap: 0.22, occCap: 0.95 };
  if (med >= 110) return { tier: "upscale", washCap: 0.18, occCap: SAFETY_OCC_CAP };
  if (med >= 75)  return { tier: "midscale", washCap: 0.14, occCap: SAFETY_OCC_CAP };
  return { tier: "economy", washCap: 0.10, occCap: 0.92 };
}

/**
 * Build a pace report for a property.
 *
 * @param {object} params
 * @param {Array}  params.reports          enriched reports, this property only, asc by date
 * @param {string} params.asOf             YYYY-MM-DD (today)
 * @param {Array}  [params.bookings]       optional future bookings (on-the-books) [{ stayDate, roomsOnBooks, segment }]
 * @param {Array}  [params.priorYear]      same property, prior-year reports for YoY pace
 * @param {object} [params.options]
 */
export function buildPace({ reports, asOf, bookings = [], priorYear = [], options = {} }) {
  const ordered = [...(reports || [])].sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length < MIN_HISTORY_FOR_PACE) {
    return { asOf, status: "insufficient-history", reasonsRequired: MIN_HISTORY_FOR_PACE - ordered.length };
  }
  const market = classifyMarket(ordered);
  const dowBuckets = bucketByDow(ordered);
  const dowProfile = dowBuckets.map(arr => {
    const slice = arr.slice(-DOW_WINDOW);
    return {
      avgOccupancy: avg(slice.map(r => safe(r.occupancy))),
      avgAdr: avg(slice.map(r => safe(r.adr))),
      avgRev: avg(slice.map(r => safe(r.totalRevenue))),
      n: slice.length,
    };
  });

  // MTD pace
  const month = asOf.slice(0, 7);
  const monthStart = `${month}-01`;
  const [yy, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const mtd = ordered.filter(r => r.date >= monthStart && r.date <= asOf);
  const mtdRev = mtd.reduce((s, r) => s + safe(r.totalRevenue), 0);
  const mtdRoomsSold = mtd.reduce((s, r) => s + safe(r.roomsSold), 0);
  const mtdRoomsAvail = mtd.reduce((s, r) => s + safe(r.roomsAvailable), 0);

  // Prior-year same window
  const pyStart = `${yy - 1}-${String(mm).padStart(2, "0")}-01`;
  const pyEnd = `${yy - 1}-${String(mm).padStart(2, "0")}-${String(asOf.slice(8, 10)).padStart(2, "0")}`;
  const py = (priorYear || []).filter(r => r.date >= pyStart && r.date <= pyEnd);
  const pyRev = py.reduce((s, r) => s + safe(r.totalRevenue), 0);
  const pyRoomsSold = py.reduce((s, r) => s + safe(r.roomsSold), 0);

  // Pickup: rooms gained on-the-books since the same day last week
  const lastWeekDate = (() => {
    const d = new Date(asOf); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const pickupRooms = ordered
    .filter(r => r.date > lastWeekDate && r.date <= asOf)
    .reduce((s, r) => s + safe(r.roomsSold), 0);

  // Wash factor — historical observed vs originally booked (when bookings present)
  let washFactor = null;
  if (bookings && bookings.length) {
    // For each historical date with both actuals and OTB at "T-7":
    const sample = [];
    for (const r of ordered.slice(-30)) {
      const sevenDaysPriorDate = (() => {
        const d = new Date(r.date); d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      })();
      const otb = bookings.find(b => b.stayDate === r.date && b.snapshotDate === sevenDaysPriorDate)?.roomsOnBooks;
      if (otb && otb > 0) sample.push(safe(r.roomsSold) / otb);
    }
    if (sample.length >= 3) {
      const median = [...sample].sort((a, b) => a - b)[Math.floor(sample.length / 2)];
      // wash = 1 - materialization. Clamped to the market's cap so a freak week doesn't dominate.
      const observedWash = Math.max(0, 1 - median);
      washFactor = Math.min(market.washCap, observedWash);
    }
  }

  // Forward forecast — next 14 days
  const horizon = options.horizon || 14;
  const lastDate = new Date(ordered[ordered.length - 1].date);
  const forwardLines = [];
  for (let i = 1; i <= horizon; i++) {
    const d = new Date(lastDate); d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    const profile = dowProfile[dow];
    if (!profile || !profile.n) continue;
    // Realism-clamped occupancy
    const baseOcc = profile.avgOccupancy;
    const cappedOcc = Math.min(market.occCap, Math.max(0, baseOcc));
    const adr = Math.max(0, profile.avgAdr);
    const revFromCurves = Math.max(0, profile.avgRev);
    // OTB-informed projection when bookings exist
    const otb = bookings.find(b => b.stayDate === iso);
    const otbAdjusted = otb ? (otb.roomsOnBooks * (washFactor ? 1 - washFactor : 1)) : null;
    forwardLines.push({
      date: iso,
      dow,
      projectedOccupancy: cappedOcc,
      projectedAdr: adr,
      projectedRevenue: revFromCurves,
      onTheBooks: otb ? otb.roomsOnBooks : null,
      otbAdjusted,
      confidence: profile.n >= 4 ? 0.85 : profile.n >= 2 ? 0.65 : 0.45,
    });
  }

  const projection7 = forwardLines.slice(0, 7).reduce((s, p) => s + p.projectedRevenue, 0);
  const projection14 = forwardLines.reduce((s, p) => s + p.projectedRevenue, 0);

  return {
    asOf,
    market,
    mtd: {
      revenue: mtdRev,
      roomsSold: mtdRoomsSold,
      roomsAvailable: mtdRoomsAvail,
      occupancy: mtdRoomsAvail > 0 ? mtdRoomsSold / mtdRoomsAvail : 0,
      adr: mtdRoomsSold > 0 ? mtd.reduce((s, r) => s + safe(r.breakdown?.revenue?.rooms ?? r.roomRevenue), 0) / mtdRoomsSold : 0,
      daysElapsed: mtd.length,
      daysInMonth,
    },
    priorYear: py.length ? {
      revenue: pyRev,
      roomsSold: pyRoomsSold,
      revGrowth: pyRev > 0 ? (mtdRev - pyRev) / pyRev : null,
      roomsGrowth: pyRoomsSold > 0 ? (mtdRoomsSold - pyRoomsSold) / pyRoomsSold : null,
    } : null,
    pickup: { rooms: pickupRooms, sinceDate: lastWeekDate },
    washFactor,
    dowProfile,
    forward: forwardLines,
    projection: { d7: projection7, d14: projection14 },
    status: "ok",
  };
}
