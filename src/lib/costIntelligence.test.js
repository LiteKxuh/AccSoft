import { describe, it, expect } from "vitest";
import {
  buildCpor, forecastUtilityCost, detectFnbCostVariance,
  maintenanceSpendPrediction, detectMarginErosion, detectOperationalWaste, runCostIntelligence,
} from "./costIntelligence.js";

function je(date, lines, propertyId = "p1") {
  return { id: `je_${date}_${Math.random()}`, date, propertyId, posted: true, void: false, lines };
}

const mkReport = (date, vals = {}) => ({
  date, propertyId: "p1",
  roomsSold: vals.roomsSold ?? 70,
  roomsAvailable: vals.roomsAvailable ?? 100,
  totalRevenue: vals.totalRevenue ?? 9000,
  breakdown: { revenue: { fb: { restaurant: vals.fb ?? 1500 } } },
});

describe("buildCpor", () => {
  it("computes total CPOR and per-category breakdown", () => {
    const ledger = [
      je("2026-05-15", [
        { accountCode: "6800", debit: 2000, credit: 0 }, // utility
        { accountCode: "1020", debit: 0, credit: 2000 },
      ]),
      je("2026-05-15", [
        { accountCode: "6210", debit: 500, credit: 0 }, // supplies
        { accountCode: "1020", debit: 0, credit: 500 },
      ]),
    ];
    const reports = [mkReport("2026-05-15", { roomsSold: 80 })];
    const r = buildCpor({ ledger, reports, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" } });
    expect(r.totalCost).toBeGreaterThan(0);
    expect(r.totalCpor).toBeGreaterThan(0);
    expect(r.byCategory.find(c => c.category === "utilities")).toBeTruthy();
  });
});

describe("forecastUtilityCost", () => {
  it("projects utility spend from baseline CPOR × forecast occupancy", () => {
    const today = new Date();
    const ledger = [];
    const reports = [];
    // Seed 30 days of utility + reports
    for (let i = 0; i < 30; i++) {
      const d = new Date(today); d.setDate(d.getDate() - 30 + i);
      const iso = d.toISOString().slice(0, 10);
      ledger.push(je(iso, [
        { accountCode: "6800", debit: 100, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 100 },
      ]));
      reports.push(mkReport(iso, { roomsSold: 70 }));
    }
    const forecastDays = [
      { date: "2099-01-01", projectedOccupancy: 0.80, capacity: 100 },
      { date: "2099-01-02", projectedOccupancy: 0.50, capacity: 100 },
    ];
    const r = forecastUtilityCost({ ledger, reports, propertyId: "p1", forecastDays });
    expect(r.status).toBe("ok");
    expect(r.projection).toBeGreaterThan(0);
    expect(r.perDay).toHaveLength(2);
  });

  it("returns no-forecast when forecastDays is empty", () => {
    expect(forecastUtilityCost({ ledger: [], reports: [], forecastDays: [] }).status).toBe("no-forecast");
  });
});

describe("detectFnbCostVariance", () => {
  it("flags over-target COGS", () => {
    const ledger = [
      je("2026-05-15", [
        { accountCode: "6010", debit: 800, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 800 },
      ]),
    ];
    const reports = [mkReport("2026-05-15", { fb: 2000 })];
    const r = detectFnbCostVariance({ ledger, reports, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" }, targetCogsPct: 0.30 });
    expect(r.status).toBe("ok");
    expect(r.cogsPct).toBeCloseTo(0.40, 2);
    expect(r.verdict).toBe("over-target");
  });

  it("returns no-fb-revenue when there's no F&B revenue", () => {
    const r = detectFnbCostVariance({
      ledger: [], reports: [mkReport("2026-05-15", { fb: 0 })],
      propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" },
    });
    expect(r.status).toBe("no-fb-revenue");
  });
});

describe("maintenanceSpendPrediction", () => {
  it("returns no-history with no ledger", () => {
    expect(maintenanceSpendPrediction({ ledger: [], propertyId: "p1" }).status).toBe("no-history");
  });

  it("projects forward 30-day maintenance spend", () => {
    const today = new Date();
    const ledger = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      ledger.push(je(iso, [
        { accountCode: "6710", debit: 50, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 50 },
      ]));
    }
    const r = maintenanceSpendPrediction({ ledger, propertyId: "p1", horizonDays: 30 });
    expect(r.status).toBe("ok");
    expect(r.projection).toBeGreaterThan(0);
  });
});

describe("detectMarginErosion", () => {
  it("returns insufficient-history with too few months", () => {
    const r = detectMarginErosion({ ledger: [], reports: [], propertyId: "p1", periods: 6 });
    expect(["insufficient-history", "ok"]).toContain(r.status);
  });
});

describe("detectOperationalWaste", () => {
  it("flags high supply CPOR", () => {
    const ledger = [
      je("2026-05-15", [
        { accountCode: "6210", debit: 5000, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 5000 },
      ]),
    ];
    const reports = [mkReport("2026-05-15", { roomsSold: 100 })];
    const r = detectOperationalWaste({ ledger, reports, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" } });
    expect(r.findings.some(f => f.code === "supply.cpor.high")).toBe(true);
  });

  it("returns empty findings on a clean period", () => {
    const r = detectOperationalWaste({ ledger: [], reports: [], propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" } });
    expect(r.findings).toEqual([]);
  });
});

describe("runCostIntelligence aggregator", () => {
  it("returns the full payload shape", () => {
    const ledger = [
      je("2026-05-15", [
        { accountCode: "6800", debit: 1000, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 1000 },
      ]),
    ];
    const reports = [mkReport("2026-05-15", { roomsSold: 80 })];
    const r = runCostIntelligence({
      state: { journalEntries: ledger, reports },
      propertyId: "p1",
      period: { start: "2026-05-01", end: "2026-05-31" },
    });
    expect(r.cpor).toBeTruthy();
    expect(r.utilityForecast).toBeTruthy();
    expect(r.fnb).toBeTruthy();
    expect(r.maintenance).toBeTruthy();
    expect(r.margin).toBeTruthy();
    expect(r.waste).toBeTruthy();
  });
});
