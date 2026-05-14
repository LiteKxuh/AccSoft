import { describe, it, expect } from "vitest";
import { buildDepartmentPnl } from "./departmentPnl.js";
import { DEFAULT_CHART } from "./gl.js";

function je(date, lines, propertyId = "p1") {
  return { id: `j_${date}_${Math.random()}`, date, propertyId, posted: true, void: false, lines };
}

describe("buildDepartmentPnl", () => {
  it("rolls revenue and expenses by USALI bucket", () => {
    const ledger = [
      // Room revenue
      je("2026-05-01", [
        { accountCode: "1010", debit: 1000, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 1000 },
      ]),
      // F&B revenue
      je("2026-05-01", [
        { accountCode: "1010", debit: 200, credit: 0 },
        { accountCode: "4210", debit: 0, credit: 200 },
      ]),
      // Rooms wages
      je("2026-05-01", [
        { accountCode: "5010", debit: 300, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 300 },
      ]),
      // A&G wages
      je("2026-05-01", [
        { accountCode: "5030", debit: 100, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 100 },
      ]),
      // Property tax (fixed)
      je("2026-05-01", [
        { accountCode: "6230", debit: 50, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 50 },
      ]),
    ];
    const r = buildDepartmentPnl({ ledger, start: "2026-05-01", end: "2026-05-31", propertyId: "p1", chart: DEFAULT_CHART });
    expect(r.totals.revenue.rooms).toBe(1000);
    expect(r.totals.revenue.fb).toBe(200);
    expect(r.totals.revenue.total).toBe(1200);
    expect(r.totals.departmentalExpense.rooms).toBe(300);
    expect(r.totals.undistributed.ag).toBe(100);
    expect(r.totals.fixed).toBe(50);
    // GOP = 1200 - 300 (rooms expense) - 100 (A&G) = 800
    expect(r.totals.gop).toBe(800);
    // NOI = 800 - 50 = 750
    expect(r.totals.noi).toBe(750);
  });

  it("returns 0 totals on empty ledger", () => {
    const r = buildDepartmentPnl({ ledger: [], start: "2026-05-01", end: "2026-05-31", propertyId: "p1" });
    expect(r.totals.revenue.total).toBe(0);
    expect(r.totals.gop).toBe(0);
    expect(r.totals.noi).toBe(0);
  });

  it("filters by date range and property", () => {
    const ledger = [
      je("2026-05-01", [
        { accountCode: "1010", debit: 1000, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 1000 },
      ], "p1"),
      je("2026-04-01", [
        { accountCode: "1010", debit: 500, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 500 },
      ], "p1"),
      je("2026-05-01", [
        { accountCode: "1010", debit: 9999, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 9999 },
      ], "p2"),
    ];
    const r = buildDepartmentPnl({ ledger, start: "2026-05-01", end: "2026-05-31", propertyId: "p1" });
    expect(r.totals.revenue.rooms).toBe(1000);
  });

  it("flags out-of-band GOP margin", () => {
    // Revenue 1000, no expenses → GOP margin = 100%, above 55% ceiling
    const ledger = [
      je("2026-05-01", [
        { accountCode: "1010", debit: 1000, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 1000 },
      ]),
    ];
    const r = buildDepartmentPnl({ ledger, start: "2026-05-01", end: "2026-05-31", propertyId: "p1" });
    expect(r.realism.gop.status).toBe("high");
  });

  it("excludes voided entries", () => {
    const ledger = [
      je("2026-05-01", [
        { accountCode: "1010", debit: 1000, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 1000 },
      ]),
      { ...je("2026-05-01", [
        { accountCode: "1010", debit: 500, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 500 },
      ]), void: true },
    ];
    const r = buildDepartmentPnl({ ledger, start: "2026-05-01", end: "2026-05-31", propertyId: "p1" });
    expect(r.totals.revenue.rooms).toBe(1000);
  });
});
