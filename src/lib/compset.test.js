import { describe, it, expect } from "vitest";
import { computeCompsetIndices, classifyTier } from "./compset.js";

const mkReport = (date, vals = {}) => ({
  date, propertyId: "p1",
  occupancy: vals.occupancy ?? 0.70,
  adr: vals.adr ?? 120,
  revpar: (vals.occupancy ?? 0.70) * (vals.adr ?? 120),
});

const mkSnap = (date, vals = {}) => ({
  date, propertyId: "p1",
  compsetOcc: vals.compsetOcc ?? 0.70,
  compsetAdr: vals.compsetAdr ?? 130,
  compsetRevpar: (vals.compsetOcc ?? 0.70) * (vals.compsetAdr ?? 130),
});

describe("classifyTier", () => {
  it("returns the right tier by ADR", () => {
    expect(classifyTier(50)).toBe("economy");
    expect(classifyTier(85)).toBe("midscale");
    expect(classifyTier(140)).toBe("upscale");
    expect(classifyTier(200)).toBe("upper-upscale");
    expect(classifyTier(300)).toBe("luxury");
  });
});

describe("computeCompsetIndices", () => {
  it("returns no-compset when snapshots missing", () => {
    const r = computeCompsetIndices({ snapshots: [], reports: [mkReport("2026-05-01")], propertyId: "p1", start: "2026-05-01", end: "2026-05-31" });
    expect(r.status).toBe("no-compset");
  });

  it("returns no-reports when reports missing", () => {
    const r = computeCompsetIndices({ snapshots: [mkSnap("2026-05-01")], reports: [], propertyId: "p1", start: "2026-05-01", end: "2026-05-31" });
    expect(r.status).toBe("no-reports");
  });

  it("computes OCC / ADR / RevPAR indices on matching dates", () => {
    const reports = [
      mkReport("2026-05-01", { occupancy: 0.80, adr: 130 }),
      mkReport("2026-05-02", { occupancy: 0.70, adr: 125 }),
    ];
    const snapshots = [
      mkSnap("2026-05-01", { compsetOcc: 0.75, compsetAdr: 120 }),
      mkSnap("2026-05-02", { compsetOcc: 0.70, compsetAdr: 120 }),
    ];
    const r = computeCompsetIndices({ snapshots, reports, propertyId: "p1", start: "2026-05-01", end: "2026-05-31" });
    expect(r.status).toBe("ok");
    expect(r.lines).toHaveLength(2);
    // Day 1: 0.80/0.75 = 1.0667
    expect(r.lines[0].occIndex).toBeCloseTo((0.80 / 0.75) * 100, 1);
    expect(r.lines[0].adrIndex).toBeCloseTo((130 / 120) * 100, 1);
  });

  it("refuses when compset tier is mismatched with property tier", () => {
    const reports = Array.from({ length: 5 }, (_, i) => mkReport(`2026-05-0${i + 1}`, { adr: 60 }));   // economy
    const snapshots = Array.from({ length: 5 }, (_, i) => mkSnap(`2026-05-0${i + 1}`, { compsetAdr: 350 })); // luxury
    const r = computeCompsetIndices({ snapshots, reports, propertyId: "p1", start: "2026-05-01", end: "2026-05-31" });
    expect(r.status).toBe("tier-mismatch");
  });

  it("returns no-overlap when reports and snapshots don't share dates", () => {
    const reports = [mkReport("2026-05-01")];
    const snapshots = [mkSnap("2026-05-15")];
    const r = computeCompsetIndices({ snapshots, reports, propertyId: "p1", start: "2026-05-01", end: "2026-05-31" });
    expect(r.status).toBe("no-overlap");
  });

  it("averages indices over the window", () => {
    const reports = [
      mkReport("2026-05-01", { occupancy: 0.80, adr: 130 }),
      mkReport("2026-05-02", { occupancy: 0.70, adr: 125 }),
    ];
    const snapshots = [
      mkSnap("2026-05-01", { compsetOcc: 0.75, compsetAdr: 120 }),
      mkSnap("2026-05-02", { compsetOcc: 0.70, compsetAdr: 120 }),
    ];
    const r = computeCompsetIndices({ snapshots, reports, propertyId: "p1", start: "2026-05-01", end: "2026-05-31" });
    // Average occupancy: 0.75 vs 0.725 → ~103.4
    expect(r.averages.occIndex).toBeCloseTo((0.75 / 0.725) * 100, 1);
  });
});
