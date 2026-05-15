/* HotelOps · Revenue AI Engine
 * =================================================================
 * Sits atop revenueEngine.js (BAR + displacement + LOS + overbooking)
 * and adds the analytical surface that an actual RMCC analyst team
 * provides:
 *
 *   - unconstrained demand estimation
 *   - dynamic price-elasticity modeling
 *   - segment profitability analysis (transient/group/OTA/contract)
 *   - OTA dependency scoring
 *   - cancellation probability per stay date
 *   - demand volatility scoring
 *   - shoulder-night optimization
 *   - revenue-opportunity scoring + ranked recommendation list
 *   - expected RevPAR / GOP impact per recommendation
 *
 * Deterministic-first: every recommendation has a citation back to the
 * inputs it derived from. The AI agents wrap narrative around this;
 * the engine does not call LLMs.
 *
 * API:
 *   estimateUnconstrainedDemand(reports, asOf)
 *   estimateElasticity(history)
 *   scoreSegmentProfitability({ reports, period, channelCosts })
 *   scoreOtaDependency({ reports, period })
 *   predictCancellations({ reservations, asOf })
 *   demandVolatility(reports)
 *   shoulderNightOptimization({ reports, asOf, horizonDays })
 *   rankRevenueOpportunities({ reports, history, asOf, paceForecast, capacity })
 *   runRevenueAI({ state, propertyId, asOf })
 */

import { compressionScore, priceRecommendation } from "./revenueEngine.js";

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function mean(arr) { if (!arr.length) return 0; return arr.reduce((s, v) => s + v, 0) / arr.length; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/* ---------- Unconstrained demand estimation ---------- */

/**
 * "Unconstrained" demand = demand if capacity were unlimited. Used to
 * detect compression that the property is currently capping at occupancy=1.
 *
 * Strategy:
 *   - For each historical date that ran 95%+ occupancy, treat it as
 *     capacity-constrained and look at the *next 14 days of bookings*
 *     to back into displaced demand (rolled-over guests).
 *   - For dates that ran below 95%, observed demand ≈ unconstrained.
 *   - Returns mean & p95 unconstrained occupancy by day-of-week.
 */
export function estimateUnconstrainedDemand(reports = [], asOf = null) {
  const cutoff = asOf || new Date().toISOString().slice(0, 10);
  const past = reports.filter(r => r.date <= cutoff && safe(r.roomsAvailable) > 0);
  if (past.length < 30) return { status: "insufficient-history" };

  const byDow = new Map();
  for (let i = 0; i < past.length; i++) {
    const r = past[i];
    const d = new Date(r.date);
    if (Number.isNaN(d.getTime())) continue;
    const dow = d.getDay();
    const observed = safe(r.roomsSold) / safe(r.roomsAvailable);
    // Capacity-constrained heuristic: if occupancy ≥ 0.95 AND the same DoW
    // average is much lower, this day was capped.
    const capped = observed >= 0.95;
    // Walk forward 14 days; if 3+ of those days also ran >=95%, the demand
    // most likely overflowed (we add a 5% bump per capped neighbor).
    let neighborCap = 0;
    if (capped) {
      for (let j = 1; j <= 14 && i + j < past.length; j++) {
        const next = past[i + j];
        const o = safe(next.roomsSold) / safe(next.roomsAvailable);
        if (o >= 0.95) neighborCap++;
      }
    }
    // Unconstrained estimate: observed + 0.03 per capped neighbor (max +0.20)
    const unconstrained = clamp(observed + (capped ? Math.min(0.20, neighborCap * 0.03) : 0), 0, 1.30);
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow).push({ date: r.date, observed, unconstrained, capped });
  }

  const rows = [];
  for (const [dow, items] of byDow) {
    const sorted = items.map(i => i.unconstrained).sort((a, b) => a - b);
    rows.push({
      dow,
      sampleSize: items.length,
      observedMean: round2(mean(items.map(i => i.observed))),
      unconstrainedMean: round2(mean(sorted)),
      unconstrainedP95: round2(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
      cappedShare: round2(items.filter(i => i.capped).length / items.length),
    });
  }
  rows.sort((a, b) => a.dow - b.dow);
  return { status: "ok", byDayOfWeek: rows };
}

/* ---------- Elasticity ---------- */

/**
 * Naive log-log elasticity: ln(rooms_sold) regressed on ln(adr) across
 * the trailing window. Negative slope = price-sensitive demand.
 * Returns slope + confidence (R² proxy).
 */
export function estimateElasticity(history = []) {
  const sample = (history || []).filter(r => safe(r.adr) > 0 && safe(r.roomsSold) > 0).slice(-90);
  if (sample.length < 30) return { status: "insufficient-history" };
  const x = sample.map(r => Math.log(safe(r.adr)));
  const y = sample.map(r => Math.log(safe(r.roomsSold)));
  const mX = mean(x), mY = mean(y);
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mX, dy = y[i] - mY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX < 1e-9) return { status: "no-price-variance" };
  const slope = num / denX;
  const r2 = denY === 0 ? 0 : (num * num) / (denX * denY);
  const confidence = clamp(r2, 0, 1);
  return {
    status: "ok",
    elasticity: round2(slope),
    confidence: round2(confidence),
    sampleSize: sample.length,
    interpretation: slope < -1 ? "very price-sensitive"
      : slope < -0.5 ? "price-sensitive"
      : slope < 0 ? "mildly price-sensitive"
      : "inelastic — pricing power available",
  };
}

