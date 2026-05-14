import { describe, it, expect } from "vitest";
import { exportForADP, exportForGusto, exportForPaychex, exportForPaylocity, exportGenericCsv, exportFor, EXPORTERS } from "./payrollExporter.js";

const batch = {
  id: "b1", periodStart: "2026-05-11", periodEnd: "2026-05-17",
  status: "approved", payGroupId: "g1",
};

const perEmployee = [
  {
    employeeId: "e1", employeeName: "Alice", gross: 1120,
    lines: [
      { code: "REG", hours: 40, rate: 20, amount: 800 },
      { code: "OT",  hours: 8,  rate: 30, amount: 240 },
      { code: "DT",  hours: 2,  rate: 40, amount: 80 },
    ],
    validation: { ok: true, issues: [] },
  },
];

const employees = [{ id: "e1", name: "Alice Smith", fileNumber: "A001" }];

describe("exportForADP", () => {
  it("returns a CSV with header + employee row", () => {
    const r = exportForADP(batch, perEmployee, employees);
    expect(r.format).toBe("adp");
    expect(r.filename).toMatch(/^ADP_payroll/);
    expect(r.content).toContain("Company Code");
    expect(r.content).toContain("A001");
    expect(r.content).toContain("1120"); // gross
  });

  it("surfaces issues when batch is not approved", () => {
    const r = exportForADP({ ...batch, status: "draft" }, perEmployee, employees);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("surfaces issues for failed payroll validation", () => {
    const r = exportForADP(batch, [{ ...perEmployee[0], validation: { ok: false, issues: ["missing i9"] } }], employees);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe("exportForGusto", () => {
  it("emits a Gusto-style CSV with split name + tips columns", () => {
    const r = exportForGusto(batch, perEmployee, employees);
    expect(r.content).toContain("First Name");
    expect(r.content).toContain("Alice");
    expect(r.content).toContain("Smith");
  });
});

describe("exportForPaychex", () => {
  it("emits one row per pay code", () => {
    const r = exportForPaychex(batch, perEmployee, employees);
    const lines = r.content.trim().split("\n");
    // 1 header + 3 lines (REG, OT, DT) for one employee
    expect(lines.length).toBe(4);
  });
});

describe("exportForPaylocity", () => {
  it("includes pay period string", () => {
    const r = exportForPaylocity(batch, perEmployee, employees);
    expect(r.content).toContain("2026-05-11 to 2026-05-17");
  });
});

describe("exportGenericCsv", () => {
  it("emits a row per pay code with rate column", () => {
    const r = exportGenericCsv(batch, perEmployee);
    expect(r.content).toContain("Rate");
    expect(r.content).toContain("Pay Code");
  });
});

describe("EXPORTERS + exportFor", () => {
  it("exposes all 5 formats", () => {
    expect(Object.keys(EXPORTERS).sort()).toEqual(["adp", "csv", "gusto", "paychex", "paylocity"]);
  });

  it("dispatches by format name", () => {
    const r = exportFor("adp", batch, perEmployee, employees);
    expect(r.format).toBe("adp");
  });

  it("throws on unknown format", () => {
    expect(() => exportFor("magic", batch, perEmployee, employees)).toThrow();
  });
});
