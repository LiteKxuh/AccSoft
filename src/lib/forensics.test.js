import { describe, it, expect } from "vitest";
import {
  detectDuplicateInvoices, detectAdjustmentSpike, detectGhostRevenue,
  detectRefundOutliers, detectPayrollAnomalies, detectApprovalBypass,
  detectVendorBehavior, runForensics,
} from "./forensics.js";

describe("detectDuplicateInvoices", () => {
  it("flags exact duplicates", () => {
    const invoices = [
      { id: "a", vendorId: "v1", number: "INV-001", amount: 500, status: "open", issuedDate: "2026-05-01" },
      { id: "b", vendorId: "v1", number: "INV-001", amount: 500, status: "open", issuedDate: "2026-05-02" },
    ];
    const findings = detectDuplicateInvoices(invoices);
    expect(findings.find(f => f.code === "duplicate.exact")).toBeTruthy();
  });

  it("flags same-vendor-same-amount within 7 days as likely duplicate", () => {
    const invoices = [
      { id: "a", vendorId: "v1", number: "A", amount: 500, status: "open", issuedDate: "2026-05-01" },
      { id: "b", vendorId: "v1", number: "B", amount: 500, status: "open", issuedDate: "2026-05-05" },
    ];
    const findings = detectDuplicateInvoices(invoices);
    expect(findings.find(f => f.code === "duplicate.likely")).toBeTruthy();
  });

  it("ignores voided invoices", () => {
    const invoices = [
      { id: "a", vendorId: "v1", number: "INV-001", amount: 500, status: "void", issuedDate: "2026-05-01" },
      { id: "b", vendorId: "v1", number: "INV-001", amount: 500, status: "open", issuedDate: "2026-05-02" },
    ];
    const findings = detectDuplicateInvoices(invoices);
    expect(findings).toHaveLength(0);
  });
});

describe("detectGhostRevenue", () => {
  it("flags reports with revenue but no auto-from-report JE", () => {
    const reports = [
      { id: "r1", date: "2026-05-01", totalRevenue: 1000, propertyId: "p1" },
      { id: "r2", date: "2026-05-02", totalRevenue: 1500, propertyId: "p1" },
    ];
    const journalEntries = [
      { source: "auto-from-report", sourceId: "r1", posted: true, void: false },
    ];
    const findings = detectGhostRevenue(reports, journalEntries);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence.reportId).toBe("r2");
  });

  it("ignores zero-revenue reports", () => {
    const reports = [{ id: "r1", date: "2026-05-01", totalRevenue: 0, propertyId: "p1" }];
    expect(detectGhostRevenue(reports, [])).toEqual([]);
  });
});

describe("detectApprovalBypass", () => {
  it("flags large unapproved posted JEs", () => {
    const journalEntries = [
      {
        id: "j1", posted: true, void: false, source: "manual",
        approvalState: "pending", date: "2026-05-01", description: "Large adj",
        lines: [
          { accountCode: "1010", debit: 8000, credit: 0 },
          { accountCode: "4110", debit: 0, credit: 8000 },
        ],
      },
    ];
    const findings = detectApprovalBypass(journalEntries, []);
    expect(findings.find(f => f.code === "bypass.je")).toBeTruthy();
  });

  it("ignores auto-derived JEs even if above threshold", () => {
    const journalEntries = [
      {
        id: "j1", posted: true, void: false, source: "auto-from-report",
        approvalState: "pending", date: "2026-05-01",
        lines: [
          { accountCode: "1010", debit: 100000, credit: 0 },
          { accountCode: "4110", debit: 0, credit: 100000 },
        ],
      },
    ];
    expect(detectApprovalBypass(journalEntries, [])).toEqual([]);
  });

  it("flags paid invoices that were never approved", () => {
    const invoices = [
      { id: "i1", status: "paid", paidDate: "2026-05-10", amount: 6000, approvalState: "pending" },
    ];
    const findings = detectApprovalBypass([], invoices);
    expect(findings.find(f => f.code === "bypass.ap")).toBeTruthy();
  });
});

describe("detectVendorBehavior", () => {
  it("flags first invoice from a brand-new vendor that's >= $10k", () => {
    const vendors = [{ id: "v1", name: "Anon Services LLC", createdAt: "2026-05-01T00:00:00Z" }];
    const invoices = [{ id: "i1", vendorId: "v1", amount: 25_000, issuedDate: "2026-05-10", status: "open" }];
    const findings = detectVendorBehavior(invoices, vendors);
    expect(findings.find(f => f.code === "vendor.new_large")).toBeTruthy();
  });

  it("ignores small first invoices", () => {
    const vendors = [{ id: "v1", name: "Anon", createdAt: "2026-05-01T00:00:00Z" }];
    const invoices = [{ id: "i1", vendorId: "v1", amount: 500, issuedDate: "2026-05-10", status: "open" }];
    expect(detectVendorBehavior(invoices, vendors)).toEqual([]);
  });
});

describe("detectPayrollAnomalies", () => {
  it("flags an employee with gross >2x their median", () => {
    const employees = [{ id: "e1", name: "Alice" }];
    const payrollRuns = [
      { id: "p1", periodEnd: "2026-04-30", lines: [{ employeeId: "e1", gross: 1500 }] },
      { id: "p2", periodEnd: "2026-05-15", lines: [{ employeeId: "e1", gross: 1600 }] },
      { id: "p3", periodEnd: "2026-05-31", lines: [{ employeeId: "e1", gross: 5000 }] }, // spike
    ];
    const findings = detectPayrollAnomalies(payrollRuns, employees);
    expect(findings.find(f => f.code === "payroll.outlier")).toBeTruthy();
  });

  it("ignores employees with fewer than 3 runs of history", () => {
    const findings = detectPayrollAnomalies([
      { id: "p1", periodEnd: "2026-05-15", lines: [{ employeeId: "e1", gross: 5000 }] },
    ], []);
    expect(findings).toEqual([]);
  });
});

describe("runForensics aggregator", () => {
  it("computes risk score and risk band", () => {
    const state = {
      invoices: [
        { id: "a", vendorId: "v1", number: "INV-001", amount: 5000, status: "open", issuedDate: "2026-05-01" },
        { id: "b", vendorId: "v1", number: "INV-001", amount: 5000, status: "open", issuedDate: "2026-05-02" },
      ],
      journalEntries: [],
      reports: [],
      payrollRuns: [],
      vendors: [{ id: "v1", name: "X" }],
      employees: [],
    };
    const r = runForensics(state);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.riskScore).toBeGreaterThan(0);
    expect(["clean", "low", "elevated", "high", "critical"]).toContain(r.riskBand);
  });

  it("returns clean for empty state", () => {
    const r = runForensics({ invoices: [], journalEntries: [], reports: [], payrollRuns: [], vendors: [], employees: [] });
    expect(r.findings).toEqual([]);
    expect(r.riskBand).toBe("clean");
  });
});
