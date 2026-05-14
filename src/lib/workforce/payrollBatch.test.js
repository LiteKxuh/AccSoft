import { describe, it, expect, beforeEach } from "vitest";
import { buildBatch, approveBatch, reopenBatch } from "./payrollBatch.js";
import { makePayGroup } from "./payPeriods.js";

beforeEach(() => {
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.clear?.();
  }
  globalThis.__hotelops_idemp = {};
});

const ci = (day, hour) => new Date(Date.UTC(2026, 4, day, hour)).toISOString();

const mkEmployee = (overrides = {}) => ({
  id: "e1", name: "Alice", payClass: "hourly", hourlyRate: 20,
  homeDepartment: "housekeeping",
  i9Verified: true, w4OnFile: true,
  status: "active",
  ...overrides,
});

const mkShift = (employeeId, day, hours = 8) => ({
  id: `s_${employeeId}_${day}`, employeeId,
  clockIn: ci(day, 8),
  clockOut: ci(day, 8 + hours),
  breakMinutes: 0,
  departmentId: "housekeeping",
  jobCodeId: "room_attendant",
  hourlyRate: 20,
});

describe("buildBatch", () => {
  it("requires a payGroup and period", () => {
    expect(() => buildBatch({})).toThrow();
    const g = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04" });
    expect(() => buildBatch({ payGroup: g })).toThrow();
  });

  it("aggregates hours and produces pay-code lines per employee", () => {
    const g = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04" });
    const state = {
      employees: [mkEmployee()],
      shifts: Array.from({ length: 5 }, (_, i) => mkShift("e1", 11 + i, 8)),
    };
    const r = buildBatch({ state, payGroup: g, periodStart: "2026-05-11", periodEnd: "2026-05-17" });
    expect(r.perEmployee).toHaveLength(1);
    const row = r.perEmployee[0];
    expect(row.gross).toBeGreaterThan(0);
    expect(row.lines.some(l => l.code === "REG")).toBe(true);
    expect(row.allocations).toHaveLength(1);
    expect(row.allocations[0].departmentId).toBe("housekeeping");
  });

  it("computes OT for 6×8h schedules under FLSA", () => {
    const g = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04" });
    const state = {
      employees: [mkEmployee()],
      shifts: Array.from({ length: 6 }, (_, i) => mkShift("e1", 11 + i, 8)),
    };
    const r = buildBatch({ state, payGroup: g, periodStart: "2026-05-11", periodEnd: "2026-05-17", otRule: "FLSA" });
    const row = r.perEmployee[0];
    expect(row.hours.ot).toBe(8);
    expect(row.lines.find(l => l.code === "OT")).toBeTruthy();
  });

  it("includes salaried employees pro-rata", () => {
    const g = makePayGroup({ id: "g1", frequency: "biweekly", anchorDate: "2026-05-04" });
    const state = {
      employees: [mkEmployee({ id: "e2", payClass: "salaried", salary: 52_000, homeDepartment: "executive", hourlyRate: 0 })],
      shifts: [],
    };
    const r = buildBatch({ state, payGroup: g, periodStart: "2026-05-04", periodEnd: "2026-05-17" });
    expect(r.perEmployee).toHaveLength(1);
    expect(r.perEmployee[0].gross).toBeGreaterThan(0);
  });

  it("captures payroll adjustments (PTO, bonus, tips)", () => {
    const g = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04" });
    const state = {
      employees: [mkEmployee()],
      shifts: Array.from({ length: 4 }, (_, i) => mkShift("e1", 11 + i, 8)),
      payrollAdjustments: [
        { employeeId: "e1", periodStart: "2026-05-11", periodEnd: "2026-05-17", code: "PTO", hours: 8 },
        { employeeId: "e1", periodStart: "2026-05-11", periodEnd: "2026-05-17", code: "BONUS", amount: 250 },
      ],
    };
    const r = buildBatch({ state, payGroup: g, periodStart: "2026-05-11", periodEnd: "2026-05-17" });
    const row = r.perEmployee[0];
    expect(row.lines.find(l => l.code === "PTO")).toBeTruthy();
    expect(row.lines.find(l => l.code === "BONUS")).toBeTruthy();
  });
});

describe("approveBatch / reopenBatch", () => {
  it("approves a draft batch", () => {
    const state = { payrollBatches: [{ id: "b1", status: "draft" }] };
    const patch = approveBatch(state, "b1", { id: "u1" });
    expect(patch.payrollBatches[0].status).toBe("approved");
  });

  it("refuses to approve an already-exported batch", () => {
    const state = { payrollBatches: [{ id: "b1", status: "exported" }] };
    expect(() => approveBatch(state, "b1", { id: "u1" })).toThrow();
  });

  it("re-opens a draft batch", () => {
    const state = { payrollBatches: [{ id: "b1", status: "approved" }] };
    const patch = reopenBatch(state, "b1", { id: "u1" });
    expect(patch.payrollBatches[0].status).toBe("draft");
  });

  it("refuses to reopen a posted batch", () => {
    const state = { payrollBatches: [{ id: "b1", status: "posted" }] };
    expect(() => reopenBatch(state, "b1", { id: "u1" })).toThrow();
  });
});
