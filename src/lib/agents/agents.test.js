import { describe, it, expect } from "vitest";
import { runAgent } from "./agentRuntime.js";
import { NIGHT_AUDIT_AGENT } from "./nightAuditAgent.js";
import { LABOR_AGENT } from "./laborAgent.js";
import { AP_REVIEW_AGENT } from "./apReviewAgent.js";
import { CONTROLLER_AGENT } from "./controllerAgent.js";
import { GM_BRIEFING_AGENT } from "./gmBriefingAgent.js";
import { REVENUE_AGENT } from "./revenueAgent.js";
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
