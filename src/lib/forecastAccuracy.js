/* HotelOps · Forecast accuracy tracker
 * =================================================================
 * Stores point-in-time forecasts and grades them against actuals as
 * the dates roll past. Industry KPIs:
 *
 *   MAPE — Mean Absolute Percent Error
 *   MAE  — Mean Absolute Error
 *   MPE  — Mean Percent Error (bias)
 *   sMAPE — symmetric MAPE for small denominators
 *
 *   appendForecast(state, forecastSnapshot)
 *   gradeForecast(forecasts, reports, { propertyId, asOf })
 *
 * Forecast snapshot shape:
 *   { id, asOfDate, propertyId, horizon, points: [{ date, revenue, occupancy, adr }] }
 *
 * Pure functions — no I/O.
 */

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }

export function appendForecast(forecasts, snapshot) {
  if (!snapshot?.asOfDate || !snapshot?.propertyId || !Array.isArray(snapshot?.points)) {
    throw new Error("forecast snapshot must have asOfDate, propertyId, and points[]");
  }
  return [...(forecasts || []), {
    id: snapshot.id || `fc_${snapshot.propertyId}_${snapshot.asOfDate}_${Date.now().toString(36)}`,
    asOfDate: snapshot.asOfDate,
    propertyId: snapshot.propertyId,
    horizon: snapshot.horizon || snapshot.points.length,
    createdAt: new Date().toISOString(),
    points: snapshot.points.map(p => ({
      date: p.date,
      revenue: safe(p.revenue),
      occupancy: safe(p.occupancy),
      adr: safe(p.adr),
    })),
  }];
}

/**
 * @param {Array} forecasts  state.forecasts
 * @param {Array} reports    state.reports
 * @param {object} opts      { propertyId, asOf, maxHorizon? }
 */
export function gradeForecast(forecasts, reports, { propertyId, asOf, maxHorizon = 14 } = {}) {
  const own = (forecasts || []).filter(f => f.propertyId === propertyId);
  const reportsByDate = new Map((reports || []).filter(r => r.propertyId === propertyId).map(r => [r.date, r]));

  const graded = [];
  for (const fc of own) {
    for (let i = 0; i < fc.points.length && i < maxHorizon; i++) {
      const p = fc.points[i];
      const actual = reportsByDate.get(p.date);
      if (!actual) continue;
      if (asOf && p.date > asOf) continue;
      graded.push({
        forecastId: fc.id,
        asOfDate: fc.asOfDate,
        targetDate: p.date,
        horizonDays: i + 1,
        forecastRevenue: safe(p.revenue),
        actualRevenue: safe(actual.totalRevenue),
        forecastOccupancy: safe(p.occupancy),
        actualOccupancy: safe(actual.occupancy),
        revenueError: safe(actual.totalRevenue) - safe(p.revenue),
        revenuePctError: safe(p.revenue) > 0 ? (safe(actual.totalRevenue) - safe(p.revenue)) / safe(p.revenue) : null,
      });
    }
  }

  if (graded.length === 0) {
    return { status: "no-overlap", graded: [], metrics: null };
  }

  const revActuals = graded.map(g => g.actualRevenue);
  const revForecasts = graded.map(g => g.forecastRevenue);
  const errors = graded.map(g => g.revenueError);
  const pctErrors = graded.map(g => g.revenuePctError).filter(v => v != null);

  const metrics = {
    n: graded.length,
    mae: errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length,
    mpe: pctErrors.length ? pctErrors.reduce((s, e) => s + e, 0) / pctErrors.length : null,
    mape: pctErrors.length ? pctErrors.reduce((s, e) => s + Math.abs(e), 0) / pctErrors.length : null,
    smape: revActuals.length
      ? revActuals.reduce((s, a, i) => {
          const denom = (Math.abs(a) + Math.abs(revForecasts[i])) / 2;
          return s + (denom > 0 ? Math.abs(a - revForecasts[i]) / denom : 0);
        }, 0) / revActuals.length
      : null,
    bias: pctErrors.length
      ? (pctErrors.reduce((s, e) => s + e, 0) / pctErrors.length > 0 ? "over-forecasting (positive bias)" : "under-forecasting (negative bias)")
      : null,
  };

  // Horizon breakdown — accuracy typically degrades with longer horizon
  const byHorizon = new Map();
  for (const g of graded) {
    if (!byHorizon.has(g.horizonDays)) byHorizon.set(g.horizonDays, []);
    byHorizon.get(g.horizonDays).push(g);
  }
  const horizonCurve = Array.from(byHorizon.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([h, rows]) => ({
      horizonDays: h,
      n: rows.length,
      mae: rows.reduce((s, r) => s + Math.abs(r.revenueError), 0) / rows.length,
      mape: rows.filter(r => r.revenuePctError != null).reduce((s, r) => s + Math.abs(r.revenuePctError), 0) / Math.max(1, rows.filter(r => r.revenuePctError != null).length),
    }));

  return {
    status: "ok",
    graded,
    metrics,
    horizonCurve,
  };
}
