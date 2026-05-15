import { describe, it, expect } from "vitest";
import {
  buildOperationalGraph,
  buildPortfolioGraph,
  kernelOvernightDelta,
  kernelKpiRollup,
} from "./hotelOperatingKernel.js";

function mkReport(date, propertyId, vals = {}) {
  return {
    id: `rep_${propertyId}_${date}`,
    date,
    propertyId,
    roomsAvailable: vals.roomsAvailable ?? 100,
    roomsSold: vals.roomsSold ?? 70,
    totalRevenue: vals.totalRevenue ?? 9000,
    adr: vals.adr ?? 120,
    occupancy: (vals.roomsSold ?? 70) / (vals.roomsAvailable ?? 100),
    revpar: ((vals.roomsSold ?? 70) * (vals.adr ?? 120)) / (vals.roomsAvailable ?? 100),
    breakdown: {
      revenue: {
        rooms: (vals.roomsSold ?? 70) * (vals.adr ?? 120),
        fb: { restaurant: vals.fb ?? 500 },
        other: { parking: 100 },
      },
    },
  };
}

function je(date, lines, propertyId = "p1", id = null) {
  return {
    id: id || `je_${date}_${propertyId}_${Math.random().toString(36).slice(2, 8)}`,
    date,
    propertyId,
    posted: true,
    void: false,
    approvalState: "approved",
    chain: { hash: "x".repeat(64), prev: null },
    lines,
  };
}

function baseState() {
  const reports = [];
  // 14 days of reports for p1
  for (let i = 0; i < 14; i++) {
    const d = new Date("2026-05-14"); d.setDate(d.getDate() - i);
    reports.push(mkReport(d.toISOString().slice(0, 10), "p1"));
  }
  return {
    properties: [{ id: "p1", name: "Test Hotel" }],
    reports,
    journalEntries: [],
    invoices: [],
    vendors: [],
    employees: [],
    payrollRuns: [],
    shifts: [],
    schedule: [],
    capexProjects: [],
    chartOfAccounts: [],
    ownerships: [],
    budgets: [],
  };
}

describe("buildOperationalGraph", () => {
  it("returns missing-input without required opts", () => {
    expect(buildOperationalGraph({}, {}).status).toBe("missing-input");
  });

  it("returns no-reports if property has no data", () => {
    const r = buildOperationalGraph({ reports: [] }, { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.status).toBe("no-reports");
  });

  it("produces all five indices with valid state", () => {
    const r = buildOperationalGraph(baseState(), { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.indices.hotelHealthIndex).toBeGreaterThanOrEqual(0);
    expect(r.indices.hotelHealthIndex).toBeLessThanOrEqual(100);
    expect(r.indices.staffingStressIndex).toBeGreaterThanOrEqual(0);
    expect(r.indices.guestRiskIndex).toBeGreaterThanOrEqual(0);
    expect(r.indices.operationalRiskScore).toBeGreaterThanOrEqual(0);
    expect(r.indices.profitabilityPressureScore).toBeGreaterThanOrEqual(0);
  });

  it("flags A/P over 120 as pressure point", () => {
    const state = baseState();
    state.vendors = [{ id: "v1", name: "Acme" }];
    // Invoice 130 days old, unpaid
    const old = new Date("2026-05-14"); old.setDate(old.getDate() - 130);
    state.invoices = [{
      id: "inv1", propertyId: "p1", vendorId: "v1",
      amount: 5000, status: "open",
      issuedDate: old.toISOString().slice(0, 10),
      dueDate: old.toISOString().slice(0, 10),
    }];
    const r = buildOperationalGraph(state, { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.pressurePoints.some(p => p.code === "ap.over120")).toBe(true);
  });

  it("emits coordination signals for F&B overrun", () => {
    const state = baseState();
    // F&B rev in base = 14 days × $500 = $7,000. Post $3,500 in 6010 → COGS 50%, target 30% → over.
    state.journalEntries = [
      je("2026-05-10", [
        { accountCode: "6010", debit: 3500, credit: 0 },
        { accountCode: "1020", debit: 0, credit: 3500 },
      ]),
    ];
    const r = buildOperationalGraph(state, { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.costIntel.fnb.verdict).toBe("over-target");
    const hasFbSignal = r.coordination.some(c => c.dept === "fb")
                     || r.pressurePoints.some(p => p.code === "fnb.overrun");
    expect(hasFbSignal).toBe(true);
  });
});

describe("buildPortfolioGraph", () => {
  it("rolls up across properties with ranking", () => {
    const state = baseState();
    state.properties.push({ id: "p2", name: "Hotel Two" });
    // Add reports for p2
    for (let i = 0; i < 14; i++) {
      const d = new Date("2026-05-14"); d.setDate(d.getDate() - i);
      state.reports.push(mkReport(d.toISOString().slice(0, 10), "p2", { roomsSold: 90 }));
    }
    const r = buildPortfolioGraph(state, { propertyIds: ["p1", "p2"], asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.coverage.ok).toBe(2);
    expect(r.portfolio.hotelHealthIndex).toBeGreaterThan(0);
    expect(r.ranking.top.length).toBeGreaterThan(0);
    expect(r.ranking.bottom.length).toBeGreaterThan(0);
  });

  it("returns no-data when no properties resolve", () => {
    const r = buildPortfolioGraph({ reports: [] }, { propertyIds: ["p1"], asOf: "2026-05-14" });
    expect(r.status).toBe("no-data");
  });
});

describe("kernelOvernightDelta", () => {
  it("produces index deltas with sufficient history", () => {
    const r = kernelOvernightDelta(baseState(), { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.indexDelta.hotelHealthIndex).toBeDefined();
  });
});

describe("kernelKpiRollup", () => {
  it("computes canonical KPIs via the registry", () => {
    const r = kernelKpiRollup(baseState(), { propertyId: "p1", asOf: "2026-05-14" });
    expect(r.status).toBe("ok");
    expect(r.occupancy.value).toBeCloseTo(0.7, 5);
    expect(r.adr.value).toBe(120);
  });
});
