import { describe, it, expect } from "vitest";
import { appendForecast, gradeForecast } from "./forecastAccuracy.js";

const mkReport = (date, totalRevenue, vals = {}) => ({
  date, propertyId: "p1",
  totalRevenue, occupancy: vals.occupancy ?? 0.7, adr: vals.adr ?? 120,
});

describe("appendForecast", () => {
  it("rejects malformed input", () => {
    expect(() => appendForecast([], {})).toThrow();
    expect(() => appendForecast([], { propertyId: "p1", asOfDate: "2026-05-01" })).toThrow();
  });

  it("stamps id and createdAt", () => {
    const arr = appendForecast([], {
      asOfDate: "2026-05-01", propertyId: "p1",
      points: [{ date: "2026-05-02", revenue: 1000, occupancy: 0.7, adr: 120 }],
    });
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBeTruthy();
    expect(arr[0].createdAt).toBeTruthy();
  });
});

describe("gradeForecast", () => {
  it("returns no-overlap when no actuals match", () => {
    const forecasts = appendForecast([], {
      asOfDate: "2026-05-01", propertyId: "p1",
      points: [{ date: "2026-05-02", revenue: 1000 }],
    });
    const r = gradeForecast(forecasts, [], { propertyId: "p1" });
    expect(r.status).toBe("no-overlap");
  });

  it("computes MAE/MAPE/MPE on overlapping points", () => {
    const forecasts = appendForecast([], {
      asOfDate: "2026-05-01", propertyId: "p1",
      points: [
        { date: "2026-05-02", revenue: 1000 },
        { date: "2026-05-03", revenue: 1000 },
        { date: "2026-05-04", revenue: 1000 },
      ],
    });
    const reports = [
      mkReport("2026-05-02", 1100),  // +10% error
      mkReport("2026-05-03", 900),   // -10% error
      mkReport("2026-05-04", 1100),  // +10% error
    ];
    const r = gradeForecast(forecasts, reports, { propertyId: "p1", asOf: "2026-05-10" });
    expect(r.status).toBe("ok");
    expect(r.metrics.n).toBe(3);
    expect(r.metrics.mae).toBeCloseTo(100, 1);
    expect(r.metrics.mape).toBeCloseTo(0.10, 2);
    expect(r.metrics.mpe).toBeCloseTo((0.1 - 0.1 + 0.1) / 3, 3);
  });

  it("identifies forecasting bias", () => {
    const forecasts = appendForecast([], {
      asOfDate: "2026-05-01", propertyId: "p1",
      points: [
        { date: "2026-05-02", revenue: 1000 },
        { date: "2026-05-03", revenue: 1000 },
      ],
    });
    const reports = [
      mkReport("2026-05-02", 800),   // forecast too high
      mkReport("2026-05-03", 800),
    ];
    const r = gradeForecast(forecasts, reports, { propertyId: "p1", asOf: "2026-05-10" });
    expect(r.metrics.bias).toMatch(/under-forecasting/); // actual lower than forecast → MPE negative
  });

  it("breaks accuracy down by horizon", () => {
    const forecasts = appendForecast([], {
      asOfDate: "2026-05-01", propertyId: "p1",
      points: [
        { date: "2026-05-02", revenue: 1000 },
        { date: "2026-05-03", revenue: 1000 },
      ],
    });
    const reports = [
      mkReport("2026-05-02", 1000),
      mkReport("2026-05-03", 1200),
    ];
    const r = gradeForecast(forecasts, reports, { propertyId: "p1", asOf: "2026-05-10" });
    expect(r.horizonCurve.length).toBeGreaterThanOrEqual(2);
  });
});
