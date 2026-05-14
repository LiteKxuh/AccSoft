import { describe, it, expect } from "vitest";
import { makeProject, projectStatus, recordSpend, buildReserveRollForward, summarizePortfolio } from "./capex.js";

describe("makeProject", () => {
  it("requires propertyId, name, and non-negative budget", () => {
    expect(() => makeProject({})).toThrow();
    expect(() => makeProject({ propertyId: "p1" })).toThrow();
    expect(() => makeProject({ propertyId: "p1", name: "x", budget: -1 })).toThrow();
  });

  it("creates with sane defaults", () => {
    const p = makeProject({ propertyId: "p1", name: "Lobby refresh", budget: 50_000 });
    expect(p.spendToDate).toBe(0);
    expect(p.status).toBe("planned");
    expect(p.history).toEqual([]);
  });
});

describe("projectStatus", () => {
  it("over-budget when spend > budget", () => {
    const p = { budget: 100, spendToDate: 150 };
    expect(projectStatus(p)).toBe("over-budget");
  });

  it("complete when actualComplete is set and not over", () => {
    const p = { budget: 100, spendToDate: 90, actualComplete: "2026-05-01" };
    expect(projectStatus(p)).toBe("complete");
  });

  it("in-progress when spend > 0 and not complete", () => {
    const p = { budget: 100, spendToDate: 50 };
    expect(projectStatus(p)).toBe("in-progress");
  });

  it("planned when no spend", () => {
    expect(projectStatus({ budget: 100, spendToDate: 0 })).toBe("planned");
  });

  it("preserves cancelled / on-hold", () => {
    expect(projectStatus({ status: "cancelled" })).toBe("cancelled");
    expect(projectStatus({ status: "on-hold" })).toBe("on-hold");
  });
});

describe("recordSpend", () => {
  it("appends history and updates status", () => {
    let p = makeProject({ propertyId: "p1", name: "x", budget: 1000 });
    p = recordSpend(p, { amount: 250, date: "2026-05-01" });
    expect(p.spendToDate).toBe(250);
    expect(p.status).toBe("in-progress");
    expect(p.history).toHaveLength(1);
  });

  it("flips to over-budget when spend exceeds budget", () => {
    let p = makeProject({ propertyId: "p1", name: "x", budget: 100 });
    p = recordSpend(p, { amount: 150 });
    expect(p.status).toBe("over-budget");
  });

  it("rejects non-positive amount", () => {
    const p = makeProject({ propertyId: "p1", name: "x", budget: 100 });
    expect(() => recordSpend(p, { amount: 0 })).toThrow();
    expect(() => recordSpend(p, { amount: -10 })).toThrow();
  });
});

describe("buildReserveRollForward", () => {
  it("computes closing balance correctly", () => {
    const r = buildReserveRollForward({
      openingBalance: 10_000,
      contributions: [{ amount: 4_000, date: "2026-05-15" }, { amount: 4_000, date: "2026-06-15" }],
      draws: [{ amount: 5_000, date: "2026-06-20" }],
      start: "2026-05-01", end: "2026-06-30",
    });
    expect(r.contribTotal).toBe(8_000);
    expect(r.drawTotal).toBe(5_000);
    expect(r.closing).toBe(13_000);
  });

  it("filters contributions and draws by date window", () => {
    const r = buildReserveRollForward({
      openingBalance: 0,
      contributions: [{ amount: 1_000, date: "2026-04-15" }, { amount: 2_000, date: "2026-05-15" }],
      draws: [],
      start: "2026-05-01", end: "2026-05-31",
    });
    expect(r.contribTotal).toBe(2_000);
  });
});

describe("summarizePortfolio", () => {
  it("aggregates project counts by status", () => {
    const projects = [
      makeProject({ propertyId: "p1", name: "a", budget: 100 }),                                  // planned
      recordSpend(makeProject({ propertyId: "p1", name: "b", budget: 100 }), { amount: 50 }),     // in-progress
      recordSpend(makeProject({ propertyId: "p1", name: "c", budget: 100 }), { amount: 150 }),    // over-budget
    ];
    const s = summarizePortfolio(projects);
    expect(s.count).toBe(3);
    expect(s.budget).toBe(300);
    expect(s.statusCounts.planned).toBe(1);
    expect(s.statusCounts.inProgress).toBe(1);
    expect(s.statusCounts.overBudget).toBe(1);
  });

  it("filters by property", () => {
    const projects = [
      makeProject({ propertyId: "p1", name: "a", budget: 100 }),
      makeProject({ propertyId: "p2", name: "b", budget: 200 }),
    ];
    expect(summarizePortfolio(projects, "p1").budget).toBe(100);
  });
});
