import { describe, it, expect } from "vitest";
import { buildGopAnalysis } from "./gopAnalysis.js";

const mkPnl = (rev = 100_000, rooms = 70_000, fb = 25_000, other = 5_000, deptRooms = 25_000, deptFb = 8_000, undist = 20_000, fixed = 10_000) => {
  const gop = rev - deptRooms - deptFb - undist;
  const noi = gop - fixed;
  return {
    totals: {
      revenue: { rooms, fb, other, total: rev },
      departmentalExpense: { rooms: deptRooms, fb: deptFb, total: deptRooms + deptFb },
      undistributed: { ag: undist, total: undist },
      fixed,
      gop,
      gopPct: rev > 0 ? gop / rev : 0,
      noi,
      noiPct: rev > 0 ? noi / rev : 0,
    },
  };
};

describe("buildGopAnalysis", () => {
  it("returns missing-pnl when no input", () => {
    expect(buildGopAnalysis({ pnl: null }).status).toBe("missing-pnl");
  });

  it("captures actual GOP, NOI and per-department margins", () => {
    const r = buildGopAnalysis({ pnl: mkPnl() });
    expect(r.status).toBe("ok");
    expect(r.actual.gop).toBe(100000 - 25000 - 8000 - 20000); // 47000
    expect(r.actual.noi).toBe(47000 - 10000);
    expect(r.departments.find(d => d.department === "Rooms").profit).toBe(45000);
    expect(r.departments.find(d => d.department === "F&B").margin).toBeCloseTo(17000 / 25000, 5);
  });

  it("computes budget variance when budget present", () => {
    const budget = { rooms: { revenue: 80_000 }, fb: { restaurant: 0, bar: 0, banquet: 0 }, other: {}, expectedGopMargin: 0.40 };
    const r = buildGopAnalysis({ pnl: mkPnl(), budget });
    expect(r.budget).not.toBeNull();
    expect(r.budget.revenue.abs).toBe(20000); // 100k - 80k
  });

  it("flags F&B departmental margin below benchmark", () => {
    const r = buildGopAnalysis({ pnl: mkPnl(100_000, 70_000, 25_000, 5_000, 25_000, 22_500, 20_000, 10_000) });
    // F&B margin = (25k - 22.5k) / 25k = 10% — below 25-35%
    expect(r.diagnostic.some(n => /F&B/.test(n))).toBe(true);
  });

  it("driver decomposition splits GOP variance into revenue vs cost contribution", () => {
    const budget = { rooms: { revenue: 80_000 }, fb: {}, other: {}, expectedGopMargin: 0.40 };
    const r = buildGopAnalysis({ pnl: mkPnl(), budget });
    expect(r.driverDecomposition).not.toBeNull();
    expect(r.driverDecomposition).toHaveProperty("fromRevenue");
    expect(r.driverDecomposition).toHaveProperty("fromCosts");
  });
});
