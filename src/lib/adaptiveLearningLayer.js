/* HotelOps · Adaptive Learning Layer
 * =================================================================
 * The platform continually grades its own predictions, classifications,
 * and recommendations — and surfaces "what's improving / what's drifting"
 * so operators can tune.
 *
 * Inputs are pulled from data the system already collects:
 *   - Forecast snapshots vs reported actuals (forecastAccuracy.js)
 *   - Vendor coding memory (vendorMemory.js / localStorage)
 *   - Anomaly findings vs subsequent operator action
 *   - Recommendation acceptance feedback (state.recommendationFeedback)
 *
 * Output is a "learning report" — operators see where the system has
 * earned trust and where it should be tuned down.
 *
 * Pure functions. The learning is reflected in deterministic state, not
 * in any opaque model. The platform owner can always audit *why* a
 * threshold drifted.
 *
 * API:
 *   gradeForecastHistory({ forecasts, reports, propertyId })
 *   recommendThresholds({ anomalies, accuracy, currentThresholds })
 *   summarizeVendorMemory({ vendorMemory })
 *   recommendationScoring({ recommendationFeedback })
 *   runAdaptiveLearning({ state, propertyId })
 */

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function pct(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }

/* ---------- Forecast accuracy grading ---------- */

/**
 * Grade every past forecast horizon vs reported actuals.
 * For each forecast, compute MAPE/MAE/bias on the points whose date <= today.
 */
export function gradeForecastHistory({ forecasts = [], reports = [], propertyId = null }) {
  const today = new Date().toISOString().slice(0, 10);
  const propForecasts = forecasts.filter(f => !propertyId || f.propertyId === propertyId);
  const propReports = reports.filter(r => !propertyId || r.propertyId === propertyId);
  const byDate = new Map(propReports.map(r => [r.date, r]));
  const grades = [];
  for (const f of propForecasts) {
    const grades_ = [];
    for (const p of (f.points || [])) {
      if (p.date > today) continue;
      const actual = byDate.get(p.date);
      if (!actual) continue;
      const predicted = safe(p.revenue);
      const actualRev = safe(actual.totalRevenue);
      if (actualRev <= 0) continue;
      grades_.push({
        date: p.date,
        horizonDays: daysBetween(f.asOfDate, p.date),
        predicted,
        actual: actualRev,
        absErr: Math.abs(predicted - actualRev),
        pctErr: (predicted - actualRev) / actualRev,
      });
    }
    if (grades_.length) {
      const mape = grades_.reduce((s, g) => s + Math.abs(g.pctErr), 0) / grades_.length;
      const bias = grades_.reduce((s, g) => s + g.pctErr, 0) / grades_.length;
      grades.push({
        forecastId: f.id,
        asOfDate: f.asOfDate,
        horizon: f.horizon,
        n: grades_.length,
        mape,
        bias,
        items: grades_,
      });
    }
  }
  // Aggregate across all forecasts
  if (!grades.length) return { status: "no-history", grades: [] };
  const totalN = grades.reduce((s, g) => s + g.n, 0);
  const overallMape = grades.reduce((s, g) => s + g.mape * g.n, 0) / totalN;
  const overallBias = grades.reduce((s, g) => s + g.bias * g.n, 0) / totalN;
  // By horizon — does the forecast get worse for longer horizons?
  const byHorizon = new Map();
  for (const g of grades) {
    for (const i of g.items) {
      const h = i.horizonDays;
      if (!byHorizon.has(h)) byHorizon.set(h, []);
      byHorizon.get(h).push(i);
    }
  }
  const horizonRows = Array.from(byHorizon.entries())
    .map(([horizonDays, items]) => ({
      horizonDays,
      n: items.length,
      mape: items.reduce((s, i) => s + Math.abs(i.pctErr), 0) / items.length,
      bias: items.reduce((s, i) => s + i.pctErr, 0) / items.length,
    }))
    .sort((a, b) => a.horizonDays - b.horizonDays);

  return {
    status: "ok",
    grades,
    summary: {
      totalForecasts: grades.length,
      totalGradedPoints: totalN,
      mape: overallMape,
      bias: overallBias,
      formatted: {
        mape: pct(overallMape, 2),
        bias: pct(overallBias, 2),
      },
      verdict: overallMape < 0.05 ? "excellent" : overallMape < 0.10 ? "good" : overallMape < 0.20 ? "fair" : "poor",
    },
    byHorizon: horizonRows,
  };
}

function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86_400_000));
}

/* ---------- Anomaly threshold recommendations ---------- */

/**
 * Given recent anomaly findings and whether the operator acted on them,
 * recommend whether the anomaly threshold should tighten or loosen.
 *
 * Input:
 *   anomalies: [{ id, code, severity, dismissed?, acted?, falsePositive? }]
 *   currentThresholds: { revenueMad?, occupancyMad?, ... }
 */
