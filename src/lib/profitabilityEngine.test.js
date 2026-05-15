import { describe, it, expect } from "vitest";
import {
  analyzeGopOptimization, detectMarginLeakage, scoreDepartmentalEfficiency,
  scoreLaborProductivity, analyzeOtaProfitability, rankProfitOpportunities,
  runProfitability,
} from "./profitabilityEngine.js";

function je(date, lines, propertyId = "p1") {
  return {
    id: `je_${date}_${Math.random().toString(36).slice(2, 8)}`,
    date, propertyId,
    posted: true, void: false,
    lines,
  };
}

function mkReport(date, propertyId, vals = {}) {
  return {
    date, propertyId,
    roomsAvailable: vals.roomsAvailable ?? 100,
    roomsSold: vals.roomsSold ?? 70,
    adr: vals.adr ?? 120,
    totalRevenue: vals.totalRevenue ?? 9000,
    breakdown: vals.breakdown ?? null,
  };
}

describe("analyzeGopOptimization", () => {
  it("returns no-revenue with empty input", () => {
    expect(analyzeGopOptimization({}).status).toBe("no-revenue");
  });

  it("classifies tier and surfaces over-benchmark lines", () => {
    const reports = [mkReport("2026-05-10", "p1", { adr: 120, totalRevenue: 100_000 })];
    // F&B at $35k (35%) vs midscale benchmark 30% → over
    const ledger = [
      je("2026-05-10", [{ accountCode: "6010", debit: 35_000, credit: 0 }, { accountCode: "1020", debit: 0, credit: 35_000 }]),
    ];
    const r = analyzeGopOptimization({ ledger, reports, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" }, laborCost: 28_000 });
    expect(r.status).toBe("ok");
    expect(r.tier).toBe("upscale");
    const fb = r.lines.find(l => l.line === "fbCogs");
    expect(fb.overUnderPct).toBeGreaterThan(0);
  });
});

describe("detectMarginLeakage", () => {
  it("returns ok with empty state", () => {
    expect(detectMarginLeakage({}).status).toBe("ok");
  });
});

describe("scoreDepartmentalEfficiency", () => {
  it("flags underperforming departments", () => {
    const reports = [mkReport("2026-05-10", "p1", { adr: 120, totalRevenue: 100_000 })];
    // F&B at $50k (50%) vs midscale benchmark 30% → very underperforming
    const ledger = [
      je("2026-05-10", [{ accountCode: "6010", debit: 50_000, credit: 0 }, { accountCode: "1020", debit: 0, credit: 50_000 }]),
    ];
    const r = scoreDepartmentalEfficiency({ ledger, reports, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" }, laborCost: 28_000 });
    expect(r.status).toBe("ok");
    expect(r.departments.find(d => d.line === "fbCogs").status).toBe("underperforming");
  });
});

describe("scoreLaborProductivity", () => {
  it("returns insufficient-data without shifts", () => {
    expect(scoreLaborProductivity({}).status).toBe("insufficient-data");
  });

  it("computes rooms-per-labor-hour", () => {
    const shifts = [];
    for (let i = 0; i < 10; i++) {
      const date = `2026-05-${String(i + 1).padStart(2, "0")}`;
      shifts.push({
        id: `s${i}`, propertyId: "p1",
        clockIn: `${date}T08:00:00Z`,
        clockOut: `${date}T16:00:00Z`,
      });
    }
    const reports = [];
    for (let i = 0; i < 10; i++) {
      const date = `2026-05-${String(i + 1).padStart(2, "0")}`;
      reports.push(mkReport(date, "p1", { roomsSold: 50 }));
    }
    const r = scoreLaborProductivity({ shifts, reports, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" } });
    expect(r.status).toBe("ok");
    expect(r.totalHours).toBe(80);
    expect(r.totalRooms).toBe(500);
    expect(r.roomsPerLaborHour).toBeCloseTo(6.25, 2);
  });
});

describe("analyzeOtaProfitability", () => {
  it("returns no-segment-data when reports have no segments", () => {
    const reports = [mkReport("2026-05-10", "p1")];
    expect(analyzeOtaProfitability({ reports }).status).toBe("no-segment-data");
  });

  it("computes shift opportunity savings", () => {
    const reports = [{
      date: "2026-05-10", propertyId: "p1",
      breakdown: { segments: {
        ota: { revenue: 100_000, roomNights: 800 },
        direct: { revenue: 50_000, roomNights: 400 },
      } },
    }];
    const r = analyzeOtaProfitability({ reports });
    expect(r.status).toBe("ok");
    expect(r.shiftOpportunity.savings).toBeGreaterThan(0);
  });
});

describe("rankProfitOpportunities", () => {
  it("ranks opportunities high-severity first", () => {
    const reports = [{
      date: "2026-05-10", propertyId: "p1",
      adr: 120, totalRevenue: 100_000,
      breakdown: { segments: {
        ota: { revenue: 100_000, roomNights: 800 },
        direct: { revenue: 10_000, roomNights: 100 },
      } },
    }];
    const ledger = [
      je("2026-05-10", [{ accountCode: "6010", debit: 50_000, credit: 0 }, { accountCode: "1020", debit: 0, credit: 50_000 }]),
    ];
    const r = rankProfitOpportunities({ ledger, reports, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" }, laborCost: 28_000 });
    expect(r.status).toBe("ok");
    expect(r.opportunities.length).toBeGreaterThan(0);
    if (r.opportunities.length >= 2) {
      const sevRank = { high: 3, medium: 2, low: 1 };
      expect(sevRank[r.opportunities[0].severity]).toBeGreaterThanOrEqual(sevRank[r.opportunities[r.opportunities.length - 1].severity]);
    }
  });
});

describe("runProfitability aggregator", () => {
  it("returns all sub-modules", () => {
    const state = {
      reports: [mkReport("2026-05-10", "p1", { adr: 120, totalRevenue: 100_000 })],
      journalEntries: [
        je("2026-05-10", [{ accountCode: "6010", debit: 25_000, credit: 0 }, { accountCode: "1020", debit: 0, credit: 25_000 }]),
      ],
      shifts: [],
    };
    const r = runProfitability({ state, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-31" }, laborCost: 25_000 });
    expect(r.gop).toBeTruthy();
    expect(r.marginLeakage).toBeTruthy();
    expect(r.departmentalEfficiency).toBeTruthy();
    expect(r.opportunities).toBeTruthy();
  });
});
