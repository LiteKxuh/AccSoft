import { describe, it, expect } from "vitest";
import {
  estimateUnconstrainedDemand, estimateElasticity, scoreSegmentProfitability,
  scoreOtaDependency, predictCancellations, demandVolatility,
  shoulderNightOptimization, rankRevenueOpportunities, runRevenueAI,
} from "./revenueAIEngine.js";

function mkReport(date, propertyId, vals = {}) {
  return {
    date, propertyId,
    roomsAvailable: vals.roomsAvailable ?? 100,
    roomsSold: vals.roomsSold ?? 70,
    adr: vals.adr ?? 120,
    totalRevenue: vals.totalRevenue ?? 9000,
    breakdown: vals.breakdown ?? null,
  };
}

function seedReports(n, propertyId = "p1", base = {}) {
  const out = [];
  const start = new Date("2026-01-01");
  for (let i = 0; i < n; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    out.push(mkReport(d.toISOString().slice(0, 10), propertyId, base));
  }
  return out;
}

describe("estimateUnconstrainedDemand", () => {
  it("returns insufficient-history below 30 days", () => {
    expect(estimateUnconstrainedDemand([], "2026-05-14").status).toBe("insufficient-history");
  });

  it("produces by-DoW rows with ≥30 days of history", () => {
    const reports = seedReports(60);
    const r = estimateUnconstrainedDemand(reports, "2026-05-14");
    expect(r.status).toBe("ok");
    expect(r.byDayOfWeek.length).toBe(7);
    expect(r.byDayOfWeek.every(row => row.sampleSize > 0)).toBe(true);
  });

  it("bumps unconstrained demand when capping is followed by more capping", () => {
    const reports = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date("2026-01-01"); d.setDate(d.getDate() + i);
      reports.push(mkReport(d.toISOString().slice(0, 10), "p1", {
        roomsAvailable: 100, roomsSold: 99,
      }));
    }
    const r = estimateUnconstrainedDemand(reports, "2026-03-30");
    expect(r.byDayOfWeek[0].unconstrainedMean).toBeGreaterThan(r.byDayOfWeek[0].observedMean);
  });
});

describe("estimateElasticity", () => {
  it("rejects insufficient data", () => {
    expect(estimateElasticity([]).status).toBe("insufficient-history");
  });

  it("detects negative elasticity in price-sensitive demand", () => {
    const reports = [];
    // Lower ADR → higher sold
    for (let i = 0; i < 60; i++) {
      const adr = 100 + (i % 20) * 5;
      const sold = 100 - (i % 20) * 2;
      const d = new Date("2026-01-01"); d.setDate(d.getDate() + i);
      reports.push(mkReport(d.toISOString().slice(0, 10), "p1", {
        adr, roomsSold: sold, totalRevenue: sold * adr,
      }));
    }
    const r = estimateElasticity(reports);
    expect(r.status).toBe("ok");
    expect(r.elasticity).toBeLessThan(0);
  });

  it("detects inelasticity when no price variance", () => {
    const reports = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date("2026-01-01"); d.setDate(d.getDate() + i);
      reports.push(mkReport(d.toISOString().slice(0, 10), "p1", { adr: 120, roomsSold: 70 }));
    }
    const r = estimateElasticity(reports);
    expect(r.status).toBe("no-price-variance");
  });
});

describe("scoreSegmentProfitability", () => {
  it("ranks segments by net ADR after acquisition cost", () => {
    const reports = [{
      date: "2026-05-10", propertyId: "p1",
      breakdown: { segments: {
        ota:      { revenue: 10_000, roomNights: 80 },
        direct:   { revenue: 8_000,  roomNights: 60 },
        group:    { revenue: 4_000,  roomNights: 40 },
      } },
    }];
    const r = scoreSegmentProfitability({ reports, period: { start: "2026-05-01", end: "2026-05-31" } });
    expect(r.status).toBe("ok");
    // Direct should rank above OTA on netAdr (lower acquisition cost)
    const direct = r.segments.find(s => s.segment === "direct");
    const ota = r.segments.find(s => s.segment === "ota");
    expect(direct.netAdr).toBeGreaterThan(ota.netAdr);
  });

  it("returns no-segment-data when reports lack segments", () => {
    const reports = [mkReport("2026-05-10", "p1")];
    expect(scoreSegmentProfitability({ reports }).status).toBe("no-segment-data");
  });
});

