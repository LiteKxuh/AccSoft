import { describe, it, expect } from "vitest";
import { inputsFromReport, inputsFromReports, dailyKpis, periodKpis } from "./reportAdapter.js";

const mkReport = (date, vals = {}) => ({
  date, propertyId: "p1",
  roomsAvailable: vals.roomsAvailable ?? 100,
  roomsSold: vals.roomsSold ?? 70,
  totalRevenue: vals.totalRevenue ?? 9000,
  breakdown: {
    revenue: {
      rooms: (vals.roomsSold ?? 70) * (vals.adr ?? 120),
      fb: { restaurant: 500, bar: 100 },
      other: { parking: 100 },
    },
  },
});

describe("inputsFromReport", () => {
  it("extracts the standard input set", () => {
    const r = mkReport("2026-05-15");
    const inputs = inputsFromReport(r);
    expect(inputs.roomsSold).toBe(70);
    expect(inputs.roomRevenue).toBe(8400);
    expect(inputs.fbRevenue).toBe(600);
    expect(inputs.otherRevenue).toBe(100);
  });

  it("falls back to top-level roomRevenue when breakdown missing", () => {
    const r = { date: "2026-05-15", roomsSold: 50, roomsAvailable: 100, roomRevenue: 6000, totalRevenue: 6500 };
    const inputs = inputsFromReport(r);
    expect(inputs.roomRevenue).toBe(6000);
  });
});

describe("inputsFromReports — aggregation", () => {
  it("sums across reports", () => {
    const reports = [
      mkReport("2026-05-01", { roomsSold: 60 }),
      mkReport("2026-05-02", { roomsSold: 80 }),
    ];
    const inputs = inputsFromReports(reports);
    expect(inputs.roomsSold).toBe(140);
    expect(inputs.roomsAvailable).toBe(200);
  });
});

describe("dailyKpis", () => {
  it("returns ADR/Occupancy/RevPAR/RevPOR for a single day", () => {
    const r = mkReport("2026-05-15", { roomsSold: 80, adr: 130 });
    r.breakdown.revenue.rooms = 80 * 130;
    const k = dailyKpis(r);
    expect(k.occupancy.value).toBe(0.8);
    expect(k.adr.value).toBe(130);
    expect(k.revpar.value).toBe(104);
  });
});

describe("periodKpis", () => {
  it("rolls up multi-day inputs", () => {
    const reports = [
      mkReport("2026-05-01"),
      mkReport("2026-05-02"),
      mkReport("2026-05-03"),
    ];
    const all = periodKpis(reports, { laborCost: 9000, gop: 12000, noi: 9000, totalCost: 15000 });
    expect(all.occupancy.value).toBeCloseTo(0.7, 5);
    expect(all["labor.pctRev"].value).toBeCloseTo(9000 / 27000, 5);
  });
});
