import { describe, it, expect } from "vitest";
import {
  detectBuddyPunching, detectGhostEmployees, detectOverlappingPunches,
  detectSuspiciousOvertime, detectPayrollInflation, detectAdjustmentBypass,
  detectApprovalCollusion, detectMealBreakPattern, runPayrollForensics,
} from "./payrollForensics.js";

describe("detectBuddyPunching", () => {
  it("flags rapid same-device punches by different employees", () => {
    const shifts = [
      { id: "s1", employeeId: "e1", clockIn: "2026-05-11T08:00:00Z", punchDeviceId: "kiosk-1" },
      { id: "s2", employeeId: "e2", clockIn: "2026-05-11T08:00:30Z", punchDeviceId: "kiosk-1" },
    ];
    expect(detectBuddyPunching(shifts).length).toBeGreaterThan(0);
  });

  it("ignores punches more than 60s apart", () => {
    const shifts = [
      { id: "s1", employeeId: "e1", clockIn: "2026-05-11T08:00:00Z", punchDeviceId: "kiosk-1" },
      { id: "s2", employeeId: "e2", clockIn: "2026-05-11T08:05:00Z", punchDeviceId: "kiosk-1" },
    ];
    expect(detectBuddyPunching(shifts)).toEqual([]);
  });
});

describe("detectGhostEmployees", () => {
  it("flags employees in payroll but never punched", () => {
    const employees = [{ id: "e1", name: "A", payClass: "hourly", status: "active" }];
    const shifts = [];
    const payrollRuns = [{ id: "p1", lines: [{ employeeId: "e1", gross: 1000 }] }];
    expect(detectGhostEmployees({ employees, shifts, payrollRuns }).length).toBe(1);
  });

  it("skips salaried employees (no shifts expected)", () => {
    const employees = [{ id: "e1", payClass: "salaried", status: "active" }];
    const payrollRuns = [{ id: "p1", lines: [{ employeeId: "e1", gross: 1000 }] }];
    expect(detectGhostEmployees({ employees, shifts: [], payrollRuns })).toEqual([]);
  });
});

describe("detectOverlappingPunches", () => {
  it("flags overlapping shifts for same employee", () => {
    const shifts = [
      { id: "s1", employeeId: "e1", clockIn: "2026-05-11T08:00:00Z", clockOut: "2026-05-11T17:00:00Z" },
      { id: "s2", employeeId: "e1", clockIn: "2026-05-11T16:00:00Z", clockOut: "2026-05-11T20:00:00Z" },
    ];
    expect(detectOverlappingPunches(shifts).length).toBe(1);
  });
});

describe("detectSuspiciousOvertime", () => {
  it("flags employees repeatedly working 10h+ on same day-of-week", () => {
    // 5 consecutive Fridays; each shift is 11.5h paid (12 gross - 30min break)
    const fridays = ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29"];
    const shifts = fridays.map((d, i) => ({
      id: `s${i}`, employeeId: "e1",
      clockIn: `${d}T08:00:00Z`,
      clockOut: `${d}T20:00:00Z`,
      breakMinutes: 30,
    }));
    expect(detectSuspiciousOvertime(shifts).length).toBeGreaterThan(0);
  });
});

describe("detectPayrollInflation", () => {
  it("flags a run with gross > 1.5× trailing median", () => {
    const payrollRuns = [
      { id: "p1", periodEnd: "2026-04-15", lines: [{ gross: 10000 }] },
      { id: "p2", periodEnd: "2026-04-30", lines: [{ gross: 10500 }] },
      { id: "p3", periodEnd: "2026-05-15", lines: [{ gross: 9800 }] },
      { id: "p4", periodEnd: "2026-05-31", lines: [{ gross: 22000 }] },
    ];
    expect(detectPayrollInflation(payrollRuns).length).toBeGreaterThan(0);
  });

  it("returns empty for <4 runs", () => {
    expect(detectPayrollInflation([])).toEqual([]);
  });
});

describe("detectAdjustmentBypass", () => {
  it("flags adjustments without approver", () => {
    const adj = [{ id: "a1", code: "ADJ", amount: 100, employeeId: "e1", reason: "comp" }];
    expect(detectAdjustmentBypass(adj).some(f => f.code === "adj.no_approver")).toBe(true);
  });

  it("flags adjustments without reason", () => {
    const adj = [{ id: "a1", code: "ADJ", amount: 100, employeeId: "e1", approvedBy: "u1" }];
    expect(detectAdjustmentBypass(adj).some(f => f.code === "adj.no_reason")).toBe(true);
  });
});

describe("detectApprovalCollusion", () => {
  it("flags self-approval", () => {
    const adj = [{ id: "a1", code: "ADJ", amount: 100, employeeId: "e1", approvedBy: "e1", reason: "x" }];
    expect(detectApprovalCollusion({ payrollAdjustments: adj }).some(f => f.code === "approval.self")).toBe(true);
  });

  it("flags repeated approver-employee pairing", () => {
    const adj = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`, code: "ADJ", amount: 100, employeeId: "e1", approvedBy: "mgr1", reason: "x",
    }));
    expect(detectApprovalCollusion({ payrollAdjustments: adj }).some(f => f.code === "approval.repeat_pair")).toBe(true);
  });
});

describe("detectMealBreakPattern", () => {
  it("flags repeat meal-break violations", () => {
    const shifts = Array.from({ length: 4 }, (_, i) => ({
      id: `s${i}`, employeeId: "e1",
      clockIn: `2026-05-${String(11 + i).padStart(2, "0")}T08:00:00Z`,
      clockOut: `2026-05-${String(11 + i).padStart(2, "0")}T18:00:00Z`,
      breakMinutes: 0,
    }));
    expect(detectMealBreakPattern(shifts).length).toBeGreaterThan(0);
  });
});

describe("runPayrollForensics aggregator", () => {
  it("computes risk score and band", () => {
    const state = {
      shifts: [],
      employees: [{ id: "e1", payClass: "hourly", status: "active" }],
      payrollRuns: [{ id: "p1", lines: [{ employeeId: "e1", gross: 5000 }] }],
      payrollAdjustments: [],
    };
    const r = runPayrollForensics(state);
    expect(r.findings.length).toBeGreaterThan(0); // ghost employee finding
    expect(["clean", "low", "elevated", "high", "critical"]).toContain(r.riskBand);
  });

  it("returns clean for an empty state", () => {
    const r = runPayrollForensics({ shifts: [], employees: [], payrollRuns: [], payrollAdjustments: [] });
    expect(r.riskBand).toBe("clean");
  });
});
