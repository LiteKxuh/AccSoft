import { describe, it, expect } from "vitest";
import { buildSegmentMix, detectShifts, isKnownSegment } from "./segmentMix.js";

const mkReport = (date, segments) => ({
  date,
  propertyId: "p1",
  totalRevenue: Object.values(segments).reduce((s, v) => s + (v.revenue || 0), 0),
  breakdown: { segments },
});

describe("buildSegmentMix", () => {
  it("aggregates revenue and computes share by segment", () => {
    const reports = [
      mkReport("2026-05-01", {
        transient: { revenue: 800, roomNights: 8 },
        group: { revenue: 200, roomNights: 2 },
      }),
      mkReport("2026-05-02", {
        transient: { revenue: 900, roomNights: 9 },
        group: { revenue: 100, roomNights: 1 },
      }),
    ];
    const m = buildSegmentMix({ reports, propertyId: "p1" });
    const transient = m.mix.find(s => s.segment === "transient");
    expect(transient.revenue).toBe(1700);
    expect(transient.share).toBeCloseTo(1700 / 2000, 5);
    expect(transient.adr).toBeCloseTo(1700 / 17, 1);
  });

  it("filters by date window", () => {
    const reports = [
      mkReport("2026-04-30", { transient: { revenue: 500, roomNights: 5 } }),
      mkReport("2026-05-01", { transient: { revenue: 800, roomNights: 8 } }),
    ];
    const m = buildSegmentMix({ reports, propertyId: "p1", start: "2026-05-01" });
    expect(m.totals.revenue).toBe(800);
  });

  it("returns coverage 0 when no reports have segments", () => {
    const reports = [{ date: "2026-05-01", propertyId: "p1", breakdown: {} }];
    const m = buildSegmentMix({ reports, propertyId: "p1" });
    expect(m.totals.revenue).toBe(0);
  });
});

describe("detectShifts", () => {
  it("flags shifts that exceed threshold", () => {
    const prior = [
      { segment: "transient", share: 0.5 },
      { segment: "group", share: 0.5 },
    ];
    const current = [
      { segment: "transient", share: 0.7 },
      { segment: "group", share: 0.3 },
    ];
    const shifts = detectShifts(current, prior, 0.05);
    expect(shifts.length).toBe(2);
    expect(Math.abs(shifts[0].deltaPts)).toBeCloseTo(0.2, 2);
  });

  it("catches segments that disappeared", () => {
    const prior = [{ segment: "ota", share: 0.20 }];
    const current = [{ segment: "transient", share: 1.0 }];
    const shifts = detectShifts(current, prior, 0.05);
    expect(shifts.find(s => s.segment === "ota")).toBeTruthy();
  });

  it("ignores shifts below threshold", () => {
    const prior = [{ segment: "transient", share: 0.50 }];
    const current = [{ segment: "transient", share: 0.52 }];
    expect(detectShifts(current, prior, 0.05)).toEqual([]);
  });
});

describe("isKnownSegment", () => {
  it("accepts standard segments", () => {
    expect(isKnownSegment("transient")).toBe(true);
    expect(isKnownSegment("OTA")).toBe(true);
  });
  it("rejects unknown", () => {
    expect(isKnownSegment("magic")).toBe(false);
  });
});
