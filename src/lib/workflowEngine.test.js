import { describe, it, expect } from "vitest";
import { evaluate, evaluatePortfolio, applyEvents, resolveEvent, summarizeAutomation } from "./workflowEngine.js";

const cleanSnap = (propertyId = "p1", asOf = "2026-05-14") => ({
  propertyId, asOf, status: "ok",
  tier: "upscale",
  today: { revenue: 10000, occupancy: 0.70, adr: 120, revpar: 84 },
  yesterday: { revenue: 9500, occupancy: 0.68, adr: 119 },
  mtd: { revenue: 140000, roomsSold: 1000, roomsAvailable: 1400, occupancy: 0.71, adr: 130 },
  ytd: { revenue: 0 },
  ledger: { ap: { total: 5000, b120: 0 }, ar: {}, apOver120: 0, cashCovered: 50000 },
  labor: { mtdCost: 35000, mtdPctRev: 0.25, todayCost: 1200, scheduledHours: 500, actualHours: 510, driftPct: 0.02 },
  audit: { score: 95, status: "pass", failureCount: 0, warningCount: 0 },
  anomalies: [],
  pace: { market: { occCap: 0.95 }, projection7: 50000, projection14: 100000, pickupRooms: 30 },
  capex: { statusCounts: { planned: 0, inProgress: 1, complete: 0, overBudget: 0 }, budget: 50000, spend: 10000 },
  approvals: { pendingJE: 0, pendingAP: 0, pendingDollar: 0 },
  compression: false,
  riskFlags: [],
  coverage: { hasReportToday: true, hasLaborToday: true, hasBudget: true, hasOwnership: true },
});

describe("evaluate — clean snapshot produces no events", () => {
  it("returns empty array on clean state", () => {
    expect(evaluate(cleanSnap())).toEqual([]);
  });
});

describe("evaluate — rules fire on real conditions", () => {
  it("fires audit hard-fail when audit.status = fail", () => {
    const s = cleanSnap();
    s.audit = { score: 40, status: "fail", failureCount: 3, warningCount: 0 };
    const events = evaluate(s);
    expect(events.find(e => e.ruleId === "rules.audit.hard_fail")).toBeTruthy();
  });

  it("fires labor.overspend when labor > 35% of revenue", () => {
    const s = cleanSnap();
    s.labor = { ...s.labor, mtdPctRev: 0.42 };
    const events = evaluate(s);
    expect(events.find(e => e.ruleId === "rules.labor.overspend")).toBeTruthy();
  });

  it("fires labor.overspend at high severity when >45%", () => {
    const s = cleanSnap();
    s.labor = { ...s.labor, mtdPctRev: 0.50 };
    const ev = evaluate(s).find(e => e.ruleId === "rules.labor.overspend");
    expect(ev.severity).toBe("high");
  });

  it("fires compression rule when snap.compression is true", () => {
    const s = cleanSnap();
    s.compression = true;
    const events = evaluate(s);
    expect(events.find(e => e.ruleId === "rules.compression.forward")).toBeTruthy();
  });

  it("fires approvals.backlog with high severity for $100k+", () => {
    const s = cleanSnap();
    s.approvals = { pendingJE: 5, pendingAP: 5, pendingDollar: 120_000 };
    const ev = evaluate(s).find(e => e.ruleId === "rules.approvals.backlog");
    expect(ev.severity).toBe("high");
  });

  it("fires missing budget rule when hasBudget = false", () => {
    const s = cleanSnap();
    s.coverage = { ...s.coverage, hasBudget: false };
    const events = evaluate(s);
    expect(events.find(e => e.ruleId === "rules.coverage.missing_budget")).toBeTruthy();
  });
});

describe("evaluatePortfolio", () => {
  it("walks every property snapshot", () => {
    const a = cleanSnap("p1"); a.audit = { status: "fail", score: 0, failureCount: 1, warningCount: 0 };
    const b = cleanSnap("p2"); b.labor = { ...b.labor, mtdPctRev: 0.40 };
    const events = evaluatePortfolio([a, b]);
    expect(events.some(e => e.propertyId === "p1" && e.ruleId === "rules.audit.hard_fail")).toBe(true);
    expect(events.some(e => e.propertyId === "p2" && e.ruleId === "rules.labor.overspend")).toBe(true);
  });
});

describe("applyEvents — dedupe + idempotency", () => {
  it("appends new events and skips duplicates by dedupeKey", () => {
    const state = { automationEvents: [] };
    const evs = [
      { ruleId: "r1", propertyId: "p1", asOf: "2026-05-14", dedupeKey: "k1", severity: "high", label: "x", action: "alert", payload: {}, createdAt: "x" },
      { ruleId: "r1", propertyId: "p1", asOf: "2026-05-14", dedupeKey: "k1", severity: "high", label: "x", action: "alert", payload: {}, createdAt: "y" },
    ];
    const patch = applyEvents(state, evs);
    expect(patch.automationEvents).toHaveLength(1);
  });

  it("returns null when nothing new", () => {
    const state = { automationEvents: [{ dedupeKey: "k1" }] };
    const patch = applyEvents(state, [{ dedupeKey: "k1", ruleId: "r", propertyId: "p", asOf: "2026-05-14", severity: "low", label: "x", action: "alert", payload: {}, createdAt: "x" }]);
    expect(patch).toBeNull();
  });
});

describe("resolveEvent + summarizeAutomation", () => {
  it("resolves an event in place", () => {
    const state = { automationEvents: [{ id: "e1", status: "open", severity: "high", ruleId: "r" }] };
    const patch = resolveEvent(state, "e1", { id: "u1" }, "resolved");
    expect(patch.automationEvents[0].status).toBe("resolved");
    expect(patch.automationEvents[0].resolvedBy).toBe("u1");
  });

  it("summarizes by severity / rule / property", () => {
    const state = { automationEvents: [
      { id: "e1", severity: "high", status: "open", ruleId: "r1", propertyId: "p1" },
      { id: "e2", severity: "medium", status: "resolved", ruleId: "r2", propertyId: "p1" },
      { id: "e3", severity: "high", status: "open", ruleId: "r1", propertyId: "p2" },
    ]};
    const s = summarizeAutomation(state);
    expect(s.total).toBe(3);
    expect(s.bySeverity.high).toBe(2);
    expect(s.byRule.r1).toBe(2);
    expect(s.byProperty.p1).toBe(2);
    expect(s.open).toBe(2);
  });
});
