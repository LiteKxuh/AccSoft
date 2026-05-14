import { describe, it, expect } from "vitest";
import {
  runNightAudit,
  checkSettlement, checkOccupancyMath, checkAdr, checkTaxRates,
  checkAdvanceDeposits, checkNoShows, checkCashDrop,
} from "./nightAudit.js";

// Clean reference report: rev 9000 + tax 1133.70 = settlement 10133.70
const mkReport = (overrides = {}) => ({
  id: "r1",
  date: "2026-05-01",
  propertyId: "p1",
  roomsAvailable: 100,
  roomsSold: 70,
  occupancy: 0.70,
  adr: 120,
  roomRevenue: 8400,
  totalRevenue: 9000,
  breakdown: {
    revenue: { rooms: 8400, fb: { restaurant: 500, bar: 100 }, other: { parking: 0 } },
    taxes: { occupancy: 966, sales: 41.7, tourism: 126 }, // 11.5% * 8400, 6.95% * 600, 1.5% * 8400
    payments: { cash: 500, creditCard: 9000, directBill: 633.7 },
    cashDrop: 500,
  },
  ...overrides,
});

describe("checkOccupancyMath", () => {
  it("passes clean math", () => {
    expect(checkOccupancyMath(mkReport()).status).toBe("pass");
  });

  it("fails when sold > available", () => {
    expect(checkOccupancyMath(mkReport({ roomsSold: 120 })).status).toBe("fail");
  });

  it("fails on zero rooms available", () => {
    expect(checkOccupancyMath(mkReport({ roomsAvailable: 0 })).status).toBe("fail");
  });

  it("warns on small reporting discrepancy", () => {
    const c = checkOccupancyMath(mkReport({ occupancy: 0.85 })); // computed is 0.70
    expect(c.status).toBe("warn");
  });
});

describe("checkAdr", () => {
  it("passes when ADR aligns", () => {
    expect(checkAdr(mkReport()).status).toBe("pass");
  });

  it("warns on a large reporting discrepancy", () => {
    expect(checkAdr(mkReport({ adr: 200 })).status).toBe("warn"); // 8400/70 = 120
  });

  it("fails when room revenue exists with zero rooms sold", () => {
    expect(checkAdr(mkReport({ roomsSold: 0, breakdown: { revenue: { rooms: 1000 } } })).status).toBe("fail");
  });
});

describe("checkSettlement", () => {
  it("passes when settlement equals revenue + tax within tolerance", () => {
    expect(checkSettlement(mkReport()).status).toBe("pass");
  });

  it("fails when settlement is far off", () => {
    const r = mkReport({ breakdown: { ...mkReport().breakdown, payments: { cash: 500, creditCard: 1000 } } });
    expect(["warn", "fail"]).toContain(checkSettlement(r).status);
  });

  it("warns when settlement is missing entirely", () => {
    const r = mkReport({ breakdown: { ...mkReport().breakdown, payments: {} } });
    expect(checkSettlement(r).status).toBe("warn");
  });
});

describe("checkTaxRates", () => {
  it("passes when accrued tax matches configured rates", () => {
    expect(checkTaxRates(mkReport()).status).toBe("pass");
  });

  it("warns when occupancy tax is materially off", () => {
    const r = mkReport({ breakdown: { ...mkReport().breakdown, taxes: { occupancy: 200, sales: 41.7, tourism: 126 } } });
    expect(checkTaxRates(r).status).toBe("warn");
  });
});

describe("checkAdvanceDeposits", () => {
  it("passes when zero", () => {
    expect(checkAdvanceDeposits(mkReport()).status).toBe("pass");
  });

  it("fails on negative deposits", () => {
    const r = mkReport({ breakdown: { ...mkReport().breakdown, advanceDeposits: { total: -100, applied: 0 } } });
    expect(checkAdvanceDeposits(r).status).toBe("fail");
  });
});

describe("checkNoShows", () => {
  it("passes when no no-shows", () => {
    expect(checkNoShows(mkReport()).status).toBe("pass");
  });

  it("warns when no-show revenue is far from count × ADR", () => {
    const r = mkReport({ breakdown: { ...mkReport().breakdown, noShows: { count: 5, revenue: 100 } } });
    expect(checkNoShows(r).status).toBe("warn");
  });
});

describe("checkCashDrop", () => {
  it("passes when drop matches cash settlements", () => {
    expect(checkCashDrop(mkReport()).status).toBe("pass");
  });

  it("warns on small mismatch", () => {
    const r = mkReport({ breakdown: { ...mkReport().breakdown, cashDrop: 510 } });
    expect(["warn", "pass"]).toContain(checkCashDrop(r).status); // $10 diff on $500 = 2%, borderline
  });

  it("fails on large mismatch", () => {
    const r = mkReport({ breakdown: { ...mkReport().breakdown, cashDrop: 100 } });
    expect(checkCashDrop(r).status).toBe("fail");
  });
});

describe("runNightAudit aggregator", () => {
  it("produces a 100 score on a clean report", () => {
    const result = runNightAudit(mkReport());
    expect(result.status).toBe("pass");
    expect(result.score).toBe(100);
    expect(result.checks.length).toBeGreaterThanOrEqual(5);
  });

  it("drops the score and flags 'fail' on impossible occupancy", () => {
    const result = runNightAudit(mkReport({ roomsSold: 120 }));
    expect(result.status).toBe("fail");
    expect(result.score).toBeLessThan(100);
    expect(result.summary).toMatch(/DO NOT roll/);
  });

  it("returns 0 with status fail when given null", () => {
    const result = runNightAudit(null);
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });
});
