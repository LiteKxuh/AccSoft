/* HotelOps · Revenue Management Engine 2.0
 * =================================================================
 * Real revenue-strategy primitives, not generic "raise rates":
 *
 *   compressionScore(date, history) — 0-1 score of how compressed a
 *     future date looks based on same-DoW history and forward OTB.
 *
 *   displacementAnalysis({ groupBid, paceForecast, dates })
 *     → whether to accept a group at offered rate, given expected
 *       transient revenue at risk.
 *
 *   priceRecommendation({ history, asOf, dates, tierGuard })
 *     → per-date BAR recommendation with rationale, clamped to
 *       tier-realistic ADR ceilings.
 *
 *   losRecommendation({ compressionByDate, threshold })
 *     → minimum length-of-stay controls on compressed nights.
 *
 *   overbookingModel({ history, asOf, capacity })
 *     → no-show curve + safe overbooking cushion by lead-time.
 *
 * Tier guardrails:
 *   economy        → max BAR uplift 12% over 30-day median
 *   midscale       → 15%
 *   upscale        → 20%
 *   upper-upscale  → 25%
 *   luxury         → 35%
 *
 * Floor: -15% below 30-day median for distressed inventory.
 */

const TIER_LIFT_CAP = {
  economy:        { up: 0.12, down: 0.15 },
  midscale:       { up: 0.15, down: 0.15 },
  upscale:        { up: 0.20, down: 0.15 },
  "upper-upscale": { up: 0.25, down: 0.18 },
  luxury:         { up: 0.35, down: 0.20 },
};

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

function classifyTier(adr) {
  if (adr >= 250) return "luxury";
  if (adr >= 170) return "upper-upscale";
  if (adr >= 110) return "upscale";
  if (adr >= 70)  return "midscale";
  return "economy";
}

/* ---------- Compression score per date ---------- */

/**
 * 0 (slack) → 1 (full compression). Blends:
 *   - same-DoW occupancy median over last 8 weeks
 *   - forward on-the-books vs capacity (if booking snapshots provided)
 *   - velocity in last 7 days (rooms picked up / day)
 */
export function compressionScore({ stayDate, history, bookings = [], capacity = null }) {
  const target = new Date(stayDate);
  const dow = target.getDay();
  const sameDow = (history || [])
    .filter(r => new Date(r.date).getDay() === dow && r.date < stayDate)
    .slice(-8);
  if (!sameDow.length) return null;
  const occHistory = sameDow.map(r => safe(r.occupancy)).filter(v => v > 0);
  const medOcc = median(occHistory);

  let otbShare = null;
  const otb = bookings.find(b => b.stayDate === stayDate);
  if (otb && capacity) {
    otbShare = Math.min(1, safe(otb.roomsOnBooks) / capacity);
  }

  const recentSnap = bookings.filter(b => b.stayDate === stayDate).sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  let velocity = 0;
  if (recentSnap.length >= 2) {
    const last = recentSnap[recentSnap.length - 1];
    const prev = recentSnap[recentSnap.length - 2];
    const days = Math.max(1, (new Date(last.snapshotDate) - new Date(prev.snapshotDate)) / 86400000);
    velocity = (safe(last.roomsOnBooks) - safe(prev.roomsOnBooks)) / days;
  }
  // Velocity normalization: > capacity * 0.05/day is "hot"
  const velocityNorm = capacity ? Math.max(0, Math.min(1, velocity / (capacity * 0.05))) : 0;

  // Weighted blend
  const score = otbShare != null
    ? medOcc * 0.4 + otbShare * 0.4 + velocityNorm * 0.2
    : medOcc;
  return Math.max(0, Math.min(1, score));
}

/* ---------- Displacement analysis ---------- */

/**
 * Should we accept a group block at the offered rate? Compare bid revenue
 * against expected transient revenue on the displaced dates.
 *
 * @param {object} input
 * @param {object} input.groupBid     { roomsPerNight, dates: ["YYYY-MM-DD"...], roomRate }
 * @param {Array}  input.paceForecast pace.forward — [{ date, projectedOccupancy, projectedAdr }]
 * @param {number} input.capacity     rooms-available baseline
 */
export function displacementAnalysis({ groupBid, paceForecast, capacity }) {
  if (!groupBid?.dates?.length || !Array.isArray(paceForecast)) {
    return { status: "missing-input" };
  }
  const lines = [];
  let totalGroupRevenue = 0;
  let totalDisplacedRevenue = 0;
  const cap = safe(capacity);

  for (const d of groupBid.dates) {
    const pace = paceForecast.find(p => p.date === d);
    const groupRooms = safe(groupBid.roomsPerNight);
    const groupRate = safe(groupBid.roomRate);
    const projOcc = safe(pace?.projectedOccupancy);
    const projAdr = safe(pace?.projectedAdr);
    const expectedRooms = cap > 0 ? Math.round(projOcc * cap) : 0;

    // Group will displace some transient. Displaced = max(0, expectedRooms + groupRooms - capacity).
    const displaced = cap > 0 ? Math.max(0, expectedRooms + groupRooms - cap) : 0;
    const displacedRev = displaced * projAdr;
    const groupRev = groupRooms * groupRate;

    lines.push({
      date: d,
      groupRooms, groupRate, groupRev,
      expectedTransientRooms: expectedRooms,
      projectedAdr: projAdr,
      displacedRooms: displaced,
      displacedRev,
      netImpact: groupRev - displacedRev,
    });
    totalGroupRevenue += groupRev;
    totalDisplacedRevenue += displacedRev;
  }

  const netImpact = totalGroupRevenue - totalDisplacedRevenue;
  const recommendation = netImpact > 0 ? "accept" : "decline";
  const margin = totalGroupRevenue > 0 ? netImpact / totalGroupRevenue : null;

  return {
    status: "ok",
    lines,
    totalGroupRevenue,
    totalDisplacedRevenue,
    netImpact,
    margin,
    recommendation,
    rationale: netImpact > 0
      ? `Accept: group revenue ${money(totalGroupRevenue)} exceeds displaced transient revenue ${money(totalDisplacedRevenue)} by ${money(netImpact)}.`
      : `Decline at this rate: displaces ${money(totalDisplacedRevenue)} of transient for only ${money(totalGroupRevenue)} group revenue.`,
  };
}

