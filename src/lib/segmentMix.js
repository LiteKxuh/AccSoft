/* HotelOps · Segment mix analysis
 * =================================================================
 * Tracks revenue / room-night mix across market segments over time:
 *   transient, group, contract, OTA, direct, corporate, leisure
 *
 * Without segment-tagged reservations the report falls back to revenue
 * channel buckets pulled from the report's breakdown.segments field.
 *
 *   buildSegmentMix({ reports, propertyId, start, end })
 *     → { mix: [{segment, revenue, roomNights, share, adr}], trend: ts }
 *
 *   detectShifts(currentMix, priorMix, threshold = 0.05)
 *     → [{segment, share, priorShare, deltaPts}]
 */

const KNOWN_SEGMENTS = ["transient", "group", "contract", "corporate", "ota", "direct", "leisure", "wholesale", "other"];

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }

function pickSegments(report) {
  // Accept either explicit segments map or a single-segment hint
  const map = report.breakdown?.segments;
  if (map && typeof map === "object") return map;
  return null;
}

export function buildSegmentMix({ reports, propertyId, start = null, end = null }) {
  const own = (reports || []).filter(r => r.propertyId === propertyId);
  const inWin = (d) => (!start || d >= start) && (!end || d <= end);
  const filtered = own.filter(r => inWin(r.date));

  const byDate = new Map();
  const bySegment = new Map();

  for (const r of filtered) {
    const segMap = pickSegments(r);
    if (!segMap) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, {});
    const slot = byDate.get(r.date);
    for (const [seg, vals] of Object.entries(segMap)) {
      const rev = safe(vals.revenue);
      const rn = safe(vals.roomNights);
      slot[seg] = (slot[seg] || 0) + rev;
      const agg = bySegment.get(seg) || { segment: seg, revenue: 0, roomNights: 0, days: 0 };
      agg.revenue += rev;
      agg.roomNights += rn;
      agg.days += 1;
      bySegment.set(seg, agg);
    }
  }

  const totalRev = Array.from(bySegment.values()).reduce((s, x) => s + x.revenue, 0);
  const mix = Array.from(bySegment.values()).map(x => ({
    segment: x.segment,
    revenue: x.revenue,
    roomNights: x.roomNights,
    share: totalRev > 0 ? x.revenue / totalRev : 0,
    adr: x.roomNights > 0 ? x.revenue / x.roomNights : 0,
    days: x.days,
  })).sort((a, b) => b.revenue - a.revenue);

  // Daily trend (long format for charting)
  const trend = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, map]) => ({
    date,
    ...map,
  }));

  return {
    propertyId, start, end,
    mix,
    trend,
    totals: { revenue: totalRev, segments: mix.length },
    coverage: filtered.length > 0 ? byDate.size / filtered.length : 0,
  };
}

export function detectShifts(currentMix, priorMix, threshold = 0.05) {
  const priorMap = new Map(priorMix.map(s => [s.segment, s]));
  const shifts = [];
  for (const s of currentMix) {
    const p = priorMap.get(s.segment);
    const priorShare = p?.share || 0;
    const delta = s.share - priorShare;
    if (Math.abs(delta) >= threshold) {
      shifts.push({
        segment: s.segment,
        share: s.share,
        priorShare,
        deltaPts: delta,
        direction: delta > 0 ? "up" : "down",
      });
    }
  }
  // Segments that dropped out entirely
  for (const p of priorMix) {
    if (!currentMix.find(c => c.segment === p.segment) && p.share >= threshold) {
      shifts.push({ segment: p.segment, share: 0, priorShare: p.share, deltaPts: -p.share, direction: "down" });
    }
  }
  return shifts.sort((a, b) => Math.abs(b.deltaPts) - Math.abs(a.deltaPts));
}

/** Validate a segment name is recognized (for data-entry sanity). */
export function isKnownSegment(name) {
  return KNOWN_SEGMENTS.includes(String(name).toLowerCase());
}
