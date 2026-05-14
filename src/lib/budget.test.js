import { describe, it, expect } from "vitest";
import { monthOf, emptyBudget, actualsFor, budgetTotal, pacing, autoSeedBudgets } from "./budget.js";

const mkReport = (date, propertyId, vals = {}) => ({
  id: `r_${date}_${propertyId}`,
  date,
  propertyId,
  roomRevenue: vals.roomRevenue ?? 1000,
  roomsSold: vals.roomsSold ?? 50,
  roomsAvailable: vals.roomsAvailable ?? 100,
  occupancy: (vals.roomsSold ?? 50) / (vals.roomsAvailable ?? 100),
  adr: (vals.roomRevenue ?? 1000) / (vals.roomsSold ?? 50),
  totalRevenue: vals.totalRevenue ?? 1200,
  breakdown: {
    revenue: {
      rooms: vals.roomRevenue ?? 1000,
      fb: { restaurant: vals.restaurant ?? 100, bar: 50, banquet: 0 },
      other: { parking: 30, spa: 0, telephone: 0, misc: 20 },
    },
    taxes: { occupancy: 50, sales: 30, tourism: 10 },
    rooms: { sold: vals.roomsSold ?? 50, available: vals.roomsAvailable ?? 100 },
  },
});

describe("monthOf", () => {
  it("extracts YYYY-MM", () => {
    expect(monthOf("2026-05-14")).toBe("2026-05");
  });
  it("handles bad input", () => {
    expect(monthOf(null)).toBe("");
    expect(monthOf(undefined)).toBe("");
  });
});

describe("emptyBudget", () => {
  it("returns a fully-shaped budget", () => {
    const b = emptyBudget("p1", "2026-05");
    expect(b.id).toBe("b_p1_2026-05");
    expect(b.rooms.revenue).toBe(0);
    expect(b.fb.restaurant).toBe(0);
    expect(b.taxes.occupancy).toBe(0);
  });
});

describe("actualsFor", () => {
  it("aggregates a month of reports for a property", () => {
    const reports = [
      mkReport("2026-05-01", "p1"),
      mkReport("2026-05-02", "p1"),
      mkReport("2026-05-03", "p2"),  // different property
      mkReport("2026-04-30", "p1"),  // different month
    ];
    const a = actualsFor(reports, "p1", "2026-05");
    expect(a.days).toBe(2);
    expect(a.rooms.revenue).toBe(2000);
    expect(a.totalRevenue).toBe(2400);
  });

  it("returns null when no reports match", () => {
    expect(actualsFor([], "p1", "2026-05")).toBeNull();
  });

  it("computes occupancy and ADR from rolled-up rooms", () => {
    const reports = [
      mkReport("2026-05-01", "p1", { roomsSold: 70, roomRevenue: 8400 }),
      mkReport("2026-05-02", "p1", { roomsSold: 60, roomRevenue: 7200 }),
    ];
    const a = actualsFor(reports, "p1", "2026-05");
    expect(a.rooms.occupancy).toBeCloseTo((70 + 60) / 200, 5);
    expect(a.rooms.adr).toBeCloseTo((8400 + 7200) / (70 + 60), 1);
  });
});

describe("budgetTotal", () => {
  it("sums all revenue lines", () => {
    const b = emptyBudget("p1", "2026-05");
    b.rooms.revenue = 30000;
    b.fb.restaurant = 5000;
    b.other.parking = 2000;
    expect(budgetTotal(b)).toBe(37000);
  });

  it("returns 0 for null", () => {
    expect(budgetTotal(null)).toBe(0);
  });
});

describe("pacing", () => {
  it("returns proportional expected-to-date", () => {
    const b = emptyBudget("p1", "2026-05");
    b.rooms.revenue = 31000;  // $1000/day for May (31 days)
    const actual = { totalRevenue: 5000 };
    const p = pacing(actual, b, "2026-05-05");
    expect(p.daysInMonth).toBe(31);
    expect(p.dayInMonth).toBe(5);
    expect(p.expectedToDate).toBeCloseTo(31000 * (5 / 31), 1);
    expect(p.variance).toBeCloseTo(5000 - 5000, 1);
  });

  it("returns null without budget", () => {
    expect(pacing({}, null, "2026-05-05")).toBeNull();
  });

  it("returns null when budget total is 0", () => {
    expect(pacing({ totalRevenue: 100 }, emptyBudget("p1", "2026-05"), "2026-05-05")).toBeNull();
  });
});

describe("autoSeedBudgets", () => {
  it("does not seed for properties with no reports", () => {
    const result = autoSeedBudgets([{ id: "p1" }], [], 0.06, 3);
    expect(result).toEqual([]);
  });

  it("produces 3 monthly budgets per property with reports", () => {
    const reports = Array.from({ length: 30 }, (_, i) => mkReport(
      `2026-04-${String(i + 1).padStart(2, "0")}`,
      "p1",
      { roomRevenue: 1000 }
    ));
    const seeded = autoSeedBudgets([{ id: "p1" }], reports, 0.06, 3);
    expect(seeded.length).toBe(3);
    expect(seeded[0].autoSeeded).toBe(true);
    expect(seeded[0].rooms.revenue).toBeGreaterThan(28_000);
  });

  it("caps occupancy at 95% even with high growth", () => {
    const reports = Array.from({ length: 5 }, (_, i) => mkReport(
      `2026-04-${String(i + 1).padStart(2, "0")}`,
      "p1",
      { roomsSold: 95, roomsAvailable: 100 }
    ));
    const seeded = autoSeedBudgets([{ id: "p1" }], reports, 0.20, 1);
    expect(seeded[0].rooms.occupancy).toBeLessThanOrEqual(0.95);
  });
});
