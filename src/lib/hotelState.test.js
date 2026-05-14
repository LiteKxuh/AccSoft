import { describe, it, expect } from "vitest";
import { snapshot, portfolioSnapshot, overnightDelta } from "./hotelState.js";

const mkReport = (date, propertyId, vals = {}) => ({
  id: `r_${date}_${propertyId}`, date, propertyId,
  roomsAvailable: vals.roomsAvailable ?? 100,
  roomsSold: vals.roomsSold ?? 70,
  occupancy: (vals.roomsSold ?? 70) / 100,
  adr: vals.adr ?? 120,
  revpar: ((vals.roomsSold ?? 70) / 100) * (vals.adr ?? 120),
  roomRevenue: (vals.roomsSold ?? 70) * (vals.adr ?? 120),
  totalRevenue: vals.totalRevenue ?? ((vals.roomsSold ?? 70) * (vals.adr ?? 120) + 800),
  breakdown: {
    revenue: { rooms: (vals.roomsSold ?? 70) * (vals.adr ?? 120), fb: { restaurant: 800, bar: 0, banquet: 0 }, other: {} },
    taxes: {},
    payments: { cash: 0, creditCard: (vals.roomsSold ?? 70) * (vals.adr ?? 120) + 800, directBill: 0 },
  },
});

const seedReports = (days, propertyId) => {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(2026, 4, 1));
    d.setUTCDate(d.getUTCDate() + i);
    return mkReport(d.toISOString().slice(0, 10), propertyId);
  });
};

describe("snapshot", () => {
  it("returns missing-input on incomplete call", () => {
    expect(snapshot({}, {}).status).toBe("missing-input");
  });

  it("returns no-reports when there is no history", () => {
    expect(snapshot({ reports: [] }, { propertyId: "p1", asOf: "2026-05-01" }).status).toBe("no-reports");
  });

  it("classifies tier by median ADR", () => {
    const reports = Array.from({ length: 30 }, (_, i) =>
      mkReport(new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10), "p1", { adr: 140 })
    );
    const s = snapshot({ reports }, { propertyId: "p1", asOf: "2026-05-01" });
    expect(s.tier).toBe("upscale");
  });

  it("computes MTD revenue and occupancy", () => {
    const reports = seedReports(10, "p1");
    const s = snapshot({ reports }, { propertyId: "p1", asOf: "2026-05-10" });
    expect(s.mtd.revenue).toBeGreaterThan(0);
    expect(s.mtd.occupancy).toBeCloseTo(0.70, 5);
  });

  it("flags coverage gaps", () => {
    const reports = seedReports(10, "p1");
    const s = snapshot({ reports }, { propertyId: "p1", asOf: "2026-05-10" });
    expect(s.coverage.hasBudget).toBe(false);
    expect(s.coverage.hasOwnership).toBe(false);
  });

  it("surfaces risk flags for high labor + AP over 120", () => {
    const reports = seedReports(30, "p1");
    // High labor: $30k cost with $20k MTD revenue → 150%
    const shifts = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`, propertyId: "p1", employeeId: "e1",
      clockIn: new Date(Date.UTC(2026, 4, 1 + i, 8)).toISOString(),
      clockOut: new Date(Date.UTC(2026, 4, 1 + i, 20)).toISOString(),
      payRate: 50,
    }));
    const invoices = [{
      id: "i1", propertyId: "p1", vendorId: "v1", amount: 1000,
      issuedDate: "2026-01-01", dueDate: "2026-01-15",
      status: "open", approvalState: "approved",
    }];
    const s = snapshot({ reports, shifts, invoices, vendors: [{ id: "v1", name: "X" }] }, { propertyId: "p1", asOf: "2026-05-30" });
    expect(s.riskFlags.some(f => f.code === "ap.over120")).toBe(true);
  });
});

describe("portfolioSnapshot", () => {
  it("returns one snapshot per property", () => {
    const reports = [
      ...seedReports(10, "p1"),
      ...seedReports(10, "p2"),
    ];
    const snaps = portfolioSnapshot({ reports }, { propertyIds: ["p1", "p2"], asOf: "2026-05-10" });
    expect(snaps).toHaveLength(2);
    expect(snaps[0].propertyId).toBe("p1");
    expect(snaps[1].propertyId).toBe("p2");
  });
});

describe("overnightDelta", () => {
  it("returns insufficient-history when either snapshot is incomplete", () => {
    const reports = [mkReport("2026-05-01", "p1")];
    const r = overnightDelta({ reports }, { propertyId: "p1", asOf: "2026-05-01" });
    expect(r.status).toBe("insufficient-history");
  });

  it("computes the day-over-day deltas", () => {
    const reports = seedReports(30, "p1").map((r, i) => i === 29 ? mkReport(r.date, "p1", { roomsSold: 90, adr: 120 }) : r);
    const r = overnightDelta({ reports }, { propertyId: "p1", asOf: "2026-05-30" });
    expect(r.status).toBe("ok");
    expect(r.delta.revenue).toBeGreaterThan(0);
  });
});
