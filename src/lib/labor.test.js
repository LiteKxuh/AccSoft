import { describe, it, expect } from "vitest";
import {
  classifyEmployeeDepartment,
  computeHours,
  computeLaborCost,
  laborKPIs,
  productivityByDept,
  scheduleVsActual,
} from "./labor.js";

const empA = { id: "e1", firstName: "Ana", lastName: "Smith", title: "Front Desk Agent", hourlyRate: 18 };
const empB = { id: "e2", firstName: "Bo", lastName: "Liu", title: "Line Cook", hourlyRate: 22 };
const empC = { id: "e3", firstName: "Cy", lastName: "Park", title: "Maintenance Engineer", hourlyRate: 28 };

const shifts = [
  { id: "s1", employeeId: "e1", clockIn: "2026-04-01T08:00:00Z", clockOut: "2026-04-01T16:00:00Z" }, // 8h
  { id: "s2", employeeId: "e2", clockIn: "2026-04-01T15:00:00Z", clockOut: "2026-04-01T23:00:00Z" }, // 8h
  { id: "s3", employeeId: "e3", clockIn: "2026-04-02T07:00:00Z", clockOut: "2026-04-02T15:30:00Z" }, // 8.5h
];
const schedule = [
  { id: "x1", employeeId: "e1", date: "2026-04-01", startTime: "08:00", endTime: "16:00" },
  { id: "x2", employeeId: "e2", date: "2026-04-01", startTime: "15:00", endTime: "22:00" }, // 7h scheduled vs 8h actual
];
const reports = [
  { date: "2026-04-01", propertyId: "p1", rooms: { sold: 60, available: 80 }, revenue: { rooms: 9000, fb: { restaurant: 1200, bar: 600 }, other: { parking: 100 } } },
  { date: "2026-04-02", propertyId: "p1", rooms: { sold: 55, available: 80 }, revenue: { rooms: 8200, fb: { restaurant: 800, bar: 400 }, other: {} } },
];

describe("labor analytics", () => {
  it("classifies employees into USALI departments", () => {
    expect(classifyEmployeeDepartment(empA)).toBe("Rooms");
    expect(classifyEmployeeDepartment(empB)).toBe("F&B");
    expect(classifyEmployeeDepartment(empC)).toBe("Maintenance");
  });

  it("computes hours from shifts and schedule", () => {
    const { actualByEmp, schedByEmp } = computeHours({ shifts, schedule, start: "2026-04-01", end: "2026-04-02" });
    expect(actualByEmp.e1).toBeCloseTo(8, 1);
    expect(actualByEmp.e3).toBeCloseTo(8.5, 1);
    expect(schedByEmp.e1).toBe(8);
    expect(schedByEmp.e2).toBe(7);
  });

  it("computes labor cost from shifts when no payroll runs exist", () => {
    const { total, source } = computeLaborCost({ shifts, payrollRuns: [], employees: [empA, empB, empC], start: "2026-04-01", end: "2026-04-02" });
    expect(source).toBe("shifts");
    // 8*18 + 8*22 + 8.5*28 = 144 + 176 + 238 = 558
    expect(total).toBeCloseTo(558, 1);
  });

  it("prefers payroll runs over shifts when both present", () => {
    const runs = [{ id: "r1", payDate: "2026-04-03", gross: 1000, lines: [] }];
    const { total, source } = computeLaborCost({ shifts, payrollRuns: runs, employees: [empA, empB, empC], start: "2026-04-01", end: "2026-04-05" });
    expect(source).toBe("payroll");
    expect(total).toBe(1000);
  });

  it("computes laborKPIs with CPOR and labor%", () => {
    const k = laborKPIs({ shifts, schedule, payrollRuns: [], employees: [empA, empB, empC], reports, start: "2026-04-01", end: "2026-04-02" });
    expect(k.roomsSold).toBe(115);
    expect(k.cpor).not.toBeNull();
    expect(k.cpor).toBeGreaterThan(0);
    expect(k.laborPctRevenue).not.toBeNull();
    // labor (558) / revenue (9000+1200+600+100 + 8200+800+400) = 558 / 20300
    expect(k.laborPctRevenue).toBeCloseTo(558 / 20300, 2);
  });

  it("groups productivity by department", () => {
    const rows = productivityByDept({ shifts, payrollRuns: [], employees: [empA, empB, empC], reports, start: "2026-04-01", end: "2026-04-02" });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const rooms = rows.find(r => r.dept === "Rooms");
    expect(rooms.cost).toBeCloseTo(8 * 18, 1);
    expect(rooms.headcount).toBe(1);
  });

  it("computes schedule vs actual variance", () => {
    const rows = scheduleVsActual({ shifts, schedule, employees: [empA, empB, empC], start: "2026-04-01", end: "2026-04-02" });
    const e2 = rows.find(r => r.employeeId === "e2");
    expect(e2.actual).toBeCloseTo(8, 1);
    expect(e2.scheduled).toBe(7);
    expect(e2.variance).toBeCloseTo(1, 1);
  });
});
