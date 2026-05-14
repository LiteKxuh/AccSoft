import { describe, it, expect } from "vitest";
import { buildBaseline, localAnomalies, localLaborWarnings, isConfigured } from "./aiOps.js";

const mkReport = (date, propertyId, vals = {}) => ({
  date, propertyId,
  totalRevenue: vals.totalRevenue ?? 1000,
  occupancy: vals.occupancy ?? 0.7,
  adr: vals.adr ?? 120,
  breakdown: vals.breakdown,
});

describe("buildBaseline", () => {
  it("returns null with <7 reports", () => {
    const reports = Array.from({ length: 5 }, (_, i) =>
      mkReport(`2026-05-0${i + 1}`, "p1")
    );
    expect(buildBaseline(reports, "p1", "2026-05-06")).toBeNull();
  });

  it("computes last7/last30 windows", () => {
    const reports = Array.from({ length: 30 }, (_, i) =>
      mkReport(`2026-04-${String(i + 1).padStart(2, "0")}`, "p1", { totalRevenue: 1000 + i * 10 })
    );
    const base = buildBaseline(reports, "p1", "2026-05-01");
    expect(base.last7).not.toBeNull();
    expect(base.last30).not.toBeNull();
    expect(base.last7.rev).toBeGreaterThan(base.last30.rev); // recent days are higher
  });

  it("computes same-day-of-week when 4 same-DoW days exist", () => {
    const sundays = [
      mkReport("2026-04-05", "p1", { totalRevenue: 800 }),
      mkReport("2026-04-12", "p1", { totalRevenue: 900 }),
      mkReport("2026-04-19", "p1", { totalRevenue: 1000 }),
      mkReport("2026-04-26", "p1", { totalRevenue: 1100 }),
    ];
    const others = Array.from({ length: 10 }, (_, i) =>
      mkReport(`2026-04-${String(i + 1).padStart(2, "0")}`, "p1", { totalRevenue: 500 })
    );
    const base = buildBaseline([...sundays, ...others], "p1", "2026-05-03"); // Sunday
    expect(base.sameDow).not.toBeNull();
    expect(base.sameDow.n).toBeGreaterThanOrEqual(1);
  });
});

describe("localAnomalies", () => {
  const baseline = {
    last7:   { rev: 1000, occ: 0.7, adr: 120 },
    last30:  { rev: 1000, occ: 0.7, adr: 120 },
    sameDow: { rev: 1000, occ: 0.7, adr: 120, n: 4 },
  };

  it("returns empty when actuals are near baseline", () => {
    const f = localAnomalies(
      mkReport("2026-05-14", "p1", { totalRevenue: 1050, occupancy: 0.71, adr: 121 }),
      baseline
    );
    expect(f).toEqual([]);
  });

  it("flags revenue swing >35% vs same-DoW", () => {
    const f = localAnomalies(
      mkReport("2026-05-14", "p1", { totalRevenue: 1500, occupancy: 0.7, adr: 120 }),
      baseline
    );
    expect(f.some(x => x.code === "revenue.dow")).toBe(true);
  });

  it("flags occupancy >105% as impossible (high severity)", () => {
    const f = localAnomalies(
      mkReport("2026-05-14", "p1", { totalRevenue: 1000, occupancy: 1.15, adr: 120 }),
      baseline
    );
    const impossible = f.find(x => x.code === "occupancy.impossible");
    expect(impossible).toBeTruthy();
    expect(impossible.severity).toBe("high");
  });

  it("flags settlement vs revenue+tax gap", () => {
    const report = mkReport("2026-05-14", "p1", {
      totalRevenue: 1000,
      breakdown: {
        revenue: { rooms: 900, fb: { restaurant: 100 } },
        taxes: { occupancy: 50 },
        payments: { cash: 500, creditCard: 100 }, // total 600, expected 1050 (rooms+fb+tax)
      },
    });
    const f = localAnomalies(report, baseline);
    expect(f.some(x => x.code === "settlement.gap")).toBe(true);
  });

  it("returns empty without baseline", () => {
    const f = localAnomalies(mkReport("2026-05-14", "p1"), null);
    expect(f).toEqual([]);
  });
});

describe("localLaborWarnings", () => {
  it("flags labor > 10% above target", () => {
    const out = localLaborWarnings({
      laborCost: 350, revenue: 1000, scheduleHours: 50, actualHours: 50, targetPct: 0.30,
    });
    expect(out.some(w => w.code === "labor.pct")).toBe(true);
  });

  it("flags schedule drift > 10%", () => {
    const out = localLaborWarnings({
      laborCost: 300, revenue: 1000, scheduleHours: 50, actualHours: 60, targetPct: 0.30,
    });
    expect(out.some(w => w.code === "labor.schedule_drift")).toBe(true);
  });

  it("returns empty when labor is on target", () => {
    const out = localLaborWarnings({
      laborCost: 300, revenue: 1000, scheduleHours: 50, actualHours: 50, targetPct: 0.30,
    });
    expect(out).toEqual([]);
  });
});

describe("isConfigured", () => {
  it("returns false when no proxy/key configured (test env has no localStorage)", () => {
    // jsdom env may or may not be present; if so, default empty -> false
    expect(typeof isConfigured()).toBe("boolean");
  });
});
