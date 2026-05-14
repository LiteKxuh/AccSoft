import { describe, it, expect } from "vitest";
import { forecast } from "./forecast.js";

const mkReport = (date, totalRevenue, vals = {}) => ({
  date,
  totalRevenue,
  occupancy: vals.occupancy ?? 0.7,
  adr: vals.adr ?? 120,
});

function makeHistory({ start = new Date("2026-04-15"), days = 30, daily = 1000, weekendBoost = 0 } = {}) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dow = d.getDay();
    const boost = (dow === 5 || dow === 6) ? weekendBoost : 0;
    return mkReport(d.toISOString().slice(0, 10), daily + boost);
  });
}

describe("forecast", () => {
  it("returns empty with fewer than 7 days", () => {
    const out = forecast(makeHistory({ days: 5 }), 7);
    expect(out.points).toEqual([]);
    expect(out._reason).toMatch(/7 days/);
  });

  it("produces horizon-length forecast points after history", () => {
    const out = forecast(makeHistory({ days: 30 }), 14);
    const futures = out.points.filter(p => p.isForecast);
    expect(futures.length).toBe(14);
  });

  it("flags trend direction up when revenue grows", () => {
    const growing = Array.from({ length: 30 }, (_, i) =>
      mkReport(new Date(Date.UTC(2026, 3, 15 + i)).toISOString().slice(0, 10), 1000 + i * 50)
    );
    const out = forecast(growing, 7);
    expect(out.summary.trendDirection).toBe("up");
  });

  it("flags trend direction down when revenue shrinks", () => {
    const shrinking = Array.from({ length: 30 }, (_, i) =>
      mkReport(new Date(Date.UTC(2026, 3, 15 + i)).toISOString().slice(0, 10), 2000 - i * 30)
    );
    const out = forecast(shrinking, 7);
    expect(out.summary.trendDirection).toBe("down");
  });

  it("widens confidence band as horizon extends", () => {
    const out = forecast(makeHistory({ days: 30, daily: 1000, weekendBoost: 200 }), 14);
    const fp = out.points.filter(p => p.isForecast);
    const band0 = fp[0].upper - fp[0].lower;
    const band13 = fp[13].upper - fp[13].lower;
    expect(band13).toBeGreaterThanOrEqual(band0);
  });

  it("captures weekend seasonality in dow factor", () => {
    const out = forecast(makeHistory({ days: 28, daily: 1000, weekendBoost: 800 }), 14);
    const fp = out.points.filter(p => p.isForecast);
    const fridayPts = fp.filter(p => new Date(p.date).getDay() === 5);
    const tuesdayPts = fp.filter(p => new Date(p.date).getDay() === 2);
    if (fridayPts.length && tuesdayPts.length) {
      expect(fridayPts[0].revenue).toBeGreaterThan(tuesdayPts[0].revenue);
    }
  });

  it("never produces negative revenue points", () => {
    const out = forecast(makeHistory({ days: 30, daily: 100, weekendBoost: 0 }), 14);
    out.points.forEach(p => {
      expect(p.revenue).toBeGreaterThanOrEqual(0);
      if (p.lower != null) expect(p.lower).toBeGreaterThanOrEqual(0);
    });
  });

  it("summary contains all expected keys", () => {
    const out = forecast(makeHistory({ days: 30 }), 14);
    expect(out.summary).toHaveProperty("total7");
    expect(out.summary).toHaveProperty("total14");
    expect(out.summary).toHaveProperty("avgOcc");
    expect(out.summary).toHaveProperty("avgAdr");
    expect(out.summary).toHaveProperty("trendDirection");
    expect(out.summary.confidence).toBeGreaterThanOrEqual(0.4);
    expect(out.summary.confidence).toBeLessThanOrEqual(0.95);
  });
});
