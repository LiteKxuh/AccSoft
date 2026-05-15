import { describe, it, expect } from "vitest";
import {
  gradeForecastHistory, recommendThresholds, summarizeVendorMemory,
  recommendationScoring, runAdaptiveLearning,
} from "./adaptiveLearningLayer.js";

describe("gradeForecastHistory", () => {
  it("returns no-history when no graded points", () => {
    expect(gradeForecastHistory({ forecasts: [], reports: [] }).status).toBe("no-history");
  });

  it("grades a forecast against actuals", () => {
    const forecasts = [{
      id: "f1", asOfDate: "2026-04-01", propertyId: "p1", horizon: 7,
      points: [
        { date: "2026-04-02", revenue: 10_000 },
        { date: "2026-04-03", revenue: 11_000 },
      ],
    }];
    const reports = [
      { date: "2026-04-02", propertyId: "p1", totalRevenue: 10_500 },
      { date: "2026-04-03", propertyId: "p1", totalRevenue: 10_000 },
    ];
    const r = gradeForecastHistory({ forecasts, reports, propertyId: "p1" });
    expect(r.status).toBe("ok");
    expect(r.summary.totalGradedPoints).toBe(2);
    expect(r.summary.mape).toBeGreaterThan(0);
    expect(["excellent", "good", "fair", "poor"]).toContain(r.summary.verdict);
  });

  it("rolls up MAPE/bias by horizon", () => {
    const forecasts = [{
      id: "f1", asOfDate: "2026-04-01", propertyId: "p1", horizon: 7,
      points: [
        { date: "2026-04-02", revenue: 10_000 },
        { date: "2026-04-04", revenue: 12_000 },
      ],
    }];
    const reports = [
      { date: "2026-04-02", propertyId: "p1", totalRevenue: 10_000 },
      { date: "2026-04-04", propertyId: "p1", totalRevenue: 11_000 },
    ];
    const r = gradeForecastHistory({ forecasts, reports, propertyId: "p1" });
    expect(r.byHorizon.length).toBeGreaterThan(0);
    expect(r.byHorizon.every(h => h.n > 0)).toBe(true);
  });
});

describe("recommendThresholds", () => {
  it("returns no-history with no anomalies", () => {
    expect(recommendThresholds({ anomalies: [] }).status).toBe("no-history");
  });

  it("recommends loosening on high false-positive rate", () => {
    const anomalies = Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`, code: "rev.spike", severity: "medium", falsePositive: true,
    }));
    const r = recommendThresholds({ anomalies });
    const rec = r.recommendations.find(x => x.code === "rev.spike");
    expect(rec).toBeTruthy();
    expect(rec.recommendation.direction).toBe("loosen");
  });

  it("recommends mute when fires but ignored", () => {
    const anomalies = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`, code: "lab.drift", severity: "low",
    }));
    const r = recommendThresholds({ anomalies });
    const rec = r.recommendations.find(x => x.code === "lab.drift");
    expect(rec).toBeTruthy();
    expect(rec.recommendation.direction).toBe("tighten-or-mute");
  });
});

describe("summarizeVendorMemory", () => {
  it("returns zero rows with no memory", () => {
    const r = summarizeVendorMemory({ vendorMemory: {} });
    expect(r.vendorCount).toBe(0);
  });

  it("rolls up usages per vendor", () => {
    const memory = {
      v1: { lastUpdate: "2026-05-10T00:00:00Z", codings: {
        "5100::": { accountCode: "5100", departmentId: null, count: 8, lastSeen: "2026-05-10T00:00:00Z" },
        "5100::fb": { accountCode: "5100", departmentId: "fb", count: 2, lastSeen: "2026-05-05T00:00:00Z" },
      } },
      v2: { lastUpdate: "2026-05-08T00:00:00Z", codings: {
        "6700::": { accountCode: "6700", departmentId: null, count: 3, lastSeen: "2026-05-08T00:00:00Z" },
      } },
    };
    const vendors = [{ id: "v1", name: "Sysco" }, { id: "v2", name: "Acme Maintenance" }];
    const r = summarizeVendorMemory({ vendorMemory: memory, vendors });
    expect(r.vendorCount).toBe(2);
    expect(r.totalUsages).toBe(13);
    expect(r.rows[0].vendorName).toBe("Sysco");
    expect(r.rows[0].confidence).toBe("high");
  });
});

describe("recommendationScoring", () => {
  it("rolls up acceptance by source", () => {
    const recommendationFeedback = [
      { id: "1", source: "revenue", accepted: true },
      { id: "2", source: "revenue", rejected: true },
      { id: "3", source: "revenue", accepted: true },
      { id: "4", source: "labor", accepted: true },
      { id: "5", source: "labor" }, // ignored
    ];
    const r = recommendationScoring({ recommendationFeedback });
    expect(r.status).toBe("ok");
    expect(r.overall.acceptanceRate).toBeCloseTo(3 / 5, 5);
    const rev = r.bySource.find(s => s.source === "revenue");
    expect(rev.acceptanceRate).toBeCloseTo(2 / 3, 5);
  });
});

describe("runAdaptiveLearning", () => {
  it("produces a unified learning report with empty state", () => {
    const r = runAdaptiveLearning({ state: {} });
    expect(r.status).toBe("ok");
    expect(r.headline).toBeTruthy();
  });

  it("produces a healthy headline when forecast is accurate", () => {
    const state = {
      forecasts: [{
        id: "f1", asOfDate: "2026-04-01", propertyId: "p1", horizon: 7,
        points: [
          { date: "2026-04-02", revenue: 10_000 },
          { date: "2026-04-03", revenue: 10_000 },
        ],
      }],
      reports: [
        { date: "2026-04-02", propertyId: "p1", totalRevenue: 10_050 },
        { date: "2026-04-03", propertyId: "p1", totalRevenue: 9_950 },
      ],
    };
    const r = runAdaptiveLearning({ state, propertyId: "p1" });
    expect(r.forecastAccuracy.status).toBe("ok");
    expect(r.headline.toLowerCase()).toContain("solid");
  });
});
