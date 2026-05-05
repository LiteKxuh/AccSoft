/* HotelOps · Forecasting engine
 * =================================================================
 * Project next-N-day revenue, occupancy, and ADR for any property
 * using a simple but defensible decomposition:
 *
 *    forecast(d) = trendLine(d) × seasonality(dayOfWeek(d))
 *
 *  - trendLine: ordinary-least-squares linear regression on the last
 *    30 days of total revenue (smoothed).
 *  - seasonality: average ratio of (actual / trend) for each weekday,
 *    so Saturdays are correctly higher and Tuesdays lower.
 *
 * Returns:
 *   {
 *     points: [{ date, revenue, occupancy, adr, lower, upper, isForecast }, ...],
 *     summary: { total7, total14, avgOcc, avgAdr, vsLast7, vsLast14 },
 *   }
 *
 * No external libs. Plain math. Designed to be honest about uncertainty —
 * confidence band widens as the forecast horizon grows.
 */

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function olsLine(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0, residStd: 0 };
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  // residual std-dev for confidence band
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const yhat = intercept + slope * xs[i];
    ssr += (ys[i] - yhat) ** 2;
  }
  const residStd = Math.sqrt(ssr / Math.max(1, n - 2));
  return { slope, intercept, residStd };
}

/**
 * @param {Array} reports  enriched reports (already filtered to a single property)
 * @param {number} horizon  days to forecast (default 14)
 */
export function forecast(reports, horizon = 14) {
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  const last30 = sorted.slice(-30);
  if (last30.length < 7) {
    return { points: [], summary: null, _reason: "Need at least 7 days of history." };
  }

  // 1) trend
  const xs = last30.map((_, i) => i);
  const ys = last30.map((r) => r.totalRevenue);
  const { slope, intercept, residStd } = olsLine(xs, ys);
  const trendAt = (i) => intercept + slope * i;

  // 2) day-of-week seasonality factor
  const dowSums = new Array(7).fill(0);
  const dowCnt = new Array(7).fill(0);
  last30.forEach((r, i) => {
    const expected = trendAt(i) || 1;
    const factor = r.totalRevenue / expected;
    const dow = new Date(r.date).getDay();
    dowSums[dow] += factor;
    dowCnt[dow]++;
  });
  const dowFactor = (d) => (dowCnt[d] ? dowSums[d] / dowCnt[d] : 1);

  // 3) historical occupancy / ADR averages by DOW
  const dowOcc = new Array(7).fill(0).map(() => ({ s: 0, c: 0 }));
  const dowAdr = new Array(7).fill(0).map(() => ({ s: 0, c: 0 }));
  last30.forEach((r) => {
    const dow = new Date(r.date).getDay();
    dowOcc[dow].s += r.occupancy; dowOcc[dow].c++;
    dowAdr[dow].s += r.adr; dowAdr[dow].c++;
  });
  const avgOcc = (d) => (dowOcc[d].c ? dowOcc[d].s / dowOcc[d].c : 0);
  const avgAdr = (d) => (dowAdr[d].c ? dowAdr[d].s / dowAdr[d].c : 0);

  // 4) build past + future points
  const points = [];
  // include the last 14 actuals so charts have context
  sorted.slice(-14).forEach((r) => {
    points.push({
      date: r.date,
      revenue: r.totalRevenue,
      occupancy: r.occupancy,
      adr: r.adr,
      isForecast: false,
    });
  });
  const lastDate = new Date(sorted[sorted.length - 1].date);
  for (let i = 1; i <= horizon; i++) {
    const d = addDays(lastDate, i);
    const t = last30.length - 1 + i;
    const baseRev = trendAt(t) * dowFactor(d.getDay());
    // confidence band widens with horizon
    const widen = 1 + i / 14;
    const band = residStd * 1.96 * widen;
    points.push({
      date: iso(d),
      revenue: Math.max(0, baseRev),
      occupancy: avgOcc(d.getDay()),
      adr: avgAdr(d.getDay()),
      lower: Math.max(0, baseRev - band),
      upper: baseRev + band,
      isForecast: true,
    });
  }

  // 5) summary tiles
  const futurePts = points.filter((p) => p.isForecast);
  const next7 = futurePts.slice(0, 7);
  const next14 = futurePts.slice(0, 14);
  const sum = (arr, k) => arr.reduce((s, p) => s + (p[k] || 0), 0);
  const avg = (arr, k) => arr.length ? sum(arr, k) / arr.length : 0;
  const last7Actual = sorted.slice(-7);
  const last14Actual = sorted.slice(-14);
  const summary = {
    total7: sum(next7, "revenue"),
    total14: sum(next14, "revenue"),
    avgOcc: avg(next7, "occupancy"),
    avgAdr: avg(next7, "adr"),
    vsLast7: last7Actual.length ? (sum(next7, "revenue") - last7Actual.reduce((s, r) => s + r.totalRevenue, 0)) / last7Actual.reduce((s, r) => s + r.totalRevenue, 0) : 0,
    vsLast14: last14Actual.length ? (sum(next14, "revenue") - last14Actual.reduce((s, r) => s + r.totalRevenue, 0)) / last14Actual.reduce((s, r) => s + r.totalRevenue, 0) : 0,
    trendDirection: slope > 0 ? "up" : slope < 0 ? "down" : "flat",
    confidence: Math.max(0.4, Math.min(0.95, 1 - residStd / Math.max(1, intercept))),
  };

  return { points, summary };
}
