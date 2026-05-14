import { describe, it, expect } from "vitest";
import { buildFlash, buildForecastVariance } from "./flashReport.js";

const mkReport = (date, propertyId, vals = {}) => ({
  id: `r_${date}_${propertyId}`,
  date,
  propertyId,
  roomsAvailable: 100,
  roomsSold: vals.roomsSold ?? 70,
  occupancy: (vals.roomsSold ?? 70) / 100,
  adr: vals.adr ?? 120,
  revpar: ((vals.roomsSold ?? 70) / 100) * (vals.adr ?? 120),
  totalRevenue: vals.totalRevenue ?? ((vals.roomsSold ?? 70) * (vals.adr ?? 120)),
  breakdown: {
    revenue: {
      rooms: (vals.roomsSold ?? 70) * (vals.adr ?? 120),
      fb: { restaurant: vals.restaurant ?? 0, banquet: 0, bar: 0 },
      other: { parking: 0, spa: 0, telephone: 0, misc: 0 },
    },
    taxes: { occupancy: 0, sales: 0, tourism: 0 },
  },
});

describe("buildFlash", () => {
  it("returns missing when there is no report for the asOf date", () => {
    const state = { reports: [mkReport("2026-05-01", "p1")] };
    const f = buildFlash(state, { propertyId: "p1", asOf: "2026-05-10" });
    expect(f.missing).toBe(true);
  });

  it("computes MTD and pace", () => {
    const reports = [
      mkReport("2026-05-01", "p1", { totalRevenue: 1000 }),
      mkReport("2026-05-02", "p1", { totalRevenue: 1200 }),
      mkReport("2026-05-03", "p1", { totalRevenue: 1100 }),
    ];
    const f = buildFlash({ reports }, { propertyId: "p1", asOf: "2026-05-03" });
    expect(f.mtd.revenue).toBeCloseTo(3300, 1);
    expect(f.mtd.days).toBe(3);
    expect(f.pace.daysElapsed).toBe(3);
    expect(f.pace.dailyAvg).toBeCloseTo(1100, 1);
    expect(f.pace.projection).toBeCloseTo(1100 * 31, 1); // May has 31 days
  });

  it("computes vs prior day delta", () => {
    const reports = [
      mkReport("2026-05-01", "p1", { totalRevenue: 1000 }),
      mkReport("2026-05-02", "p1", { totalRevenue: 1200 }),
    ];
    const f = buildFlash({ reports }, { propertyId: "p1", asOf: "2026-05-02" });
    expect(f.vs.prior.revenue.abs).toBe(200);
    expect(f.vs.prior.revenue.pct).toBeCloseTo(0.2, 5);
  });

  it("flags budget variance on track at 5%", () => {
    const reports = [];
    for (let d = 1; d <= 10; d++) {
      reports.push(mkReport(`2026-05-${String(d).padStart(2, "0")}`, "p1", { totalRevenue: 1000 }));
    }
    const f = buildFlash({ reports }, {
      propertyId: "p1",
      asOf: "2026-05-10",
      budget: { monthlyRevenue: 31_000 },
    });
    expect(f.budget.onTrack).toBe(true);
    expect(Math.abs(f.budget.variancePct)).toBeLessThan(0.05);
  });

  it("computes labor % of revenue when labor passed in", () => {
    const reports = [
      mkReport("2026-05-01", "p1", { totalRevenue: 1000 }),
      mkReport("2026-05-02", "p1", { totalRevenue: 1000 }),
    ];
    const f = buildFlash({ reports }, {
      propertyId: "p1", asOf: "2026-05-02",
      labor: { mtdCost: 600, todayCost: 300 },
    });
    expect(f.labor.mtdPctOfRev).toBeCloseTo(0.3, 5);
  });

  it("does not crash when roomsAvailable is 0", () => {
    const reports = [{ ...mkReport("2026-05-01", "p1"), roomsAvailable: 0, roomsSold: 0, occupancy: 0 }];
    const f = buildFlash({ reports }, { propertyId: "p1", asOf: "2026-05-01" });
    expect(f.today.occupancy).toBe(0);
    expect(f.mtd.occupancy).toBe(0);
  });
});

describe("buildForecastVariance", () => {
  it("buckets variance correctly", () => {
    const reports = [
      mkReport("2026-05-01", "p1", { totalRevenue: 1050 }),  // +5%
      mkReport("2026-05-02", "p1", { totalRevenue: 1200 }),  // +20%
      mkReport("2026-05-03", "p1", { totalRevenue:  850 }),  // -15%
      mkReport("2026-05-04", "p1", { totalRevenue: 1010 }),  // on-target
    ];
    const forecast = [
      { date: "2026-05-01", totalRevenue: 1000 },
      { date: "2026-05-02", totalRevenue: 1000 },
      { date: "2026-05-03", totalRevenue: 1000 },
      { date: "2026-05-04", totalRevenue: 1000 },
    ];
    const out = buildForecastVariance({ reports, forecast, propertyId: "p1", start: "2026-05-01", end: "2026-05-04" });
    const buckets = out.lines.map(l => l.bucket);
    expect(buckets).toContain("on-target");
    expect(buckets).toContain("favorable");
    expect(buckets).toContain("strong-beat");
    expect(buckets).toContain("miss");
  });

  it("returns no-forecast for missing forecast points", () => {
    const reports = [mkReport("2026-05-01", "p1", { totalRevenue: 1000 })];
    const out = buildForecastVariance({ reports, forecast: [], propertyId: "p1", start: "2026-05-01", end: "2026-05-01" });
    expect(out.lines[0].bucket).toBe("no-forecast");
  });

  it("computes MAPE", () => {
    const reports = [
      mkReport("2026-05-01", "p1", { totalRevenue: 1100 }),
      mkReport("2026-05-02", "p1", { totalRevenue:  900 }),
    ];
    const forecast = [
      { date: "2026-05-01", totalRevenue: 1000 },
      { date: "2026-05-02", totalRevenue: 1000 },
    ];
    const out = buildForecastVariance({ reports, forecast, propertyId: "p1", start: "2026-05-01", end: "2026-05-02" });
    expect(out.summary.mape).toBeCloseTo(0.10, 5);
  });
});
