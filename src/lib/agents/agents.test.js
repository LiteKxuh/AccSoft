import { describe, it, expect } from "vitest";
import { runAgent } from "./agentRuntime.js";
import { NIGHT_AUDIT_AGENT } from "./nightAuditAgent.js";
import { LABOR_AGENT } from "./laborAgent.js";
import { AP_REVIEW_AGENT } from "./apReviewAgent.js";
import { CONTROLLER_AGENT } from "./controllerAgent.js";
import { GM_BRIEFING_AGENT } from "./gmBriefingAgent.js";
import { REVENUE_AGENT } from "./revenueAgent.js";
import { PORTFOLIO_RISK_AGENT } from "./portfolioRiskAgent.js";
import { OWNERSHIP_BRIEFING_AGENT } from "./ownershipBriefingAgent.js";
import { FORECAST_ANALYST_AGENT } from "./forecastAnalystAgent.js";
import { AP_INTELLIGENCE_AGENT } from "./apIntelligenceAgent.js";
import { GUEST_EXPERIENCE_AGENT } from "./guestExperienceAgent.js";
import { AGENTS, agentById } from "./index.js";

const cleanReport = (date, propertyId = "p1") => ({
  id: `r_${date}_${propertyId}`, date, propertyId,
  roomsAvailable: 100, roomsSold: 70, occupancy: 0.70, adr: 120, revpar: 84, roomRevenue: 8400,
  totalRevenue: 9000,
  breakdown: {
    revenue: { rooms: 8400, fb: { restaurant: 500, bar: 100, banquet: 0 }, other: {} },
    taxes: { occupancy: 966, sales: 41.7, tourism: 126 },
    payments: { cash: 500, creditCard: 9000, directBill: 633.7 },
    cashDrop: 500,
  },
});

function seedReports(days = 30, propertyId = "p1") {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(2026, 4, 1 + i));
    return cleanReport(d.toISOString().slice(0, 10), propertyId);
  });
}

describe("agent registry", () => {
  it("exposes operational agents", () => {
    expect(AGENTS.length).toBeGreaterThanOrEqual(6);
  });

  it("agentById returns the right one", () => {
    expect(agentById("night-audit").id).toBe("night-audit");
    expect(agentById("revenue-strategy").id).toBe("revenue-strategy");
    expect(agentById("missing")).toBeNull();
  });
});

describe("runAgent — permission gate", () => {
  it("returns permission-denied when role lacks the action", async () => {
    const state = { reports: seedReports() };
    const briefing = NIGHT_AUDIT_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: NIGHT_AUDIT_AGENT, briefing, ctx: { role: "accounting-clerk" } });
    expect(r.status).toBe("permission-denied");
  });

  it("allows when role has the action", async () => {
    const state = { reports: seedReports() };
    const briefing = NIGHT_AUDIT_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: NIGHT_AUDIT_AGENT, briefing, ctx: { role: "night-auditor" } });
    expect(r.status).not.toBe("permission-denied");
    // No LLM in test env → local
    expect(r.status).toBe("local");
    expect(r.deterministic).toBeTruthy();
  });
});

describe("Night Audit Agent — deterministic", () => {
  it("recommends roll when audit passes", async () => {
    const state = { reports: seedReports() };
    const briefing = NIGHT_AUDIT_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: NIGHT_AUDIT_AGENT, briefing, ctx: { role: "night-auditor" } });
    expect(r.deterministic.rollover.safe).toBe(true);
    expect(r.narrative.verdict).toBe("safe-to-roll");
  });

  it("blocks roll when no report exists for asOf", async () => {
    const state = { reports: [] };
    const briefing = NIGHT_AUDIT_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: NIGHT_AUDIT_AGENT, briefing, ctx: { role: "night-auditor" } });
    expect(r.deterministic.rollover.safe).toBe(false);
    expect(r.deterministic.topActions[0]).toMatch(/Post tonight/);
  });
});

