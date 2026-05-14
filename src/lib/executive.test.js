import { describe, it, expect } from "vitest";
import { assetHealthScore, rankProperties, buildCommandCenter } from "./executive.js";

const baseSnap = (overrides = {}) => ({
  propertyId: "p1", asOf: "2026-05-14", status: "ok",
  tier: "upscale",
  today: { revenue: 10000, occupancy: 0.72, adr: 130 },
  mtd: { revenue: 140000, roomsSold: 1000, roomsAvailable: 1400, occupancy: 0.71, adr: 140 },
  labor: { mtdCost: 42000, mtdPctRev: 0.30, todayCost: 1200, scheduledHours: 500, actualHours: 510, driftPct: 0.02 },
  audit: { score: 92, status: "pass", failureCount: 0, warningCount: 0 },
  approvals: { pendingJE: 1, pendingAP: 1, pendingDollar: 5000 },
  ledger: { ap: { total: 5000, b120: 0 }, apOver120: 0 },
  anomalies: [],
  pace: null,
  capex: { statusCounts: { overBudget: 0 } },
  riskFlags: [],
  coverage: { hasReportToday: true, hasLaborToday: true, hasBudget: true, hasOwnership: true },
  ...overrides,
});

describe("assetHealthScore", () => {
  it("returns a strong band on a healthy snapshot", () => {
    const r = assetHealthScore(baseSnap());
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(["strong", "healthy"]).toContain(r.band);
  });

  it("penalizes labor overspend", () => {
    const good = assetHealthScore(baseSnap()).score;
    const bad = assetHealthScore(baseSnap({ labor: { ...baseSnap().labor, mtdPctRev: 0.55 } })).score;
    expect(bad).toBeLessThan(good);
  });

  it("penalizes high risk flag count", () => {
    const good = assetHealthScore(baseSnap()).score;
    const bad = assetHealthScore(baseSnap({ riskFlags: [{ severity: "high" }, { severity: "high" }, { severity: "medium" }] })).score;
    expect(bad).toBeLessThan(good);
  });

  it("returns null on invalid snapshot", () => {
    expect(assetHealthScore({ status: "no-reports" })).toBeNull();
  });
});

describe("rankProperties", () => {
  it("ranks by revenue by default", () => {
    const snaps = [
      baseSnap({ propertyId: "p1", mtd: { ...baseSnap().mtd, revenue: 100000 } }),
      baseSnap({ propertyId: "p2", mtd: { ...baseSnap().mtd, revenue: 200000 } }),
      baseSnap({ propertyId: "p3", mtd: { ...baseSnap().mtd, revenue: 150000 } }),
    ];
    const ranked = rankProperties(snaps, "revenue");
    expect(ranked.map(r => r.propertyId)).toEqual(["p2", "p3", "p1"]);
  });

  it("ranks by occupancy descending", () => {
    const snaps = [
      baseSnap({ propertyId: "p1", mtd: { ...baseSnap().mtd, occupancy: 0.50 } }),
      baseSnap({ propertyId: "p2", mtd: { ...baseSnap().mtd, occupancy: 0.85 } }),
    ];
    const ranked = rankProperties(snaps, "occupancy");
    expect(ranked[0].propertyId).toBe("p2");
  });

  it("inverts labor (lower is better)", () => {
    const snaps = [
      baseSnap({ propertyId: "p1", labor: { ...baseSnap().labor, mtdPctRev: 0.25 } }),
      baseSnap({ propertyId: "p2", labor: { ...baseSnap().labor, mtdPctRev: 0.40 } }),
    ];
    const ranked = rankProperties(snaps, "labor");
    expect(ranked[0].propertyId).toBe("p1");
  });

  it("excludes invalid snapshots", () => {
    const snaps = [
      baseSnap({ propertyId: "p1" }),
      { propertyId: "p2", status: "no-reports" },
    ];
    expect(rankProperties(snaps).length).toBe(1);
  });
});

describe("buildCommandCenter", () => {
  it("returns a payload with portfolio + per-property data", () => {
    const reports = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 4, 1 + i));
      const iso = d.toISOString().slice(0, 10);
      reports.push({ id: `r1_${iso}`, date: iso, propertyId: "p1", roomsAvailable: 100, roomsSold: 70, occupancy: 0.7, adr: 120, revpar: 84, roomRevenue: 8400, totalRevenue: 9000, breakdown: { revenue: { rooms: 8400, fb: {}, other: {} }, taxes: {} } });
    }
    const state = { reports, journalEntries: [] };
    const r = buildCommandCenter(state, { propertyIds: ["p1"], asOf: "2026-05-30" });
    expect(r.portfolio.n).toBe(1);
    expect(r.properties.length).toBe(1);
    expect(r.properties[0].health).not.toBeNull();
    expect(r.properties[0].health.score).toBeGreaterThan(0);
  });
});