/* ---------- Segment profitability ---------- */

const DEFAULT_CHANNEL_COSTS = {
  ota:        0.18,  // ~15-22%
  wholesale:  0.20,
  group:      0.05,  // sales commission + concessions
  contract:   0.02,
  corporate:  0.03,
  direct:     0.01,  // website + brand
  transient:  0.05,
  leisure:    0.10,
};

export function scoreSegmentProfitability({ reports = [], period = null, channelCosts = DEFAULT_CHANNEL_COSTS, propertyId = null } = {}) {
  const inWin = (d) => (!period?.start || d >= period.start) && (!period?.end || d <= period.end);
  const rows = (reports || []).filter(r => (!propertyId || r.propertyId === propertyId) && inWin(r.date));
  const bySeg = new Map();
  for (const r of rows) {
    const segMap = r.breakdown?.segments;
    if (!segMap) continue;
    for (const [seg, vals] of Object.entries(segMap)) {
      const rev = safe(vals?.revenue);
      const rn = safe(vals?.roomNights);
      if (!bySeg.has(seg)) bySeg.set(seg, { segment: seg, revenue: 0, roomNights: 0 });
      const row = bySeg.get(seg);
      row.revenue += rev;
      row.roomNights += rn;
    }
  }
  if (bySeg.size === 0) return { status: "no-segment-data" };
  const ranked = Array.from(bySeg.values()).map(r => {
    const cost = (channelCosts[r.segment] ?? 0.10) * r.revenue;
    const adr = r.roomNights > 0 ? r.revenue / r.roomNights : 0;
    const netAdr = r.roomNights > 0 ? (r.revenue - cost) / r.roomNights : 0;
    return {
      ...r,
      adr: round2(adr),
      acquisitionCost: round2(cost),
      acquisitionPct: channelCosts[r.segment] ?? 0.10,
      netAdr: round2(netAdr),
      contributionMargin: r.revenue > 0 ? round2(1 - (channelCosts[r.segment] ?? 0.10)) : 0,
    };
  }).sort((a, b) => b.netAdr - a.netAdr);
  return {
    status: "ok",
    period,
    segments: ranked,
    totalRevenue: round2(ranked.reduce((s, r) => s + r.revenue, 0)),
    totalAcquisitionCost: round2(ranked.reduce((s, r) => s + r.acquisitionCost, 0)),
  };
}

/* ---------- OTA dependency ---------- */

export function scoreOtaDependency({ reports = [], period = null, propertyId = null } = {}) {
  const inWin = (d) => (!period?.start || d >= period.start) && (!period?.end || d <= period.end);
  const rows = (reports || []).filter(r => (!propertyId || r.propertyId === propertyId) && inWin(r.date));
  let total = 0, ota = 0;
  for (const r of rows) {
    const segMap = r.breakdown?.segments;
    if (!segMap) continue;
    for (const [seg, vals] of Object.entries(segMap)) {
      const rev = safe(vals?.revenue);
      total += rev;
      if (/(ota|expedia|booking|priceline|agoda|airbnb)/i.test(seg)) ota += rev;
    }
  }
  if (total === 0) return { status: "no-segment-data" };
  const share = ota / total;
  const band = share < 0.20 ? "low" : share < 0.40 ? "moderate" : share < 0.60 ? "high" : "critical";
  return {
    status: "ok",
    otaRevenue: round2(ota),
    totalRevenue: round2(total),
    otaShare: round2(share),
    band,
    recommendation: band === "critical"
      ? "Reduce OTA exposure via direct-book incentives and loyalty program."
      : band === "high"
      ? "Investigate direct-channel marketing to reduce commission spend."
      : "OTA mix is reasonable.",
  };
}

/* ---------- Cancellation prediction ---------- */

/**
 * Predict per-reservation cancellation probability using simple rules:
 *   - lead time > 60 days: +0.15
 *   - third-party prepaid: -0.10 (already committed)
 *   - guest with prior cancellation: +0.20
 *   - rate type "flexible/refundable": +0.05
 * The output is a per-reservation score + an aggregate expected-cancel rate.
 */
