import { describe, it, expect } from "vitest";
import { portfolioKPIs } from "./portfolio.js";

function mkReport(date, propertyId, vals = {}) {
  return {
    date,
    propertyId,
    roomsSold: vals.roomsSold ?? 70,
    roomsAvailable: vals.roomsAvailable ?? 100,
    roomRevenue: vals.roomRevenue ?? 7000,
    totalRevenue: vals.totalRevenue ?? 8000,
  };
}

describe("portfolioKPIs", () => {
  it("rolls up rooms sold + revenue across properties", () => {
    const state = {
      reports: [
        mkReport("2026-05-01", "p1", { roomsSold: 70, roomsAvailable: 100, roomRevenue: 7000 }),
        mkReport("2026-05-01", "p2", { roomsSold: 50, roomsAvailable: 80, roomRevenue: 5000 }),
      ],
    };
    const k = portfolioKPIs({
      state,
      propertyIds: ["p1", "p2"],
      periodStart: "2026-05-01",
      periodEnd: "2026-05-01",
    });
    expect(k.properties).toBe(2);
    expect(k.roomsSold).toBe(120);
    expect(k.roomsAvailable).toBe(180);
    expect(k.occupancy).toBeCloseTo(120 / 180, 5);
    expect(k.adr).toBeCloseTo(12000 / 120, 1);
  });

  it("filters by date range", () => {
    const state = {
      reports: [
        mkReport("2026-04-30", "p1", { roomsSold: 50, roomRevenue: 5000 }),
        mkReport("2026-05-01", "p1", { roomsSold: 70, roomRevenue: 7000 }),
        mkReport("2026-05-02", "p1", { roomsSold: 80, roomRevenue: 8000 }),
        mkReport("2026-05-03", "p1", { roomsSold: 60, roomRevenue: 6000 }),
      ],
    };
    const k = portfolioKPIs({
      state,
      propertyIds: ["p1"],
      periodStart: "2026-05-01",
      periodEnd: "2026-05-02",
    });
    expect(k.reportCount).toBe(2);
    expect(k.roomsSold).toBe(150);
  });

  it("does not include reports for unlisted properties", () => {
    const state = {
      reports: [
        mkReport("2026-05-01", "p1", { roomsSold: 70 }),
        mkReport("2026-05-01", "p2", { roomsSold: 50 }),
      ],
    };
    const k = portfolioKPIs({
      state,
      propertyIds: ["p1"],
      periodStart: "2026-05-01",
      periodEnd: "2026-05-01",
    });
    expect(k.roomsSold).toBe(70);
  });

  it("returns zero KPIs when no reports match", () => {
    const state = { reports: [] };
    const k = portfolioKPIs({
      state,
      propertyIds: ["p1", "p2"],
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
    });
    expect(k.roomsSold).toBe(0);
    expect(k.occupancy).toBe(0);
    expect(k.adr).toBe(0);
  });
});
