import { describe, it, expect } from "vitest";
import { buildScheduleFromForecast, validateSchedule, scoreScheduleEfficiency, simulateLaborCost, tierForAdr } from "./scheduleEngine.js";
import { normalizeEmployee } from "./employeeProfile.js";

const mkEmp = (id, overrides = {}) => normalizeEmployee({
  id, name: id,
  hourlyRate: 20, payClass: "hourly",
  homeDepartment: "housekeeping",
  jobCodes: ["room_attendant"],
  i9Verified: true, w4OnFile: true,
  status: "active",
  ...overrides,
});

describe("buildScheduleFromForecast", () => {
  it("returns empty entries with no input", () => {
    expect(buildScheduleFromForecast({}).entries).toEqual([]);
  });

  it("staffs housekeeping based on occupancy and productivity target", () => {
    const employees = [mkEmp("e1"), mkEmp("e2"), mkEmp("e3"), mkEmp("e4"), mkEmp("e5"), mkEmp("e6")];
    const days = [{ date: "2026-05-15", occupancy: 0.8, capacity: 100 }];
    const r = buildScheduleFromForecast({ days, employees, opts: { tier: "midscale" } });
    // 80 rooms / 16 productivity = 5
    const hk = r.entries.filter(e => e.departmentId === "housekeeping");
    expect(hk).toHaveLength(5);
  });

  it("staffs front office with peak adjustment on heavy turn days", () => {
    const employees = [
      mkEmp("fd1", { homeDepartment: "front_office", jobCodes: ["front_desk_agent"] }),
      mkEmp("fd2", { homeDepartment: "front_office", jobCodes: ["front_desk_agent"] }),
      mkEmp("fd3", { homeDepartment: "front_office", jobCodes: ["front_desk_agent"] }),
      mkEmp("fd4", { homeDepartment: "front_office", jobCodes: ["front_desk_agent"] }),
      mkEmp("hk1"),
    ];
    const days = [{ date: "2026-05-15", occupancy: 0.95, capacity: 100, arrivals: 40, departures: 35 }];
    const r = buildScheduleFromForecast({ days, employees, opts: { tier: "midscale", frontDeskMin: 2 } });
    const fd = r.entries.filter(e => e.departmentId === "front_office");
    // Peak band = 3 + 1 for heavy turn = 4
    expect(fd.length).toBeGreaterThanOrEqual(3);
  });

  it("notes unfilled shifts when department has no employees", () => {
    const days = [{ date: "2026-05-15", occupancy: 0.5, capacity: 100 }];
    const r = buildScheduleFromForecast({ days, employees: [], opts: { tier: "midscale" } });
    expect(r.notes.length).toBeGreaterThan(0);
  });
});

describe("validateSchedule", () => {
  const employees = [
    normalizeEmployee({ id: "e1", name: "Alice", hourlyRate: 20, payClass: "hourly", homeDepartment: "housekeeping", i9Verified: true, w4OnFile: true }),
  ];

  it("flags OT projection for employees over 40 hours", () => {
    const schedule = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`, employeeId: "e1", departmentId: "housekeeping", jobCodeId: "room_attendant",
      date: `2026-05-${String(11 + i).padStart(2, "0")}`, hours: 8,
    }));
    const r = validateSchedule({ schedule, employees, weekStart: "2026-05-11", weekEnd: "2026-05-17", rule: "FLSA" });
    expect(r.issues.some(i => i.code === "ot-projected")).toBe(true);
  });

  it("flags impossible hours on a single day", () => {
    const schedule = [
      { id: "s1", employeeId: "e1", date: "2026-05-15", hours: 12 },
      { id: "s2", employeeId: "e1", date: "2026-05-15", hours: 8 },
    ];
    const r = validateSchedule({ schedule, employees });
    expect(r.issues.some(i => i.code === "impossible-hours")).toBe(true);
  });
});

describe("scoreScheduleEfficiency", () => {
  it("returns insufficient-data with empty inputs", () => {
    expect(scoreScheduleEfficiency({}).status).toBe("insufficient-data");
  });

  it("scores high when scheduled matches required", () => {
    const schedule = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, employeeId: `e${i}`, departmentId: "housekeeping",
      date: "2026-05-15", hours: 8, hourlyRate: 20,
    }));
    const occupancyDays = [{ date: "2026-05-15", occupancy: 0.7, capacity: 100 }];
    const r = scoreScheduleEfficiency({ schedule, occupancyDays, productivityTarget: 14 });
    // 70 rooms / 14 = 5 required = 5 scheduled = perfect fit
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it("penalizes understaffing", () => {
    const schedule = [{ id: "s1", employeeId: "e1", departmentId: "housekeeping", date: "2026-05-15", hours: 8 }];
    const occupancyDays = [{ date: "2026-05-15", occupancy: 0.95, capacity: 100 }];
    const r = scoreScheduleEfficiency({ schedule, occupancyDays, productivityTarget: 14 });
    expect(r.score).toBeLessThan(70);
  });
});

describe("simulateLaborCost", () => {
  it("computes total cost using OT rules", () => {
    const employees = [
      normalizeEmployee({ id: "e1", name: "A", hourlyRate: 20, payClass: "hourly", homeDepartment: "housekeeping", i9Verified: true, w4OnFile: true }),
    ];
    const schedule = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`, employeeId: "e1", departmentId: "housekeeping", jobCodeId: "room_attendant",
      date: `2026-05-${String(11 + i).padStart(2, "0")}`, hours: 8, hourlyRate: 20,
    }));
    const r = simulateLaborCost({ schedule, employees, otRule: "FLSA" });
    expect(r.totalCost).toBeGreaterThan(960); // 48h with 8h OT
    expect(r.byEmployee[0].ot).toBeGreaterThan(0);
  });
});

describe("tierForAdr", () => {
  it("classifies", () => {
    expect(tierForAdr(60)).toBe("economy");
    expect(tierForAdr(120)).toBe("upscale");
    expect(tierForAdr(300)).toBe("luxury");
  });
});
