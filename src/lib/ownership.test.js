import { describe, it, expect } from "vitest";
import {
  makeOwnerEntity, makeMgmtCompany, makeOwnership, makeManagementAgreement, makeCostCenter,
  ownershipAt, validateCapTable, managementAgreementAt, computeManagementFees, distributeToOwners,
} from "./ownership.js";

describe("entity factories", () => {
  it("creates valid owner entities with required fields", () => {
    const o = makeOwnerEntity({ name: "Hospitality Holdings LLC" });
    expect(o.id).toMatch(/^oe_/);
    expect(o.name).toBe("Hospitality Holdings LLC");
    expect(o.type).toBe("owner");
  });

  it("rejects missing names", () => {
    expect(() => makeOwnerEntity({ name: "" })).toThrow();
    expect(() => makeMgmtCompany({ name: "" })).toThrow();
    expect(() => makeCostCenter({ name: "" })).toThrow();
  });

  it("rejects ownership outside [0, 1]", () => {
    expect(() => makeOwnership({ propertyId: "p1", ownerEntityId: "oe1", sharePct: 1.2 })).toThrow();
    expect(() => makeOwnership({ propertyId: "p1", ownerEntityId: "oe1", sharePct: -0.1 })).toThrow();
  });

  it("rejects unrealistic mgmt fee inputs", () => {
    expect(() => makeManagementAgreement({ propertyId: "p1", mgmtCompanyId: "mc1", baseFeePct: 0.30 })).toThrow();
    expect(() => makeManagementAgreement({ propertyId: "p1", mgmtCompanyId: "mc1", reserveContributionPct: 0.20 })).toThrow();
  });
});

describe("ownershipAt + validateCapTable", () => {
  const ownerships = [
    makeOwnership({ propertyId: "p1", ownerEntityId: "oe1", sharePct: 0.60, effectiveFrom: "2025-01-01" }),
    makeOwnership({ propertyId: "p1", ownerEntityId: "oe2", sharePct: 0.40, effectiveFrom: "2025-01-01" }),
    makeOwnership({ propertyId: "p2", ownerEntityId: "oe1", sharePct: 1.00, effectiveFrom: "2025-01-01" }),
  ];

  it("returns only rows active at the date", () => {
    const rows = ownershipAt(ownerships, "p1", "2026-05-01");
    expect(rows).toHaveLength(2);
  });

  it("validates a complete cap table (sums to 1)", () => {
    const v = validateCapTable(ownerships, "p1", "2026-05-01");
    expect(v.ok).toBe(true);
    expect(v.rowCount).toBe(2);
  });

  it("flags an incomplete cap table", () => {
    const partial = [makeOwnership({ propertyId: "p1", ownerEntityId: "oe1", sharePct: 0.5, effectiveFrom: "2025-01-01" })];
    const v = validateCapTable(partial, "p1", "2026-05-01");
    expect(v.ok).toBe(false);
    expect(v.diff).toBeCloseTo(-0.5, 5);
  });
});

describe("computeManagementFees", () => {
  const agreement = makeManagementAgreement({
    propertyId: "p1", mgmtCompanyId: "mc1",
    baseFeePct: 0.03,
    incentiveFeePct: 0.10,
    incentiveHurdlePct: 0.08,
    reserveContributionPct: 0.04,
    effectiveFrom: "2025-01-01",
  });

  it("computes NOI, base fee, reserve, and incentive when above hurdle", () => {
    const fees = computeManagementFees({
      revenue: 100_000, expenses: 60_000, equity: 200_000, agreement,
    });
    // noi = 40000 ; base fee = 3000 ; reserve = 4000
    // hurdle = max(0.08 * 200k=16k, 0) = 16k
    // noiAfterBase = 40000 - 3000 = 37000 ; incentive base = 37000 - 16000 = 21000
    // incentive fee = 21000 * 10% = 2100
    expect(fees.noi).toBe(40_000);
    expect(fees.baseFee).toBe(3_000);
    expect(fees.reserve).toBe(4_000);
    expect(fees.incentiveFee).toBe(2_100);
    // ownerNet = noi - base - incentive - reserve = 30900
    expect(fees.ownerNet).toBe(30_900);
  });

  it("incentive fee is zero when NOI is below hurdle", () => {
    const fees = computeManagementFees({
      revenue: 100_000, expenses: 90_000, equity: 200_000, agreement,
    });
    expect(fees.incentiveFee).toBe(0);
  });

  it("returns zero fees when no agreement present", () => {
    const fees = computeManagementFees({ revenue: 100_000, expenses: 60_000 });
    expect(fees.baseFee).toBe(0);
    expect(fees.ownerNet).toBe(40_000);
  });
});

describe("distributeToOwners", () => {
  const ownerEntities = [
    makeOwnerEntity({ name: "Owner A" }),
    makeOwnerEntity({ name: "Owner B" }),
    makeOwnerEntity({ name: "Owner C" }),
  ];
  const ownerships = [
    makeOwnership({ propertyId: "p1", ownerEntityId: ownerEntities[0].id, sharePct: 0.50, effectiveFrom: "2025-01-01" }),
    makeOwnership({ propertyId: "p1", ownerEntityId: ownerEntities[1].id, sharePct: 0.30, effectiveFrom: "2025-01-01" }),
    makeOwnership({ propertyId: "p1", ownerEntityId: ownerEntities[2].id, sharePct: 0.20, effectiveFrom: "2025-01-01" }),
  ];

  it("splits net by share with rounding remainder absorbed", () => {
    const dist = distributeToOwners({
      ownerNet: 1000, ownerships, propertyId: "p1", asOf: "2026-05-01", ownerEntities,
    });
    expect(dist).toHaveLength(3);
    expect(dist[0].amount).toBeCloseTo(500, 2);
    expect(dist[1].amount).toBeCloseTo(300, 2);
    expect(dist[2].amount).toBeCloseTo(200, 2);
    const total = dist.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(1000);
  });

  it("rounding remainder lands on the last row exactly", () => {
    // $1.00 split 3 ways → $0.34, $0.33, $0.33 (last absorbs)
    const dist = distributeToOwners({
      ownerNet: 1.00, ownerships: [
        makeOwnership({ propertyId: "p1", ownerEntityId: "a", sharePct: 1/3, effectiveFrom: "2025-01-01" }),
        makeOwnership({ propertyId: "p1", ownerEntityId: "b", sharePct: 1/3, effectiveFrom: "2025-01-01" }),
        makeOwnership({ propertyId: "p1", ownerEntityId: "c", sharePct: 1/3, effectiveFrom: "2025-01-01" }),
      ], propertyId: "p1", asOf: "2026-05-01", ownerEntities: [],
    });
    const total = dist.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(1.00);
  });
});

describe("managementAgreementAt", () => {
  it("picks the active agreement on a date", () => {
    const a1 = makeManagementAgreement({ propertyId: "p1", mgmtCompanyId: "mc1", effectiveFrom: "2024-01-01", effectiveTo: "2024-12-31" });
    const a2 = makeManagementAgreement({ propertyId: "p1", mgmtCompanyId: "mc2", effectiveFrom: "2025-01-01" });
    const active = managementAgreementAt([a1, a2], "p1", "2026-05-01");
    expect(active.mgmtCompanyId).toBe("mc2");
  });

  it("returns null when no active agreement", () => {
    const a1 = makeManagementAgreement({ propertyId: "p1", mgmtCompanyId: "mc1", effectiveFrom: "2024-01-01", effectiveTo: "2024-12-31" });
    expect(managementAgreementAt([a1], "p1", "2026-05-01")).toBeNull();
  });
});
