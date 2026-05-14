import { describe, it, expect } from "vitest";
import {
  normalizePunch, computeShiftHours, detectMissedPunches,
  detectOvertimeRisk, buildExceptionQueue, approveShiftEdit,
} from "./timeAttendance.js";

const ci = (day, hour) => new Date(Date.UTC(2026, 4, day, hour)).toISOString();

describe("normalizePunch", () => {
  it("rejects empty record", () => {
    expect(() => normalizePunch(null)).toThrow();
  });

  it("rejects invalid clockIn", () => {
    expect(() => normalizePunch({ clockIn: "not a date" })).toThrow();
  });

  it("auto-bumps clockOut by 24h for overnight rollover", () => {
    const raw = {
      id: "p1", employeeId: "e1",
      clockIn: "2026-05-11T22:00:00Z",
      clockOut: "2026-05-11T06:00:00Z", // earlier than clockIn → overnight
    };
    const punch = normalizePunch(raw);
    expect(new Date(punch.clockOut).getUTCDate()).toBe(12);
  });

  it("throws on clockOut before clockIn beyond rollover window", () => {
    expect(() => normalizePunch({
      id: "p1", employeeId: "e1",
      clockIn: "2026-05-11T22:00:00Z",
      clockOut: "2026-05-10T06:00:00Z",
    })).toThrow();
  });
});

describe("computeShiftHours", () => {
  it("subtracts break minutes", () => {
    const r = computeShiftHours({ clockIn: ci(11, 8), clockOut: ci(11, 17), breakMinutes: 30 });
    expect(r.gross).toBe(9);
    expect(r.paid).toBe(8.5);
  });

  it("flags meal-break violation on long shift without break", () => {
    const r = computeShiftHours({ clockIn: ci(11, 8), clockOut: ci(11, 18), breakMinutes: 0 });
    expect(r.mealCompliance).toBe("violation");
  });

  it("compliant when break >= 30 min on long shift", () => {
    const r = computeShiftHours({ clockIn: ci(11, 8), clockOut: ci(11, 18), breakMinutes: 30 });
    expect(r.mealCompliance).toBe("compliant");
  });

  it("returns n/a for short shift", () => {
    const r = computeShiftHours({ clockIn: ci(11, 8), clockOut: ci(11, 12) });
    expect(r.mealCompliance).toBe("n/a");
  });

  it("identifies overnight shifts", () => {
    const r = computeShiftHours({ clockIn: "2026-05-11T22:00:00Z", clockOut: "2026-05-12T06:00:00Z" });
    expect(r.overnight).toBe(true);
  });
});

describe("detectMissedPunches", () => {
  const asOf = new Date(Date.UTC(2026, 4, 12, 12));

  it("flags missing clockOut beyond 16h", () => {
    const shifts = [{ id: "s1", clockIn: "2026-05-11T08:00:00Z", clockOut: null }];
    const issues = detectMissedPunches(shifts, asOf);
    expect(issues.some(i => i.issue === "missed-clock-out")).toBe(true);
  });

  it("flags implausible duration", () => {
    const shifts = [{ id: "s1", clockIn: "2026-05-11T08:00:00Z", clockOut: "2026-05-12T08:00:00Z" }];
    const issues = detectMissedPunches(shifts, asOf);
    expect(issues.some(i => i.issue === "implausible-duration")).toBe(true);
  });

  it("flags meal-break violation", () => {
    const shifts = [{ id: "s1", clockIn: "2026-05-11T08:00:00Z", clockOut: "2026-05-11T18:00:00Z", breakMinutes: 0 }];
    const issues = detectMissedPunches(shifts, asOf);
    expect(issues.some(i => i.issue === "meal-break-violation")).toBe(true);
  });
});

describe("detectOvertimeRisk", () => {
  it("flags risk when employee is over 40 hours", () => {
    const shifts = [];
    for (let d = 11; d <= 16; d++) {
      shifts.push({
        id: `s${d}`, employeeId: "e1",
        clockIn: ci(d, 8), clockOut: ci(d, 17), breakMinutes: 30,
      });
    }
    const r = detectOvertimeRisk({
      shifts, employee: { id: "e1", hourlyRate: 20 },
      periodStart: "2026-05-11", periodEnd: "2026-05-17",
    });
    expect(r.risk).toBe("yes");
    expect(r.split.ot).toBeGreaterThan(0);
  });
});

describe("buildExceptionQueue", () => {
  it("returns severity-ranked items", () => {
    const shifts = [
      { id: "s1", employeeId: "e1", clockIn: "2026-05-11T08:00:00Z", clockOut: null },
    ];
    const queue = buildExceptionQueue(shifts, new Date(Date.UTC(2026, 4, 12, 12)));
    expect(queue.length).toBe(1);
    expect(queue[0].severity).toBe("high");
  });
});

describe("approveShiftEdit — audit-safe", () => {
  it("appends to history", () => {
    const shift = { id: "s1", employeeId: "e1", clockIn: "2026-05-11T08:00:00Z", clockOut: "2026-05-11T17:00:00Z", breakMinutes: 30 };
    const edited = approveShiftEdit(shift, { clockOut: "2026-05-11T18:00:00Z", reason: "manager-correction" }, { id: "u1" });
    expect(edited.history).toHaveLength(1);
    expect(edited.history[0].by).toBe("u1");
    expect(edited.history[0].reason).toBe("manager-correction");
    expect(edited.clockOut).toBe("2026-05-11T18:00:00Z");
  });
});
