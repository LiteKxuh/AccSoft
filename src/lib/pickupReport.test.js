import { describe, it, expect } from "vitest";
import { pickupReport, pickupCurve } from "./pickupReport.js";

const snap = (snapshotDate, stayDate, rooms, revenue = 0) => ({
  snapshotDate, stayDate, propertyId: "p1", roomsOnBooks: rooms, revenueOnBooks: revenue,
});

describe("pickupReport", () => {
  it("requires inputs", () => {
    expect(pickupReport({}).status).toBe("missing-input");
  });

  it("computes per-stay-date rooms and revenue pickup", () => {
    const snapshots = [
      snap("2026-05-01", "2026-05-15", 40, 4800),
      snap("2026-05-08", "2026-05-15", 60, 7200),
      snap("2026-05-01", "2026-05-20", 30, 3600),
      snap("2026-05-08", "2026-05-20", 50, 6000),
    ];
    const r = pickupReport({ snapshots, propertyId: "p1", asOf: "2026-05-08", compareDate: "2026-05-01" });
    expect(r.status).toBe("ok");
    expect(r.rows).toHaveLength(2);
    const may15 = r.rows.find(x => x.stayDate === "2026-05-15");
    expect(may15.roomsPickup).toBe(20);
    expect(may15.revenuePickup).toBe(2400);
    expect(may15.adrImplied).toBeCloseTo(120, 0);
  });

  it("filters by property", () => {
    const snapshots = [
      snap("2026-05-01", "2026-05-15", 40),
      { ...snap("2026-05-08", "2026-05-15", 60), propertyId: "p2" },
    ];
    const r = pickupReport({ snapshots, propertyId: "p1", asOf: "2026-05-08", compareDate: "2026-05-01" });
    // Only p1 → asOf snapshot is missing → roomsAsOf=0, roomsCompare=40 → pickup -40
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].roomsPickup).toBe(-40);
  });

  it("returns no-snapshots when property has none", () => {
    const r = pickupReport({ snapshots: [], propertyId: "p1", asOf: "2026-05-08", compareDate: "2026-05-01" });
    expect(r.status).toBe("no-snapshots");
  });

  it("totals rooms + revenue pickup across all stay dates", () => {
    const snapshots = [
      snap("2026-05-01", "2026-05-15", 40, 4800),
      snap("2026-05-08", "2026-05-15", 60, 7200),
      snap("2026-05-01", "2026-05-16", 30, 3600),
      snap("2026-05-08", "2026-05-16", 60, 7200),
    ];
    const r = pickupReport({ snapshots, propertyId: "p1", asOf: "2026-05-08", compareDate: "2026-05-01" });
    expect(r.totals.roomsPickup).toBe(50);
    expect(r.totals.revenuePickup).toBe(6000);
  });

  it("range filter narrows to stay dates", () => {
    const snapshots = [
      snap("2026-05-01", "2026-05-15", 40),
      snap("2026-05-08", "2026-05-15", 60),
      snap("2026-05-01", "2026-06-15", 30),
      snap("2026-05-08", "2026-06-15", 50),
    ];
    const r = pickupReport({
      snapshots, propertyId: "p1",
      asOf: "2026-05-08", compareDate: "2026-05-01",
      range: { start: "2026-05-01", end: "2026-05-31" },
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].stayDate).toBe("2026-05-15");
  });
});

describe("pickupCurve", () => {
  it("returns a time series sorted by snapshot date", () => {
    const snapshots = [
      snap("2026-05-08", "2026-05-15", 60),
      snap("2026-05-01", "2026-05-15", 40),
      snap("2026-05-04", "2026-05-15", 50),
    ];
    const c = pickupCurve({ snapshots, propertyId: "p1", stayDate: "2026-05-15" });
    expect(c.status).toBe("ok");
    expect(c.points.map(p => p.roomsOnBooks)).toEqual([40, 50, 60]);
  });
});
