import { describe, it, expect } from "vitest";
import {
  roomsPerAttendant, schedulesEfficiency, overtimePredictor,
  occupancyDrivenStaffing, scheduleSimulation, PROD_BENCHMARKS,
} from "./laborOptimization.js";

describe("roomsPerAttendant", () => {
  it("computes industry metric and verdict", () => {
    const r = roomsPerAttendant({ housekeepingHours: 8, roomsCleaned: 16, tier: "midscale" });
    expect(r.roomsPerShift).toBeCloseTo(16, 1);
    expect(r.verdict).toBe("above-target");
  });

  it("flags below-target productivity", () => {
    const r = roomsPerAttendant({ housekeepingHours: 16, roomsCleaned: 12, tier: "midscale" });
    expect(r.verdict).toBe("below-target");
  });

  it("returns missing-input on bad call", () => {
    expect(roomsPerAttendant({}).status).toBe("missing-input");
  });

  it("benchmarks differ by tier — luxury target lower than economy", () => {
    expect(PROD_BENCHMARKS.luxury.target).toBeLessThan(PROD_BENCHMARKS.economy.target);
  });
});

describe("schedulesEfficiency", () => {
  it("returns missing-schedule when no scheduled hours", () => {
    expect(schedulesEfficiency({ scheduleHours: 0, actualHours: 100 }).status).toBe("missing-schedule");
  });

  it("scores high when actual ≈ scheduled", () => {
    const r = schedulesEfficiency({ scheduleHours: 100, actualHours: 102 });
    // No occupancy data → demandFit defaults to 70 (neutral); blended score reflects only drift quality
    expect(r.driftScore).toBeGreaterThanOrEqual(90);
    expect(r.score).toBeGreaterThanOrEqual(75);
  });

  it("scores low on heavy drift", () => {
    const r = schedulesEfficiency({ scheduleHours: 100, actualHours: 150 });
    expect(r.score).toBeLessThan(50);
  });
});

describe("overtimePredictor", () => {
  it("flags employees projecting > 40 hours", () => {
    const monday = new Date(Date.UTC(2026, 4, 11));
    const start = monday.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2026, 4, 17)).toISOString().slice(0, 10);
    const shifts = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(2026, 4, 11 + i));
      shifts.push({
        id: `s${i}`, employeeId: "e1",
        clockIn: new Date(d.getTime() + 8 * 3600_000).toISOString(),
        clockOut: new Date(d.getTime() + 17 * 3600_000).toISOString(),
      });
    }
    const preds = overtimePredictor({ shifts, employees: [{ id: "e1", name: "A" }], weekStart: start, weekEnd: end });
    expect(preds[0].overTimeRisk).toBe("yes");
    expect(preds[0].otHoursProjected).toBeGreaterThan(0);
  });
});

describe("occupancyDrivenStaffing", () => {
  it("rounds up housekeeping headcount", () => {
    const r = occupancyDrivenStaffing({ forecastOcc: 0.75, capacity: 100, tier: "midscale" });
    // 75 rooms / 13 target = 6
    expect(r.headcount).toBe(6);
    expect(r.totalHours).toBe(48);
  });

  it("returns 0 headcount for zero occupancy", () => {
    const r = occupancyDrivenStaffing({ forecastOcc: 0, capacity: 100 });
    expect(r.headcount).toBe(0);
  });
});

describe("scheduleSimulation", () => {
  it("estimates total cost and fit vs forecast occupancy", () => {
    const schedule = [
      { date: "2026-05-15", employeeId: "e1", hours: 8 },
      { date: "2026-05-15", employeeId: "e2", hours: 8 },
      { date: "2026-05-16", employeeId: "e1", hours: 8 },
    ];
    const employees = [
      { id: "e1", hourlyRate: 20 },
      { id: "e2", hourlyRate: 22 },
    ];
    const occupancyDays = [
      { date: "2026-05-15", occupancy: 0.80, capacity: 100 },
      { date: "2026-05-16", occupancy: 0.50, capacity: 100 },
    ];
    const r = scheduleSimulation({ schedule, employees, occupancyDays, productivityTarget: 14 });
    expect(r.lines).toHaveLength(2);
    // 2 attendants vs 6 required on 80% occupancy → understaffed
    expect(r.lines[0].fit).toBe(2 - 6);
    expect(r.totalCost).toBeGreaterThan(0);
  });
});