export function recommendThresholds({ anomalies = [], currentThresholds = {} }) {
  if (!anomalies.length) return { status: "no-history", recommendations: [] };
  const byCode = new Map();
  for (const a of anomalies) {
    if (!byCode.has(a.code)) byCode.set(a.code, []);
    byCode.get(a.code).push(a);
  }
  const recs = [];
  for (const [code, list] of byCode) {
    const total = list.length;
    const dismissed = list.filter(a => a.dismissed).length;
    const fp = list.filter(a => a.falsePositive).length;
    const acted = list.filter(a => a.acted).length;
    const fpRate = total > 0 ? (fp + dismissed) / total : 0;
    const actionRate = total > 0 ? acted / total : 0;
    let recommendation = null;
    if (total >= 5 && fpRate > 0.6) {
      recommendation = { direction: "loosen", reason: `${(fpRate * 100).toFixed(0)}% false-positive rate over ${total} occurrences`, deltaMultiplier: 1.2 };
    } else if (total >= 5 && actionRate > 0.5) {
      recommendation = { direction: "keep", reason: `Operator acted on ${(actionRate * 100).toFixed(0)}% — keep threshold`, deltaMultiplier: 1.0 };
    } else if (total >= 8 && fpRate < 0.1 && actionRate < 0.2) {
      recommendation = { direction: "tighten-or-mute", reason: "Detector fires but no one acts — investigate signal value", deltaMultiplier: 0.9 };
    }
    if (recommendation) {
      recs.push({ code, total, dismissed, falsePositives: fp, acted, fpRate, actionRate, recommendation });
    }
  }
  return { status: "ok", recommendations: recs };
}

/* ---------- Vendor memory summary ---------- */

/**
 * Summarize how well the vendor-coding memory is performing — count of
 * vendors with learned codings, hit rate, top vendors by usage.
 *
 * vendorMemory shape (from vendorMemory.exportMemory()):
 *   { [vendorId]: { codings: { [k]: { accountCode, departmentId, count, lastSeen } }, lastUpdate } }
 */
export function summarizeVendorMemory({ vendorMemory = {}, vendors = [] }) {
  const vendorById = new Map((vendors || []).map(v => [v.id, v]));
  const rows = [];
  let totalUsages = 0;
  for (const [vendorId, v] of Object.entries(vendorMemory)) {
    const codings = Object.values(v.codings || {});
    const total = codings.reduce((s, c) => s + (c.count || 0), 0);
    totalUsages += total;
    const top = [...codings].sort((a, b) => (b.count || 0) - (a.count || 0))[0] || null;
    rows.push({
      vendorId,
      vendorName: vendorById.get(vendorId)?.name || vendorId,
      uniqueCodings: codings.length,
      totalUsages: total,
      topAccount: top?.accountCode || null,
      lastUpdate: v.lastUpdate || null,
      confidence: total >= 5 ? "high" : total >= 2 ? "medium" : "low",
    });
  }
  rows.sort((a, b) => b.totalUsages - a.totalUsages);
  return {
    status: "ok",
    vendorCount: rows.length,
    totalUsages,
    rows: rows.slice(0, 50),
    summary: rows.length
      ? `${rows.length} vendors with learned coding (${totalUsages} total usages).`
      : "No vendor coding memory yet.",
  };
}

/* ---------- Recommendation scoring ---------- */

/**
 * Score the platform's recommendations based on operator feedback.
 *
 * recommendationFeedback: [{ id, source, action, accepted, rejected, ignored, at }]
 */
export function recommendationScoring({ recommendationFeedback = [] }) {
  if (!recommendationFeedback.length) {
    return { status: "no-history", overall: null, bySource: {} };
  }
  const bySource = new Map();
  for (const r of recommendationFeedback) {
    const key = r.source || "unknown";
    if (!bySource.has(key)) bySource.set(key, { source: key, accepted: 0, rejected: 0, ignored: 0, total: 0 });
    const row = bySource.get(key);
    row.total++;
    if (r.accepted) row.accepted++;
    else if (r.rejected) row.rejected++;
    else row.ignored++;
  }
  const rows = Array.from(bySource.values()).map(r => ({
    ...r,
    acceptanceRate: r.total > 0 ? r.accepted / r.total : 0,
    rejectionRate: r.total > 0 ? r.rejected / r.total : 0,
    trustScore: Math.round((r.total > 0 ? r.accepted / r.total : 0) * 100),
  }));
  rows.sort((a, b) => b.total - a.total);
  const total = recommendationFeedback.length;
  const accepted = recommendationFeedback.filter(r => r.accepted).length;
  return {
    status: "ok",
    overall: { total, accepted, acceptanceRate: accepted / total, trustScore: Math.round((accepted / total) * 100) },
    bySource: rows,
  };
}

/* ---------- Aggregated learning report ---------- */

export function runAdaptiveLearning({ state, propertyId = null } = {}) {
  const forecast = gradeForecastHistory({
    forecasts: state.forecasts || [],
    reports: state.reports || [],
    propertyId,
  });
  const thresholds = recommendThresholds({
    anomalies: state.anomalyHistory || [],
    currentThresholds: state.detectorConfig || {},
  });
  const vendor = summarizeVendorMemory({
    vendorMemory: state.vendorMemoryExport || {},
    vendors: state.vendors || [],
  });
  const recs = recommendationScoring({
    recommendationFeedback: state.recommendationFeedback || [],
  });
  // Headline: improving / drifting verdict
  const headline = (() => {
    if (forecast.status === "ok") {
      if (forecast.summary.verdict === "excellent" || forecast.summary.verdict === "good") return "Forecast accuracy is solid — system trust intact.";
      if (forecast.summary.verdict === "poor") return "Forecast accuracy is drifting — re-check inputs and detector tuning.";
    }
    if (thresholds.recommendations?.length) {
      return `${thresholds.recommendations.length} detector(s) ready for threshold adjustment.`;
    }
    return "Adaptive learning is online — collecting evidence.";
  })();
  return {
    status: "ok",
    propertyId,
    headline,
    forecastAccuracy: forecast,
    thresholdRecommendations: thresholds,
    vendorMemory: vendor,
    recommendationScoring: recs,
    runAt: new Date().toISOString(),
  };
}
