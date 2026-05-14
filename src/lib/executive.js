/* HotelOps · Executive intelligence layer
 * =================================================================
 * Portfolio command-center data. Builds an institutional view ownership
 * groups and asset managers actually use: NOI trend, GOP margin, asset
 * health score, ranking, overnight delta.
 *
 *   buildCommandCenter(state, { propertyIds, asOf })
 *     → { properties: [...], portfolio: {...}, overnight: [...] }
 *
 *   rankProperties(snapshots, criterion = "noi")
 *     → properties sorted by criterion with rank delta vs prior
 *
 *   buildOvernightDigest(state, { propertyIds, asOf })
 *     → "What changed since yesterday" digest by property
 */

import { snapshot, overnightDelta } from "./hotelState.js";
import { buildDepartmentPnl } from "./departmentPnl.js";
import { toCents, fromCents } from "./money.js";

const ASSET_HEALTH_WEIGHTS = {
  audit:       0.20,
  occupancy:   0.20,
  laborPct:    0.15,
  approvals:   0.10,
  apAging:     0.10,
  gopMargin:   0.15,
  riskFlags:   0.10,
};

/**
 * Build an asset health score 0-100 for a property snapshot. Combines
 * audit health, occupancy vs tier ceiling, labor cost discipline, AP
 * cleanliness, approval backlog, GOP margin, and active risk flags.
 */
export function assetHealthScore(snap, pnl = null) {
  if (!snap || snap.status !== "ok") return null;
  const components = {};

  // Audit (0-100 already)
  components.audit = (snap.audit?.score ?? 70);

  // Occupancy — penalize being far from healthy MTD occupancy by tier
  const targetOcc = ({ luxury: 0.70, "upper-upscale": 0.72, upscale: 0.72, midscale: 0.68, economy: 0.62 })[snap.tier] || 0.68;
  const occ = snap.mtd?.occupancy || 0;
  const occScore = Math.max(0, 100 - Math.min(100, Math.abs(occ - targetOcc) * 200));
  components.occupancy = occScore;

  // Labor pct of rev: target 30%, every 5pts off = -20pts
  const laborTarget = 0.30;
  const laborPct = snap.labor?.mtdPctRev || 0;
  const laborDelta = Math.abs(laborPct - laborTarget);
  components.laborPct = Math.max(0, 100 - laborDelta * 400);

  // Approval backlog: $25k = -10, $100k = -40
  const approvalDollar = snap.approvals?.pendingDollar || 0;
  components.approvals = Math.max(0, 100 - Math.min(100, (approvalDollar / 100_000) * 50));

  // AP aging — over 120 days hurts most
  const apTot = snap.ledger?.ap?.total || 0;
  const apOver = snap.ledger?.apOver120 || 0;
  const overShare = apTot > 0 ? apOver / apTot : 0;
  components.apAging = Math.max(0, 100 - overShare * 150);

  // GOP margin
  if (pnl?.totals && pnl.totals.revenue.total > 0) {
    const gopPct = pnl.totals.gopPct || 0;
    // Healthy band 25-45% → 100. Outside → penalty.
    const center = 0.33;
    components.gopMargin = Math.max(0, 100 - Math.abs(gopPct - center) * 250);
  } else {
    components.gopMargin = 60; // neutral when no P&L
  }

  // Risk flags
  const high = snap.riskFlags?.filter(f => f.severity === "high").length || 0;
  const med = snap.riskFlags?.filter(f => f.severity === "medium").length || 0;
  components.riskFlags = Math.max(0, 100 - high * 25 - med * 8);

  // Weighted blend
  let score = 0;
  for (const [k, v] of Object.entries(components)) {
    score += v * (ASSET_HEALTH_WEIGHTS[k] || 0);
  }
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    components,
    band: score >= 85 ? "strong" : score >= 70 ? "healthy" : score >= 50 ? "watch" : "at-risk",
  };
}

