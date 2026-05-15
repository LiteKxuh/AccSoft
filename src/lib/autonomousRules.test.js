import { describe, it, expect } from "vitest";
import { evaluateAutonomous, evaluatePortfolioAutonomous, AUTONOMOUS_RULES } from "./autonomousRules.js";

function mockGraph(overrides = {}) {
  return {
    status: "ok",
    propertyId: "p1",
    asOf: "2026-05-14",
    indices: {
      hotelHealthIndex: 70,
      staffingStressIndex: 0,
      guestRiskIndex: 0,
      operationalRiskScore: 0,
      profitabilityPressureScore: 0,
    },
    pressurePoints: [],
    coordination: [],
    forensic: { findings: [], riskBand: "clean" },
    costIntel: null,
    ...overrides,
  };
}

describe("evaluateAutonomous", () => {
  it("returns empty for a clean graph", () => {
    expect(evaluateAutonomous(mockGraph())).toEqual([]);
  });

  it("returns empty when graph status is not ok", () => {
    expect(evaluateAutonomous({ status: "no-reports" })).toEqual([]);
  });

  it("fires staffing intervention when stress >= 60", () => {
    const g = mockGraph({ indices: { ...mockGraph().indices, staffingStressIndex: 75 } });
    const events = evaluateAutonomous(g);
    const e = events.find(ev => ev.ruleId === "auto.staffing.intervention");
    expect(e).toBeTruthy();
    expect(e.severity).toBe("medium");
  });

  it("escalates staffing intervention when stress >= 80", () => {
    const g = mockGraph({ indices: { ...mockGraph().indices, staffingStressIndex: 85 } });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.staffing.intervention").severity).toBe("high");
  });

  it("fires HK understaffing rule from twin", () => {
    const g = mockGraph();
    const twin = { housekeeping: { status_: "understaffed", gap: 3, roomsToClean: 50 } };
    const events = evaluateAutonomous(g, twin);
    expect(events.find(ev => ev.ruleId === "auto.staffing.hk_understaff")).toBeTruthy();
  });

  it("fires payroll freeze when high-severity payroll forensic findings exist", () => {
    const g = mockGraph({
      forensic: {
        findings: [
          { code: "payroll.outlier", severity: "high", label: "x" },
          { code: "payroll.ghost", severity: "high", label: "y" },
        ],
        riskBand: "high",
      },
    });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.payroll.freeze")).toBeTruthy();
  });

  it("fires revenue review when profitability pressure >= 50", () => {
    const g = mockGraph({ indices: { ...mockGraph().indices, profitabilityPressureScore: 65 } });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.revenue.review")).toBeTruthy();
  });

  it("fires margin.eroding when costIntel.margin verdict is eroding", () => {
    const g = mockGraph({ costIntel: { margin: { status: "ok", verdict: "eroding" } } });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.margin.eroding")).toBeTruthy();
  });

  it("fires guest escalation when guestRiskIndex >= 50", () => {
    const g = mockGraph({ indices: { ...mockGraph().indices, guestRiskIndex: 60 } });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.guest.escalation")).toBeTruthy();
  });

  it("fires audit escalation when operationalRiskScore >= 50", () => {
    const g = mockGraph({ indices: { ...mockGraph().indices, operationalRiskScore: 55 } });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.audit.escalation")).toBeTruthy();
  });

  it("fires chain.gap when pressurePoints include chain.gaps", () => {
    const g = mockGraph({ pressurePoints: [{ code: "chain.gaps", severity: "high", label: "x" }] });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.audit.chain_gap")).toBeTruthy();
  });

  it("fires AP escalation when ap.over120 pressure point present", () => {
    const g = mockGraph({ pressurePoints: [{ code: "ap.over120", severity: "medium", label: "x" }] });
    const events = evaluateAutonomous(g);
    expect(events.find(ev => ev.ruleId === "auto.ap.over120")).toBeTruthy();
  });

  it("stamps id and createdAt on every event", () => {
    const g = mockGraph({ indices: { ...mockGraph().indices, staffingStressIndex: 75 } });
    const events = evaluateAutonomous(g);
    expect(events[0].id).toMatch(/^autoev_/);
    expect(events[0].createdAt).toBeTruthy();
    expect(events[0].dedupeKey).toBeTruthy();
  });
});

describe("evaluatePortfolioAutonomous", () => {
  it("runs rules across multiple property graphs", () => {
    const graphs = [
      mockGraph({ propertyId: "p1", indices: { ...mockGraph().indices, staffingStressIndex: 75 } }),
      mockGraph({ propertyId: "p2", indices: { ...mockGraph().indices, profitabilityPressureScore: 60 } }),
    ];
    const events = evaluatePortfolioAutonomous(graphs);
    expect(events.some(e => e.propertyId === "p1")).toBe(true);
    expect(events.some(e => e.propertyId === "p2")).toBe(true);
  });
});

describe("AUTONOMOUS_RULES catalog", () => {
  it("exposes rule metadata", () => {
    expect(AUTONOMOUS_RULES.length).toBeGreaterThanOrEqual(9);
    expect(AUTONOMOUS_RULES.every(r => r.id && r.category && r.title)).toBe(true);
  });
});
