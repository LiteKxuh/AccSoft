/* HotelOps · Pickup report
 * =================================================================
 * Pickup is the change in rooms-on-the-books between two snapshots
 * for the same stay date. Used by revenue managers to see how a
 * given future date is filling up over time.
 *
 *   pickupReport(snapshots, asOf, compareDate)
 *     → per-stay-date pickup row with rooms gained/lost, $ pickup
 *
 *   pickupCurve(snapshots, stayDate, asOf, horizon)
 *     → time series of rooms-on-books for a single stay date,
 *       suitable for charting
 *
 * Snapshot shape:
 *   { snapshotDate, stayDate, propertyId, roomsOnBooks, revenueOnBooks?, segment? }
 *
 * If your platform doesn't track snapshots, the report degrades to
 * "snapshot data not available" rather than fabricating pickup —
 * a fake pickup curve is worse than no pickup curve.
 */

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }

function inWindow(date, start, end) {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

/**
 * @param {object} input
 * @param {Array}  input.snapshots    [{ snapshotDate, stayDate, propertyId, roomsOnBooks, revenueOnBooks? }]
 * @param {string} input.asOf         today's snapshot date (the "now" row)
 * @param {string} input.compareDate  prior snapshot date to compare against
 * @param {string} input.propertyId
 * @param {object} [input.range]      stayDate range filter { start, end }
 */
export function pickupReport({ snapshots, asOf, compareDate, propertyId, range = null }) {
  if (!asOf || !compareDate || !propertyId) {
    return { status: "missing-input", rows: [], totals: zeros() };
  }
  const own = (snapshots || []).filter(s => s.propertyId === propertyId);
  if (!own.length) return { status: "no-snapshots", rows: [], totals: zeros() };

  const byStay = new Map();
  for (const s of own) {
    if (range && !inWindow(s.stayDate, range.start, range.end)) continue;
    if (s.snapshotDate !== asOf && s.snapshotDate !== compareDate) continue;
    if (!byStay.has(s.stayDate)) byStay.set(s.stayDate, {});
    const slot = byStay.get(s.stayDate);
    slot[s.snapshotDate] = s;
  }

  const rows = [];
  for (const [stayDate, slot] of byStay) {
    const a = slot[asOf];
    const b = slot[compareDate];
    if (!a && !b) continue;
    const roomsA = safe(a?.roomsOnBooks);
    const roomsB = safe(b?.roomsOnBooks);
    const revA = safe(a?.revenueOnBooks);
    const revB = safe(b?.revenueOnBooks);
    rows.push({
      stayDate,
      roomsAsOf: roomsA,
      roomsCompare: roomsB,
      roomsPickup: roomsA - roomsB,
      revenueAsOf: revA,
      revenueCompare: revB,
      revenuePickup: revA - revB,
      adrImplied: (roomsA - roomsB) > 0 ? (revA - revB) / (roomsA - roomsB) : null,
    });
  }
  rows.sort((a, b) => a.stayDate.localeCompare(b.stayDate));

  const totals = rows.reduce((acc, r) => {
    acc.roomsPickup += r.roomsPickup;
    acc.revenuePickup += r.revenuePickup;
    acc.roomsAsOf += r.roomsAsOf;
    acc.roomsCompare += r.roomsCompare;
    return acc;
  }, zeros());

  return { status: "ok", asOf, compareDate, propertyId, rows, totals };
}

function zeros() {
  return { roomsPickup: 0, revenuePickup: 0, roomsAsOf: 0, roomsCompare: 0 };
}

/**
 * Returns a chartable series of (snapshotDate → roomsOnBooks) for a
 * single stay date, useful for "how did this date fill up?" curves.
 */
export function pickupCurve({ snapshots, stayDate, propertyId, horizon = 60 }) {
  if (!stayDate || !propertyId) return { status: "missing-input", points: [] };
  const series = (snapshots || [])
    .filter(s => s.propertyId === propertyId && s.stayDate === stayDate)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  if (!series.length) return { status: "no-snapshots", points: [] };
  const cap = Math.max(0, Math.min(horizon, series.length));
  return {
    status: "ok",
    stayDate,
    points: series.slice(-cap).map(s => ({
      snapshotDate: s.snapshotDate,
      roomsOnBooks: safe(s.roomsOnBooks),
      revenueOnBooks: safe(s.revenueOnBooks),
      segment: s.segment || null,
    })),
  };
}