describe("Labor Agent — deterministic", () => {
  it("flags overspend when labor > 40% of revenue", async () => {
    // Create reports with $1000 MTD revenue but $500/day labor → ~50% labor
    const lowRevReports = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 4, 1 + i));
      return { ...cleanReport(d.toISOString().slice(0, 10), "p1"), totalRevenue: 500 };
    });
    const state = {
      reports: lowRevReports,
      shifts: Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`, propertyId: "p1", employeeId: "e1",
        clockIn: new Date(Date.UTC(2026, 4, 1 + i, 8)).toISOString(),
        clockOut: new Date(Date.UTC(2026, 4, 1 + i, 20)).toISOString(),
        payRate: 30,
      })),
      employees: [{ id: "e1", name: "A", title: "Manager", hourlyRate: 30 }],
    };
    const briefing = LABOR_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-30" });
    expect(briefing.mtdPctRev).toBeGreaterThan(0.40);
    const r = await runAgent({ agent: LABOR_AGENT, briefing, ctx: { role: "gm" } });
    expect(r.deterministic.findings.some(f => /Labor/.test(f))).toBe(true);
  });

  it("returns nothing when revenue is zero", async () => {
    const state = { reports: [] };
    const briefing = LABOR_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: LABOR_AGENT, briefing, ctx: { role: "gm" } });
    expect(r.deterministic.recommendations.length).toBe(0);
  });
});

describe("AP Review Agent — deterministic", () => {
  it("flags duplicate invoices", async () => {
    const state = {
      invoices: [
        { id: "a", vendorId: "v1", number: "INV-1", amount: 500, status: "open", issuedDate: "2026-05-01", approvalState: "approved", propertyId: "p1" },
        { id: "b", vendorId: "v1", number: "INV-1", amount: 500, status: "open", issuedDate: "2026-05-02", approvalState: "approved", propertyId: "p1" },
      ],
      vendors: [{ id: "v1", name: "X" }],
    };
    const briefing = AP_REVIEW_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: AP_REVIEW_AGENT, briefing, ctx: { role: "controller" } });
    expect(r.deterministic.findings.length).toBeGreaterThan(0);
    expect(r.narrative.verdict).toBe("partial-hold");
  });

  it("approves clean AP", async () => {
    const state = { invoices: [], vendors: [] };
    const briefing = AP_REVIEW_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: AP_REVIEW_AGENT, briefing, ctx: { role: "controller" } });
    expect(r.narrative.verdict).toBe("ok-to-pay");
  });
});

describe("Controller Agent — deterministic", () => {
  it("flags chain health gaps", async () => {
    const state = {
      journalEntries: [
        { id: "j1", date: "2026-05-01", propertyId: "p1", posted: true, void: false, lines: [{ debit: 100, credit: 0, accountCode: "1010" }, { debit: 0, credit: 100, accountCode: "4110" }] },
      ],
      invoices: [],
    };
    const briefing = CONTROLLER_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: CONTROLLER_AGENT, briefing, ctx: { role: "controller" } });
    expect(r.deterministic.findings.some(f => /chain hash/.test(f))).toBe(true);
  });
});

describe("GM Briefing Agent — deterministic", () => {
  it("produces a structured local brief with bullets", async () => {
    const state = { reports: seedReports() };
    const briefing = GM_BRIEFING_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: GM_BRIEFING_AGENT, briefing, ctx: { role: "gm" } });
    expect(r.status).toBe("local");
    expect(r.narrative.bullets.length).toBeGreaterThan(0);
  });
});

describe("Revenue Agent — deterministic", () => {
  it("flags missing pace history", async () => {
    const state = { reports: seedReports(7) };
    const briefing = REVENUE_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-07" });
    const r = await runAgent({ agent: REVENUE_AGENT, briefing, ctx: { role: "revenue-manager" } });
    expect(r.deterministic.recommendations[0].action).toMatch(/Insufficient/);
  });
});

describe("Portfolio Risk Agent — deterministic", () => {
  it("ranks worst-risk properties", async () => {
    const dup = (n, pid) => ({
      id: `inv_${pid}_${n}`, propertyId: pid, vendorId: "v1", amount: 1500,
      number: "INV-001", issuedDate: "2026-05-10", dueDate: "2026-05-30",
      status: "open",
    });
    const state = {
      reports: seedReports(14, "p1"),
      invoices: [dup(1, "p1"), dup(2, "p1"), dup(1, "p2")],
    };
    const briefing = PORTFOLIO_RISK_AGENT.buildBriefing({ state, propertyIds: ["p1", "p2"], asOf: "2026-05-14", period: { start: "2026-05-01", end: "2026-05-14" } });
    expect(briefing.perProperty.length).toBe(2);
    const r = await runAgent({ agent: PORTFOLIO_RISK_AGENT, briefing, ctx: { role: "controller" } });
    expect(r.status).toBe("local");
    expect(r.narrative.topRisks.length).toBeGreaterThan(0);
  });
});

describe("Ownership Briefing Agent — deterministic", () => {
  it("returns performance bullets with reports", async () => {
    const state = { reports: seedReports(14, "p1") };
    const briefing = OWNERSHIP_BRIEFING_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-14" });
    const r = await runAgent({ agent: OWNERSHIP_BRIEFING_AGENT, briefing, ctx: { role: "ownership" } });
    expect(r.narrative.performance.length).toBeGreaterThan(0);
  });

  it("emits no performance bullets without data", async () => {
    const state = { reports: [] };
    const briefing = OWNERSHIP_BRIEFING_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-14" });
    const r = await runAgent({ agent: OWNERSHIP_BRIEFING_AGENT, briefing, ctx: { role: "ownership" } });
    expect(r.narrative.performance.length).toBe(0);
  });
});

describe("Forecast Analyst Agent — deterministic", () => {
  it("notes insufficient history with no forecasts", async () => {
    const state = { reports: seedReports(14, "p1"), forecasts: [] };
    const briefing = FORECAST_ANALYST_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-14" });
    const r = await runAgent({ agent: FORECAST_ANALYST_AGENT, briefing, ctx: { role: "revenue-manager" } });
    expect(r.deterministic.findings[0]).toMatch(/forecast history/);
  });
});

describe("AP Intelligence Agent — deterministic", () => {
  it("flags duplicates and aging exposure together", async () => {
    const old = new Date("2026-05-15"); old.setDate(old.getDate() - 130);
    const state = {
      invoices: [
        { id: "a", vendorId: "v1", number: "INV-1", amount: 500, status: "open", issuedDate: "2026-05-01", approvalState: "approved", propertyId: "p1" },
        { id: "b", vendorId: "v1", number: "INV-1", amount: 500, status: "open", issuedDate: "2026-05-02", approvalState: "approved", propertyId: "p1" },
        { id: "c", vendorId: "v1", number: "OLD", amount: 60_000, status: "open", issuedDate: old.toISOString().slice(0, 10), dueDate: old.toISOString().slice(0, 10), approvalState: "approved", propertyId: "p1" },
      ],
      vendors: [{ id: "v1", name: "X" }],
    };
    const briefing = AP_INTELLIGENCE_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-15" });
    const r = await runAgent({ agent: AP_INTELLIGENCE_AGENT, briefing, ctx: { role: "controller" } });
    expect(r.deterministic.findings.some(f => /duplicate/.test(f))).toBe(true);
    expect(r.deterministic.findings.some(f => /120 days/.test(f))).toBe(true);
  });
});

describe("Guest Experience Agent — deterministic", () => {
  it("returns no-feedback summary cleanly", async () => {
    const state = { reports: seedReports(14, "p1"), guestFeedback: [] };
    const briefing = GUEST_EXPERIENCE_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-14" });
    const r = await runAgent({ agent: GUEST_EXPERIENCE_AGENT, briefing, ctx: { role: "gm" } });
    expect(r.deterministic.findings[0]).toMatch(/No guest feedback/);
  });

  it("flags housekeeping when complaints concentrate there", async () => {
    const state = {
      reports: seedReports(14, "p1"),
      guestFeedback: [
        { id: "g1", propertyId: "p1", date: "2026-05-10", rating: 2, text: "dirty room, stained linen, mildew smell" },
        { id: "g2", propertyId: "p1", date: "2026-05-11", rating: 1, text: "filthy room, hair on bedding, terrible" },
        { id: "g3", propertyId: "p1", date: "2026-05-12", rating: 2, text: "dirty bathroom, awful" },
        { id: "g4", propertyId: "p1", date: "2026-05-13", rating: 1, text: "mildew, dirty, disgusting" },
      ],
    };
    const briefing = GUEST_EXPERIENCE_AGENT.buildBriefing({ state, propertyId: "p1", asOf: "2026-05-14", period: { start: "2026-05-01", end: "2026-05-14" } });
    const r = await runAgent({ agent: GUEST_EXPERIENCE_AGENT, briefing, ctx: { role: "gm" } });
    expect(r.deterministic.findings.some(f => /housekeeping/.test(f))).toBe(true);
  });
});
