import { describe, it, expect } from "vitest";
import { buildManagementFeeReport } from "./managementFeeReport.js";
import { makeMgmtCompany, makeManagementAgreement } from "./ownership.js";

function je(date, lines, propertyId = "p1") {
  return { id: `j_${date}_${Math.random()}`, date, propertyId, posted: true, void: false, lines };
}

describe("buildManagementFeeReport", () => {
  it("requires propertyId + month", () => {
    expect(() => buildManagementFeeReport({ ledger: [], state: {}, month: "2026-05" })).toThrow();
    expect(() => buildManagementFeeReport({ ledger: [], state: {}, propertyId: "p1" })).toThrow();
  });

  it("computes a balanced draft accrual when an agreement exists", () => {
    const mgmt = makeMgmtCompany({ name: "MgmtCo" });
    const agreement = makeManagementAgreement({
      propertyId: "p1", mgmtCompanyId: mgmt.id,
      baseFeePct: 0.03, incentiveFeePct: 0, reserveContributionPct: 0.04,
      effectiveFrom: "2025-01-01",
    });
    const state = {
      properties: [{ id: "p1", name: "Test Hotel", ownerEquity: 100_000 }],
      managementCompanies: [mgmt],
      managementAgreements: [agreement],
    };
    const ledger = [
      je("2026-05-15", [
        { accountCode: "1010", debit: 100_000, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 100_000 },
      ]),
      je("2026-05-15", [
        { accountCode: "5010", debit: 50_000, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 50_000 },
      ]),
    ];
    const r = buildManagementFeeReport({ ledger, state, propertyId: "p1", month: "2026-05" });
    expect(r.revenue).toBe(100_000);
    expect(r.fees.baseFee).toBe(3_000);
    expect(r.fees.reserve).toBe(4_000);
    expect(r.draftJournal).not.toBeNull();
    expect(r.draftJournal.posted).toBe(false);
    // Check the JE balances
    const drs = r.draftJournal.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const crs = r.draftJournal.lines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(drs).toBeCloseTo(crs, 2);
  });

  it("returns null draft when no agreement is present", () => {
    const state = { properties: [{ id: "p1", name: "Test Hotel" }] };
    const ledger = [];
    const r = buildManagementFeeReport({ ledger, state, propertyId: "p1", month: "2026-05" });
    expect(r.draftJournal).toBeNull();
  });
});
