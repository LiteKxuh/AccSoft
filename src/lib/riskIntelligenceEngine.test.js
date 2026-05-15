import { describe, it, expect } from "vitest";
import { runRiskIntelligence, runPortfolioRisk } from "./riskIntelligenceEngine.js";

function je(date, lines, propertyId = "p1", opts = {}) {
  return {
    id: opts.id || `je_${date}_${Math.random().toString(36).slice(2, 8)}`,
    date, propertyId,
    posted: true,
    void: false,
    approvalState: opts.approvalState ?? "approved",
    source: opts.source ?? null,
    description: opts.description ?? "",
    chain: opts.chain ?? { hash: "x".repeat(64), prev: null },
    lines,
  };
}

describe("runRiskIntelligence — empty state", () => {
  it("returns clean band when there is nothing to detect", () => {
    const r = runRiskIntelligence({}, { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.riskBand).toBe("clean");
    expect(r.findings).toEqual([]);
  });
});

describe("runRiskIntelligence — duplicate detection", () => {
  it("flags duplicate invoices via the financial detector", () => {
    const dup = (n) => ({
      id: `inv_${n}`, propertyId: "p1", vendorId: "v1", amount: 1500,
      number: "INV-001", issuedDate: "2026-05-10", dueDate: "2026-05-30",
      status: "open",
    });
    const r = runRiskIntelligence({ invoices: [dup(1), dup(2)] }, { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.findings.some(f => f.category === "financial" && f.code === "duplicate.exact")).toBe(true);
  });
});

describe("runRiskIntelligence — chain integrity", () => {
  it("flags unchained posted JEs", () => {
    const e = je("2026-05-10", [{ accountCode: "5100", debit: 100, credit: 0 }, { accountCode: "1020", debit: 0, credit: 100 }]);
    delete e.chain; // remove chain
    const r = runRiskIntelligence({ journalEntries: [e] }, { propertyId: "p1", asOf: "2026-05-14" });
    const chainFinding = r.findings.find(f => f.category === "ledger" && f.code === "chain.unchained");
    expect(chainFinding).toBeTruthy();
    expect(chainFinding.severity).toBe("high");
  });
});

describe("runRiskIntelligence — AP exposure", () => {
  it("includes A/P over 120 in findings", () => {
    const old = new Date("2026-05-14"); old.setDate(old.getDate() - 130);
    const inv = {
      id: "inv1", propertyId: "p1", vendorId: "v1",
      amount: 60_000, number: "X", status: "open",
      issuedDate: old.toISOString().slice(0, 10),
      dueDate: old.toISOString().slice(0, 10),
    };
    const r = runRiskIntelligence({ invoices: [inv] }, { propertyId: "p1", asOf: "2026-05-14" });
    const ap = r.findings.find(f => f.code === "ap.over120");
    expect(ap).toBeTruthy();
    expect(ap.severity).toBe("high");
  });
});

describe("runRiskIntelligence — score banding", () => {
  it("escalates band as findings accumulate", () => {
    const old = new Date("2026-05-14"); old.setDate(old.getDate() - 130);
    const e = je("2026-05-10", [{ accountCode: "5100", debit: 100, credit: 0 }, { accountCode: "1020", debit: 0, credit: 100 }]);
    delete e.chain;
    const inv = (n, amt) => ({
      id: `inv_${n}`, propertyId: "p1", vendorId: "v1", amount: amt,
      number: "DUP", status: "open",
      issuedDate: "2026-05-10", dueDate: "2026-05-30",
    });
    const oldInv = {
      id: "inv_old", propertyId: "p1", vendorId: "v1", amount: 60_000,
      number: "OLD", status: "open",
      issuedDate: old.toISOString().slice(0, 10),
      dueDate: old.toISOString().slice(0, 10),
    };
    const r = runRiskIntelligence({
      journalEntries: [e],
      invoices: [inv(1, 1500), inv(2, 1500), oldInv],
    }, { propertyId: "p1", asOf: "2026-05-14" });
    expect(["elevated", "high", "critical"]).toContain(r.riskBand);
    expect(r.byCategory.financial?.count).toBeGreaterThan(0);
    expect(r.byCategory.ledger?.count).toBeGreaterThan(0);
    expect(r.byCategory.ap?.count).toBeGreaterThan(0);
  });
});

describe("runRiskIntelligence — heatmap and topActions", () => {
  it("produces a 5×3 heatmap", () => {
    const r = runRiskIntelligence({}, { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.heatmap.length).toBe(15);
    const cats = new Set(r.heatmap.map(c => c.category));
    expect(cats.has("financial")).toBe(true);
    expect(cats.has("payroll")).toBe(true);
  });

  it("derives topActions with action text per finding code", () => {
    const dup = (n) => ({
      id: `inv_${n}`, propertyId: "p1", vendorId: "v1", amount: 1500,
      number: "INV-001", issuedDate: "2026-05-10", dueDate: "2026-05-30",
      status: "open",
    });
    const r = runRiskIntelligence({ invoices: [dup(1), dup(2)] }, { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.topActions.length).toBeGreaterThan(0);
    expect(r.topActions[0].action).toContain("AP module");
  });
});

describe("runPortfolioRisk", () => {
  it("rolls up per-property scores and ranks worst", () => {
    const dup = (n, pid) => ({
      id: `inv_${pid}_${n}`, propertyId: pid, vendorId: "v1", amount: 1500,
      number: "INV-001", issuedDate: "2026-05-10", dueDate: "2026-05-30",
      status: "open",
    });
    const state = {
      invoices: [dup(1, "p1"), dup(2, "p1"), dup(1, "p2")],
    };
    const r = runPortfolioRisk(state, { propertyIds: ["p1", "p2"], asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.propertyCount).toBe(2);
    expect(r.worst[0].propertyId).toBe("p1");
  });

  it("returns no-properties when called empty", () => {
    expect(runPortfolioRisk({}, { propertyIds: [] }).status).toBe("no-properties");
  });
});
