import { describe, it, expect } from "vitest";
import { buildOwnerStatement } from "./ownerStatement.js";
import { makeOwnerEntity, makeMgmtCompany, makeOwnership, makeManagementAgreement } from "./ownership.js";

function je(date, lines, propertyId = "p1") {
  return { id: `j_${date}_${Math.random()}`, date, propertyId, posted: true, void: false, lines };
}

describe("buildOwnerStatement", () => {
  it("requires propertyId and month", () => {
    expect(() => buildOwnerStatement({ ledger: [], state: {}, month: "2026-05" })).toThrow();
    expect(() => buildOwnerStatement({ ledger: [], state: {}, propertyId: "p1" })).toThrow();
  });

  it("flags incomplete cap table and parks distribution", () => {
    const owner = makeOwnerEntity({ name: "Owner A" });
    const partial = [makeOwnership({ propertyId: "p1", ownerEntityId: owner.id, sharePct: 0.50, effectiveFrom: "2025-01-01" })];
    const state = {
      properties: [{ id: "p1", name: "Test Hotel", ownerEquity: 100_000 }],
      ownerEntities: [owner],
      ownerships: partial,
      managementAgreements: [],
    };
    const ledger = [
      je("2026-05-15", [
        { accountCode: "1010", debit: 1000, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 1000 },
      ]),
    ];
    const stmt = buildOwnerStatement({ ledger, state, propertyId: "p1", month: "2026-05" });
    expect(stmt.capTable.ok).toBe(false);
    expect(stmt.unallocated).toBeGreaterThan(0);
    expect(stmt.distributions).toEqual([]);
  });

  it("computes distributions per cap-table when valid", () => {
    const ownerA = makeOwnerEntity({ name: "Owner A" });
    const ownerB = makeOwnerEntity({ name: "Owner B" });
    const ownerships = [
      makeOwnership({ propertyId: "p1", ownerEntityId: ownerA.id, sharePct: 0.60, effectiveFrom: "2025-01-01" }),
      makeOwnership({ propertyId: "p1", ownerEntityId: ownerB.id, sharePct: 0.40, effectiveFrom: "2025-01-01" }),
    ];
    const mgmt = makeMgmtCompany({ name: "MgmtCo" });
    const agreement = makeManagementAgreement({
      propertyId: "p1",
      mgmtCompanyId: mgmt.id,
      baseFeePct: 0.03,
      incentiveFeePct: 0,
      reserveContributionPct: 0.04,
      effectiveFrom: "2025-01-01",
    });
    const state = {
      properties: [{ id: "p1", name: "Test Hotel", ownerEquity: 100_000 }],
      ownerEntities: [ownerA, ownerB],
      ownerships,
      managementCompanies: [mgmt],
      managementAgreements: [agreement],
    };
    // $100,000 revenue, $60,000 expenses → noi = 40,000
    // base fee = 3,000 ; reserve = 4,000 ; ownerNet = 33,000
    const ledger = [];
    for (let d = 1; d <= 10; d++) {
      const date = `2026-05-${String(d).padStart(2, "0")}`;
      ledger.push(je(date, [
        { accountCode: "1010", debit: 10_000, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 10_000 },
      ]));
      ledger.push(je(date, [
        { accountCode: "5010", debit: 6_000, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 6_000 },
      ]));
    }
    const stmt = buildOwnerStatement({ ledger, state, propertyId: "p1", month: "2026-05" });
    expect(stmt.capTable.ok).toBe(true);
    expect(stmt.pnl.revenue.total).toBe(100_000);
    expect(stmt.fees.baseFee).toBe(3_000);
    expect(stmt.fees.reserve).toBe(4_000);
    expect(stmt.fees.ownerNet).toBe(33_000);
    expect(stmt.distributions).toHaveLength(2);
    expect(stmt.distributions[0].amount).toBeCloseTo(19_800, 0); // 60% of 33000
    expect(stmt.distributions[1].amount).toBeCloseTo(13_200, 0); // 40% of 33000
  });
});
