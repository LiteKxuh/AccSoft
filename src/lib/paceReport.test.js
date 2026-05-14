import { describe, it, expect } from "vitest";
import { buildPace } from "./paceReport.js";

const mkReport = (date, overrides = {}) => ({
  date,
  propertyId: "p1",
  roomsAvailable: 100,
  roomsSold: overrides.roomsSold ?? 70,
  occupancy: (overrides.roomsSold ?? 70) / 100,
  adr: overrides.adr ?? 120,
  roomRevenue: (overrides.roomsSold ?? 70) * (overrides.adr ?? 120),
  totalRevenue: ((overrides.roomsSold ?? 70) * (overrides.adr ?? 120)) + (overrides.fb ?? 200),
  breakdown: {
    revenue: { rooms: (overrides.roomsSold ?? 70) * (overrides.adr ?? 120), fb: {}, other: {} },
  },
});

function history(daysBack, fn) {
  return Array.from({ length: daysBack }, (_, i) => {
    const d = new Date(Date.UTC(2026, 3, 1)); d.setDate(d.getDate() + i);
    return fn(d.toISOString().slice(0, 10), i);
  });
}

describe("buildPace", () => {
  it("returns insufficient-history when < 14 days", () => {
    const reports = history(7, (d) => mkReport(d));
    const r = buildPace({ reports, asOf: "2026-04-15" });
    expect(r.status).toBe("insufficient-history");
  });

  it("classifies economy market by median ADR", () => {
    const reports = history(30, (d) => mkReport(d, { adr: 60 }));
    const r = buildPace({ reports, asOf: "2026-04-30" });
    expect(r.market.tier).toBe("economy");
  });

  it("classifies upscale market by median ADR", () => {
    const reports = history(30, (d) => mkReport(d, { adr: 140 }));
    const r = buildPace({ reports, asOf: "2026-04-30" });
    expect(r.market.tier).toBe("upscale");
  });

  it("forward projections never exceed market occupancy cap", () => {
    // Force every report to look like 99% occupancy
    const reports = history(30, (d) => mkReport(d, { roomsSold: 99 }));
    const r = buildPace({ reports, asOf: "2026-04-30", options: { horizon: 14 } });
    for (const p of r.forward) {
      expect(p.projectedOccupancy).toBeLessThanOrEqual(r.market.occCap);
    }
  });

  it("computes MTD revenue, rooms-sold and occupancy", () => {
    const reports = history(30, (d) => mkReport(d, { roomsSold: 80, adr: 100 }));
    const r = buildPace({ reports, asOf: "2026-04-30", options: { horizon: 7 } });
    expect(r.mtd.daysElapsed).toBe(30);
    expect(r.mtd.revenue).toBeGreaterThan(0);
    expect(r.mtd.occupancy).toBeCloseTo(0.80, 5);
  });

  it("computes prior-year growth when PY reports provided", () => {
    const reports = history(30, (d) => mkReport(d, { roomsSold: 80, adr: 100 }));
    const py = reports.map(r => ({
      ...r,
      date: r.date.replace("2026", "2025"),
      totalRevenue: r.totalRevenue / 2,  // half of the current year
      roomsSold: 40,
    }));
    const r = buildPace({ reports, asOf: "2026-04-30", priorYear: py });
    expect(r.priorYear).not.toBeNull();
    expect(r.priorYear.revGrowth).toBeCloseTo(1, 1); // doubled
  });

  it("wash factor stays within market cap", () => {
    const reports = history(30, (d) => mkReport(d, { roomsSold: 60 }));
    // Pretend the property was originally booked at 100% but only realized 60%:
    const bookings = reports.map(r => {
      const stayDate = r.date;
      const snapshotDate = (() => {
        const d = new Date(stayDate); d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      })();
      return { stayDate, snapshotDate, roomsOnBooks: 100 };
    });
    const r = buildPace({ reports, asOf: "2026-04-30", bookings });
    if (r.washFactor != null) {
      expect(r.washFactor).toBeLessThanOrEqual(r.market.washCap);
    }
  });
});