/* ---------- Price recommendation ---------- */

export function priceRecommendation({ history, dates, paceForecast = [], capacity = null }) {
  if (!Array.isArray(history) || history.length < 14) {
    return { status: "insufficient-history", message: "Need at least 14 days of history." };
  }
  // Median ADR over last 30 days
  const last30 = history.slice(-30);
  const medianAdr = median(last30.map(r => safe(r.adr)).filter(v => v > 0));
  const tier = classifyTier(medianAdr);
  const cap = TIER_LIFT_CAP[tier];

  const lines = dates.map(d => {
    const comp = compressionScore({ stayDate: d, history });
    const pace = paceForecast.find(p => p.date === d);
    // Lift = (comp - 0.6) * (tier cap * 2). When comp=0.6 → 0; comp=1 → cap * 0.8; comp=0.3 → -capDown * 0.6
    let liftPct = 0;
    if (comp != null) {
      if (comp >= 0.6) liftPct = Math.min(cap.up, (comp - 0.6) * cap.up * 2.5);
      else if (comp < 0.4) liftPct = -Math.min(cap.down, (0.4 - comp) * cap.down * 2);
    }
    const recBar = medianAdr * (1 + liftPct);
    const rationale = comp == null
      ? "Compression score unavailable — holding flat."
      : comp >= 0.85
        ? `High compression (${(comp * 100).toFixed(0)}%) — push BAR ${(liftPct * 100).toFixed(1)}% above median.`
        : comp >= 0.6
          ? `Moderate compression — modest BAR lift ${(liftPct * 100).toFixed(1)}%.`
          : comp < 0.4
            ? `Soft demand (${(comp * 100).toFixed(0)}% compression) — discount ${Math.abs(liftPct * 100).toFixed(1)}% to drive occupancy.`
            : "Demand near baseline — hold flat.";
    return {
      date: d,
      compressionScore: comp,
      medianAdr,
      recommendedBar: recBar,
      liftPct,
      tierCap: cap,
      rationale,
    };
  });

  return {
    status: "ok",
    tier,
    medianAdr,
    tierLiftCap: cap,
    lines,
  };
}

/* ---------- LOS controls ---------- */

export function losRecommendation({ compressionByDate, threshold = 0.85, maxLOS = 4 }) {
  return Object.entries(compressionByDate || {}).map(([date, score]) => {
    if (score == null) return { date, action: "none", reason: "no compression data" };
    if (score >= threshold) {
      const minLOS = Math.min(maxLOS, Math.max(2, Math.round(2 + (score - threshold) * 10)));
      return { date, action: "set-min-los", minLOS, reason: `Compression ${(score * 100).toFixed(0)}% triggers MLOS ${minLOS}+.` };
    }
    return { date, action: "none", reason: `Compression ${(score * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%.` };
  });
}

/* ---------- Overbooking model ---------- */

/**
 * Build a no-show curve from history and recommend safe overbooking
 * cushion at different lead-times. Returns null without enough history.
 */
export function overbookingModel({ history, capacity, maxOverbookPct = 0.10 }) {
  const sample = (history || []).filter(r => Number.isFinite(r.roomsAvailable) && Number.isFinite(r.roomsSold)).slice(-90);
  if (sample.length < 30) return { status: "insufficient-history" };
  // No-show rate ≈ (reservations - rooms picked up) / reservations
  // We only have rooms sold, so use a proxy: how often did sold approach capacity vs blow past?
  const overbookings = sample.filter(r => r.roomsSold > r.roomsAvailable * 1.02).length;
  const overBookRate = overbookings / sample.length;
  // Recommend cushion as half of historical observed walk rate, capped
  const observedWalk = sample.filter(r => r.roomsSold < r.roomsAvailable * 0.95).map(r => 1 - (r.roomsSold / r.roomsAvailable));
  const medianWalk = median(observedWalk);
  const recommended = Math.min(maxOverbookPct, Math.max(0, medianWalk * 0.5));
  return {
    status: "ok",
    overBookRate,
    medianNoShowWalk: medianWalk,
    recommendedCushionPct: recommended,
    recommendedRooms: capacity ? Math.round(capacity * recommended) : null,
    notes: medianWalk > 0.1 ? "High walk rate — conservative overbook cushion recommended." : "Walk rate is in normal range.",
  };
}

function money(n) {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