describe("scoreOtaDependency", () => {
  it("bands OTA share correctly", () => {
    const reports = [{
      date: "2026-05-10", propertyId: "p1",
      breakdown: { segments: {
        ota:    { revenue: 6_000, roomNights: 50 },
        direct: { revenue: 4_000, roomNights: 30 },
      } },
    }];
    const r = scoreOtaDependency({ reports });
    expect(r.status).toBe("ok");
    expect(r.otaShare).toBeCloseTo(0.6, 2);
    expect(r.band).toBe("critical");
  });
});

describe("predictCancellations", () => {
  it("returns no-reservations when empty", () => {
    expect(predictCancellations({ reservations: [] }).status).toBe("no-reservations");
  });

  it("assigns higher probability for long lead times + flex rates", () => {
    const arrival = new Date(); arrival.setDate(arrival.getDate() + 75);
    const reservations = [
      { id: "r1", arrival: arrival.toISOString().slice(0, 10), rateType: "flexible", rooms: 1 },
      { id: "r2", arrival: new Date().toISOString().slice(0, 10), rooms: 1, prepaid: true },
    ];
    const r = predictCancellations({ reservations });
    const r1 = r.perReservation.find(x => x.id === "r1");
    const r2 = r.perReservation.find(x => x.id === "r2");
    expect(r1.probability).toBeGreaterThan(r2.probability);
  });
});

describe("demandVolatility", () => {
  it("detects high CV for swinging occupancy", () => {
    const reports = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date("2026-04-01"); d.setDate(d.getDate() + i);
      // Alternate 20% / 95% occupancy
      const sold = i % 2 === 0 ? 20 : 95;
      reports.push(mkReport(d.toISOString().slice(0, 10), "p1", { roomsSold: sold }));
    }
    const r = demandVolatility(reports);
    expect(r.status).toBe("ok");
    expect(["high", "very-high"]).toContain(r.band);
  });
});

describe("shoulderNightOptimization", () => {
  it("identifies weak Sun/Mon between strong Fri/Sat", () => {
    const reports = [];
    for (let i = 0; i < 56; i++) {
      const d = new Date("2026-03-01"); d.setDate(d.getDate() + i);
      const dow = d.getDay();
      const sold = (dow === 5 || dow === 6) ? 95 : (dow === 0 || dow === 1) ? 35 : 65;
      reports.push(mkReport(d.toISOString().slice(0, 10), "p1", { roomsSold: sold }));
    }
    const r = shoulderNightOptimization({ reports, asOf: "2026-04-27", horizonDays: 14 });
    expect(r.status).toBe("ok");
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

describe("rankRevenueOpportunities", () => {
  it("returns a ranked list with severity counts", () => {
    const reports = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date("2026-01-01"); d.setDate(d.getDate() + i);
      const dow = d.getDay();
      const sold = (dow === 5 || dow === 6) ? 95 : (dow === 0 || dow === 1) ? 35 : 70;
      reports.push(mkReport(d.toISOString().slice(0, 10), "p1", { roomsSold: sold, adr: 120 }));
    }
    const r = rankRevenueOpportunities({ reports, history: reports, asOf: "2026-03-01", paceForecast: [], capacity: 100 });
    expect(r.status).toBe("ok");
    expect(r.summary.total).toBeGreaterThan(0);
  });
});

describe("runRevenueAI aggregator", () => {
  it("returns all major sub-modules", () => {
    const reports = seedReports(60).map(r => ({ ...r, propertyId: "p1" }));
    const state = { reports };
    const r = runRevenueAI({ state, propertyId: "p1", asOf: "2026-02-28", capacity: 100 });
    expect(r.unconstrainedDemand).toBeTruthy();
    expect(r.elasticity).toBeTruthy();
    expect(r.demandVolatility).toBeTruthy();
    expect(r.opportunities).toBeTruthy();
  });
});