export function predictCancellations({ reservations = [], asOf = null } = {}) {
  const today = new Date(asOf || new Date());
  if (!reservations.length) return { status: "no-reservations" };
  const out = [];
  let totalRooms = 0, expectedCancel = 0;
  for (const r of reservations) {
    if (r.status === "cancelled") continue;
    const arrival = new Date(r.arrival);
    const leadTime = Math.max(0, Math.round((arrival - today) / 86_400_000));
    let p = 0.05; // base
    if (leadTime > 60) p += 0.15;
    else if (leadTime > 30) p += 0.07;
    if (r.prepaid === false) p += 0.05;
    if (/flex|refund/i.test(r.rateType || "")) p += 0.05;
    if (r.priorCancellations && r.priorCancellations > 0) p += 0.20;
    if (r.prepaid === true) p -= 0.10;
    p = clamp(p, 0.01, 0.85);
    const rooms = safe(r.rooms) || 1;
    out.push({ id: r.id, leadTime, probability: round2(p), rooms });
    totalRooms += rooms;
    expectedCancel += p * rooms;
  }
  return {
    status: "ok",
    perReservation: out,
    totalReservations: out.length,
    totalRooms,
    expectedCancelledRooms: round2(expectedCancel),
    expectedCancelRate: totalRooms > 0 ? round2(expectedCancel / totalRooms) : 0,
  };
}

/* ---------- Demand volatility ---------- */

export function demandVolatility(reports = []) {
  const sample = (reports || []).filter(r => safe(r.roomsAvailable) > 0).slice(-90);
  if (sample.length < 14) return { status: "insufficient-history" };
  const occs = sample.map(r => safe(r.roomsSold) / safe(r.roomsAvailable));
  const m = mean(occs);
  const sd = stddev(occs);
  const cv = m > 0 ? sd / m : 0;
  return {
    status: "ok",
    meanOccupancy: round2(m),
    stddev: round2(sd),
    coefficientOfVariation: round2(cv),
    band: cv < 0.10 ? "low" : cv < 0.20 ? "moderate" : cv < 0.35 ? "high" : "very-high",
    notes: cv >= 0.35 ? "Wide swing in occupancy — consider segment diversification and group base reinforcement." : null,
  };
}

/* ---------- Shoulder-night optimization ---------- */

/**
 * Identify weak shoulder nights (Sunday/Monday/Tuesday) adjacent to
 * strong peaks (Thursday/Friday/Saturday) and recommend price softening
 * or LOS extension to fill them.
 */
export function shoulderNightOptimization({ reports = [], asOf = null, horizonDays = 21 } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const past = (reports || []).filter(r => r.date < today).slice(-56); // 8 weeks
  if (past.length < 14) return { status: "insufficient-history" };
  // Build same-DoW average occupancy
  const byDow = new Map();
  for (const r of past) {
    const d = new Date(r.date);
    if (Number.isNaN(d.getTime())) continue;
    const dow = d.getDay();
    const occ = safe(r.roomsAvailable) > 0 ? safe(r.roomsSold) / safe(r.roomsAvailable) : 0;
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow).push(occ);
  }
  const avgByDow = {};
  for (const [dow, occs] of byDow) avgByDow[dow] = mean(occs);

  const recommendations = [];
  const start = new Date(today);
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dow = d.getDay();
    const iso = d.toISOString().slice(0, 10);
    const myOcc = avgByDow[dow] ?? 0;
    const prevDow = (dow + 6) % 7;
    const nextDow = (dow + 1) % 7;
    const prevOcc = avgByDow[prevDow] ?? 0;
    const nextOcc = avgByDow[nextDow] ?? 0;
    const isShoulder = myOcc < 0.55 && (prevOcc > 0.80 || nextOcc > 0.80);
    if (isShoulder) {
      recommendations.push({
        date: iso,
        dow,
        avgOcc: round2(myOcc),
        peakNeighborOcc: round2(Math.max(prevOcc, nextOcc)),
        action: nextOcc > prevOcc
          ? "set-minimum-LOS-2 on neighbor to fill this shoulder"
          : "soften BAR 8-10% to fill",
        rationale: `${(myOcc * 100).toFixed(0)}% avg vs neighbor peak ${(Math.max(prevOcc, nextOcc) * 100).toFixed(0)}%.`,
      });
    }
  }
  return { status: "ok", recommendations };
}

/* ---------- Revenue opportunity ranking ---------- */

/**
 * Aggregate all the engine's signals into a ranked list of revenue actions,
 * each with confidence + expected RevPAR impact (a back-of-the-envelope).
 *
 * @param {object} input
 *   { reports, history, asOf, paceForecast, capacity }
 */