export function rankProperties(snapshots, criterion = "noi") {
  const valid = (snapshots || []).filter(s => s.status === "ok");
  const sorted = [...valid].sort((a, b) => criterionValue(b, criterion) - criterionValue(a, criterion));
  return sorted.map((s, i) => ({
    rank: i + 1,
    propertyId: s.propertyId,
    metric: criterionValue(s, criterion),
    snapshot: s,
  }));
}

function criterionValue(s, criterion) {
  switch (criterion) {
    case "revenue": return s.mtd?.revenue || 0;
    case "occupancy": return s.mtd?.occupancy || 0;
    case "adr": return s.mtd?.adr || 0;
    case "revpar": return s.mtd?.revpar || 0;
    case "labor": return -(s.labor?.mtdPctRev || 0); // lower is better, invert
    case "risk": return -(s.riskFlags?.length || 0);
    case "noi":
    default: return s.mtd?.revenue || 0;
  }
}

/**
 * Full executive command-center payload.
 */
export function buildCommandCenter(state, { propertyIds, asOf, enrichReport = null } = {}) {
  const snaps = (propertyIds || []).map(pid => snapshot(state, { propertyId: pid, asOf, enrichReport }));
  const ranked = rankProperties(snaps, "revenue");

  // Department P&L per property (MTD)
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const properties = ranked.map(({ rank, snapshot: s }) => {
    let pnl = null;
    if (s.status === "ok") {
      try {
        pnl = buildDepartmentPnl({
          ledger: (state.journalEntries || []).filter(j => j.posted && !j.void),
          start: monthStart, end: asOf, propertyId: s.propertyId,
        });
      } catch { pnl = null; }
    }
    const health = assetHealthScore(s, pnl);
    return {
      rank,
      propertyId: s.propertyId,
      propertyName: (state.properties || []).find(p => p.id === s.propertyId)?.name || s.propertyId,
      snapshot: s,
      pnl: pnl?.totals || null,
      health,
    };
  });

  // Portfolio aggregates
  const portfolio = properties.reduce((acc, p) => {
    if (p.snapshot.status !== "ok") return acc;
    acc.revenue += p.snapshot.mtd?.revenue || 0;
    acc.roomsSold += p.snapshot.mtd?.roomsSold || 0;
    acc.roomsAvail += p.snapshot.mtd?.roomsAvailable || 0;
    acc.laborCost += p.snapshot.labor?.mtdCost || 0;
    acc.apOver120 += p.snapshot.ledger?.apOver120 || 0;
    acc.pendingApprovalDollar += p.snapshot.approvals?.pendingDollar || 0;
    acc.highRiskFlags += p.snapshot.riskFlags?.filter(f => f.severity === "high").length || 0;
    if (p.pnl) acc.gop += p.pnl.gop || 0;
    acc.healthSum += p.health?.score || 0;
    acc.n += 1;
    return acc;
  }, { revenue: 0, roomsSold: 0, roomsAvail: 0, laborCost: 0, apOver120: 0, pendingApprovalDollar: 0, highRiskFlags: 0, gop: 0, healthSum: 0, n: 0 });
  portfolio.occupancy = portfolio.roomsAvail > 0 ? portfolio.roomsSold / portfolio.roomsAvail : 0;
  portfolio.laborPctRev = portfolio.revenue > 0 ? portfolio.laborCost / portfolio.revenue : 0;
  portfolio.gopPct = portfolio.revenue > 0 ? portfolio.gop / portfolio.revenue : 0;
  portfolio.avgHealth = portfolio.n > 0 ? portfolio.healthSum / portfolio.n : 0;

  return {
    asOf,
    portfolio,
    properties,
  };
}

/**
 * Overnight digest — "what changed since yesterday" per property.
 */
export function buildOvernightDigest(state, { propertyIds, asOf, enrichReport = null } = {}) {
  return (propertyIds || []).map(pid => overnightDelta(state, { propertyId: pid, asOf, enrichReport }));
}
