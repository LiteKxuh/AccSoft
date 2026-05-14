import { describe, it, expect } from "vitest";
import { normalizeEmployee, isActive, canWorkJob, canWorkDepartment, validateForPayroll, PAY_CLASSES, classifyDepartmentByTitle } from "./employeeProfile.js";

describe("normalizeEmployee", () => {
  it("requires an id", () => {
    expect(() => normalizeEmployee({})).toThrow();
  });

  it("infers salaried from a salary field", () => {
    const e = normalizeEmployee({ id: "e1", salary: 60_000 });
    expect(e.payClass).toBe("salaried");
    expect(e.overtimeEligible).toBe(false);
  });

  it("hourly is OT-eligible by default", () => {
    const e = normalizeEmployee({ id: "e1", hourlyRate: 20 });
    expect(e.overtimeEligible).toBe(true);
  });

  it("tipped employees have cashTipsTracked auto-on", () => {
    const e = normalizeEmployee({ id: "e1", payClass: "tipped", tippedRate: 3.50 });
    expect(e.cashTipsTracked).toBe(true);
  });

  it("rejects unknown payClass", () => {
    expect(() => normalizeEmployee({ id: "e1", payClass: "magic" })).toThrow();
  });

  it("backfills allowedDepartments from homeDepartment", () => {
    const e = normalizeEmployee({ id: "e1", homeDepartment: "front_office" });
    expect(e.allowedDepartments).toEqual(["front_office"]);
  });
});

describe("isActive", () => {
  it("active employee passes", () => {
    expect(isActive({ status: "active" })).toBe(true);
  });

  it("terminated employee fails", () => {
    expect(isActive({ status: "terminated" })).toBe(false);
  });

  it("future hire date fails", () => {
    expect(isActive({ status: "active", hireDate: "2099-01-01" })).toBe(false);
  });

  it("past termination fails", () => {
    expect(isActive({ status: "active", terminationDate: "2024-01-01" })).toBe(false);
  });
});

describe("canWorkJob + canWorkDepartment", () => {
  it("unrestricted job codes mean any job", () => {
    expect(canWorkJob({ jobCodes: [] }, "room_attendant")).toBe(true);
  });

  it("restricted job codes enforce list", () => {
    expect(canWorkJob({ jobCodes: ["room_attendant"] }, "front_desk_agent")).toBe(false);
  });

  it("department allowance honors allowedDepartments", () => {
    expect(canWorkDepartment({ allowedDepartments: ["housekeeping", "front_office"] }, "front_office")).toBe(true);
  });
});

describe("validateForPayroll", () => {
  it("flags missing rate and I-9", () => {
    const e = normalizeEmployee({ id: "e1", payClass: "hourly" });
    const r = validateForPayroll(e);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => /hourlyRate/.test(i))).toBe(true);
    expect(r.issues.some(i => /i9Verified/.test(i))).toBe(true);
  });

  it("salaried passes when salary and paperwork present", () => {
    const e = normalizeEmployee({
      id: "e1", payClass: "salaried", salary: 60_000,
      homeDepartment: "executive", i9Verified: true, w4OnFile: true,
    });
    const r = validateForPayroll(e);
    expect(r.ok).toBe(true);
  });

  it("terminated employee fails", () => {
    const e = normalizeEmployee({ id: "e1", payClass: "hourly", hourlyRate: 20, status: "terminated" });
    expect(validateForPayroll(e).ok).toBe(false);
  });
});

describe("classifyDepartmentByTitle", () => {
  it("maps room attendant to Housekeeping", () => {
    expect(classifyDepartmentByTitle("Room Attendant")).toBe("Housekeeping");
  });
  it("maps server to F&B", () => {
    expect(classifyDepartmentByTitle("Server")).toBe("F&B");
  });
  it("maps banquet to Banquets", () => {
    expect(classifyDepartmentByTitle("Banquet Captain")).toBe("Banquets");
  });
  it("unknown title falls to Other", () => {
    expect(classifyDepartmentByTitle("Astronaut")).toBe("Other");
  });
});

describe("PAY_CLASSES", () => {
  it("includes the five expected classes", () => {
    expect(PAY_CLASSES).toEqual(expect.arrayContaining(["hourly", "salaried", "tipped", "contractor", "banquet"]));
  });
});