export function rankRevenueOpportunities({ reports = [], history = [], asOf = null, paceForecast = [], capacity = null } = {}) {
  const opportunities = [];

  // 1. Compression-driven BAR lifts
  const priceRec = priceRecommendation({ history: history.length ? history : reports, dates: paceForecast.map(p => p.date), paceForecast, capacity });
  if (priceRec.status === "ok") {
    for (const line of priceRec.lines) {
      if (line.liftPct >= 0.05) {
        // Expected RevPAR delta = current ADR × (1 + liftPct) × occupancy_baseline - current
        const pace = paceForecast.find(p => p.date === line.date);
        const projOcc = pace ? safe(pace.projectedOccupancy) : 0;
        const expectedRevparLift = projOcc * line.medianAdr * line.liftPct;
        opportunities.push({
          code: "bar.lift",
          date: line.date,
          severity: line.liftPct >= 0.15 ? "high" : "medium",
          label: `BAR uplift ${(line.liftPct * 100).toFixed(1)}% on ${line.date}`,
          rationale: line.rationale,
          confidence: line.compressionScore ?? 0.5,
          expectedRevparLift: round2(expectedRevparLift),
        });
      } else if (line.liftPct <= -0.05) {
        opportunities.push({
          code: "bar.soften",
          date: line.date,
          severity: "low",
          label: `Soften BAR ${Math.abs(line.liftPct * 100).toFixed(1)}% on ${line.date}`,
          rationale: line.rationale,
          confidence: 0.55,
          expectedRevparLift: 0,
        });
      }
    }
  }

  // 2. Shoulder-night opportunities
  const shoulders = shoulderNightOptimization({ reports, asOf });
  if (shoulders.status === "ok") {
    for (const s of shoulders.recommendations) {
      opportunities.push({
        code: "shoulder.fill",
        date: s.date,
        severity: "medium",
        label: `Shoulder night ${s.date} (${(s.avgOcc * 100).toFixed(0)}%)`,
        rationale: s.rationale,
        action: s.action,
        confidence: 0.6,
        expectedRevparLift: round2((0.55 - s.avgOcc) * 100), // approx fill value
      });
    }
  }

  // 3. OTA dependency
  const ota = scoreOtaDependency({ reports });
  if (ota.status === "ok" && (ota.band === "high" || ota.band === "critical")) {
    opportunities.push({
      code: "ota.exposure",
      severity: ota.band === "critical" ? "high" : "medium",
      label: `OTA share ${(ota.otaShare * 100).toFixed(0)}% — reduce dependency`,
      rationale: ota.recommendation,
      confidence: 0.8,
      expectedRevparLift: round2(ota.otaRevenue * 0.05), // assume 5% of OTA rev recoverable to direct
    });
  }

  // 4. Volatility insight
  const vol = demandVolatility(reports);
  if (vol.status === "ok" && (vol.band === "high" || vol.band === "very-high")) {
    opportunities.push({
      code: "demand.volatile",
      severity: "low",
      label: `Demand volatility ${vol.band} (CV ${vol.coefficientOfVariation})`,
      rationale: vol.notes || "Stabilize with group base and corporate negotiated rates.",
      confidence: 0.65,
      expectedRevparLift: 0,
    });
  }

  // Sort by (severity rank * confidence) descending
  const sevRank = { high: 3, medium: 2, low: 1 };
  opportunities.sort((a, b) => ((sevRank[b.severity] || 1) * (b.confidence || 0)) - ((sevRank[a.severity] || 1) * (a.confidence || 0)));

  return {
    status: "ok",
    asOf,
    opportunities,
    summary: {
      total: opportunities.length,
      high: opportunities.filter(o => o.severity === "high").length,
      medium: opportunities.filter(o => o.severity === "medium").length,
      low: opportunities.filter(o => o.severity === "low").length,
      expectedTotalLift: round2(opportunities.reduce((s, o) => s + (o.expectedRevparLift || 0), 0)),
    },
  };
}

/* ---------- Aggregated runner ---------- */

export function runRevenueAI({ state, propertyId, asOf, capacity = null, enrichReport = null } = {}) {
  const enrich = enrichReport || (r => r);
  const reports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
  const history = reports.filter(r => r.date <= asOf);
  // paceForecast comes from the existing pace report, but we don't run it here to keep this engine pure.
  const paceForecast = state._paceForecast || [];
  return {
    propertyId,
    asOf,
    unconstrainedDemand: estimateUnconstrainedDemand(reports, asOf),
    elasticity: estimateElasticity(history),
    segmentProfitability: scoreSegmentProfitability({ reports: history, propertyId }),
    otaDependency: scoreOtaDependency({ reports: history, propertyId }),
    demandVolatility: demandVolatility(history),
    shoulderNights: shoulderNightOptimization({ reports: history, asOf }),
    opportunities: rankRevenueOpportunities({ reports: history, history, asOf, paceForecast, capacity }),
    runAt: new Date().toISOString(),
  };
}
