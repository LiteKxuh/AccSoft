/* HotelOps · gl.js — smoke + invariant tests
 * Run with `npm test`.
 *
 * Goals: prove the GL stays balanced across the most common code paths,
 * and pin behavior for period-close immutability + backfill idempotency.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHART,
  buildLedger,
  trialBalance,
  balanceSheet,
  reconcile,
  isBalanced,
  entryTotals,
  isJournalLocked,
  withTenant,
  DEFAULT_TENANT_ID,
  reportToJournal,
  invoiceToJournals,
  payrollRunToJournal,
  contractorPaymentToJournal,
  backfillJournalEntries,
  makeReportJournal,
  makeInvoiceJournals,
  requiresApproval,
  isEffective,
  closePeriodChecks,
  reversingEntriesFor,
  DEFAULT_APPROVAL_THRESHOLD,
} from "./gl.js";

const sampleReport = {
  id: "rpt_1",
  propertyId: "p1",
  date: "2026-05-01",
  totalRevenue: 12500,
  breakdown: {
    revenue: {
      rooms: 9000,
      fb: { restaurant: 1500, bar: 800, banquet: 0 },
      other: { parking: 200, spa: 0, telephone: 0, misc: 0 },
    },
    taxes: { occupancy: 720, sales: 280, tourism: 0 },
    payments: { cash: 1200, creditCard: 11000, directBill: 1300, other: 0 },
  },
};

const sampleInvoice = {
  id: "inv_1",
  propertyId: "p1",
  vendorId: "vnd_1",
  invoiceNumber: "ACME-100",
  issuedDate: "2026-05-02",
  dueDate: "2026-06-01",
  amount: 1500,
  status: "open",
};

const sampleVendor = { id: "vnd_1", name: "Acme Linens", glAccount: "6100" };

const samplePayrollRun = {
  id: "pr_1",
  propertyId: "p1",
  periodStart: "2026-05-01",
  periodEnd: "2026-05-15",
  runDate: "2026-05-16",
  lines: [
    { employeeId: "e1", gross: 2000, fedWithheld: 300, stateWithheld: 100, ssTax: 124, medicareTax: 29, net: 1447 },
    { employeeId: "e2", gross: 1800, fedWithheld: 270, stateWithheld: 90, ssTax: 111.6, medicareTax: 26.1, net: 1302.3 },
  ],
};

describe("entry validation", () => {
  it("isBalanced detects balanced + unbalanced entries", () => {
    expect(isBalanced({ lines: [{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }] })).toBe(true);
    expect(isBalanced({ lines: [{ debit: 100, credit: 0 }, { debit: 0, credit: 99 }] })).toBe(false);
    expect(isBalanced({ lines: [{ debit: 0, credit: 0 }] })).toBe(false);
    expect(isBalanced(null)).toBe(false);
  });

  it("entryTotals sums correctly", () => {
    const t = entryTotals({ lines: [{ debit: 100, credit: 0 }, { debit: 50, credit: 0 }, { debit: 0, credit: 150 }] });
    expect(t.debit).toBe(150);
    expect(t.credit).toBe(150);
    expect(t.balanced).toBe(true);
  });
});

describe("derivation: report → journal", () => {
  const j = reportToJournal(sampleReport);

  it("produces a balanced journal", () => {
    expect(isBalanced(j)).toBe(true);
  });

  it("uses cash + cc + AR for the debit side", () => {
    const debits = j.lines.filter(l => l.debit > 0).map(l => l.accountCode);
    expect(debits).toContain("1010"); // cash
    expect(debits).toContain("1120"); // cc receivable
    expect(debits).toContain("1110"); // city ledger
  });

  it("credits revenue + tax accounts", () => {
    const credits = j.lines.filter(l => l.credit > 0).map(l => l.accountCode);
    expect(credits).toContain("4110"); // rooms
    expect(credits).toContain("4210"); // restaurant
    expect(credits).toContain("4230"); // bar
    expect(credits).toContain("4320"); // parking
    expect(credits).toContain("2210"); // occupancy tax payable
    expect(credits).toContain("2220"); // sales tax payable
  });

  it("uses sourceId = report.id and predictable JE id", () => {
    expect(j.sourceId).toBe("rpt_1");
    expect(j.id).toBe("auto-rpt-rpt_1");
    expect(j.source).toBe("auto-from-report");
  });
});

describe("derivation: invoice → journals", () => {
  it("produces ONE balanced JE for an open bill", () => {
    const out = invoiceToJournals(sampleInvoice, sampleVendor);
    expect(out).toHaveLength(1);
    expect(isBalanced(out[0])).toBe(true);
    expect(out[0].lines.find(l => l.accountCode === "6100" && l.debit === 1500)).toBeTruthy();
    expect(out[0].lines.find(l => l.accountCode === "2010" && l.credit === 1500)).toBeTruthy();
  });

  it("produces TWO balanced JEs when paid (bill + payment)", () => {
    const out = invoiceToJournals({ ...sampleInvoice, status: "paid", paidDate: "2026-05-15" }, sampleVendor);
    expect(out).toHaveLength(2);
    out.forEach(j => expect(isBalanced(j)).toBe(true));
    const payment = out.find(j => j.source === "auto-from-invoice-payment");
    expect(payment).toBeTruthy();
    expect(payment.lines.find(l => l.accountCode === "2010" && l.debit === 1500)).toBeTruthy();
    expect(payment.lines.find(l => l.accountCode === "1020" && l.credit === 1500)).toBeTruthy();
  });
});

describe("derivation: payroll → journal", () => {
  const j = payrollRunToJournal(samplePayrollRun);

  it("balances", () => {
    expect(isBalanced(j)).toBe(true);
  });

  it("debits wages + employer payroll-tax expense, credits cash + tax payable", () => {
    const codes = j.lines.map(l => l.accountCode);
    expect(codes).toContain("5030"); // wages expense
    expect(codes).toContain("5040"); // employer payroll-tax expense
    expect(codes).toContain("1030"); // payroll cash
    expect(codes).toContain("2030"); // tax payable
  });
});

describe("buildLedger", () => {
  it("flattens persisted JEs and skips re-derivation when sourceId is present", () => {
    const persisted = makeReportJournal(sampleReport);
    const state = {
      reports: [sampleReport],
      invoices: [],
      payrollRuns: [],
      contractorPayments: [],
      journalEntries: persisted, // already persisted — should not duplicate
    };
    const ledger = buildLedger(state);
    const reportEntries = ledger.filter(e => e.source === "auto-from-report" && e.sourceId === "rpt_1");
    expect(reportEntries).toHaveLength(1);
  });

  it("falls back to derivation for legacy state without persisted JEs", () => {
    const state = {
      reports: [sampleReport],
      invoices: [sampleInvoice],
      vendors: [sampleVendor],
      payrollRuns: [samplePayrollRun],
      journalEntries: [],
    };
    const ledger = buildLedger(state);
    expect(ledger.find(e => e.sourceId === "rpt_1")).toBeTruthy();
    expect(ledger.find(e => e.sourceId === "inv_1")).toBeTruthy();
    expect(ledger.find(e => e.sourceId === "pr_1")).toBeTruthy();
  });
});

describe("backfillJournalEntries idempotency", () => {
  it("creates entries the first time", () => {
    const state = { reports: [sampleReport], invoices: [], payrollRuns: [], contractorPayments: [], journalEntries: [] };
    const out = backfillJournalEntries(state);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].backfilled).toBe(true);
  });

  it("creates nothing when JEs already exist for every source", () => {
    const persisted = makeReportJournal(sampleReport);
    const state = { reports: [sampleReport], invoices: [], payrollRuns: [], contractorPayments: [], journalEntries: persisted };
    const out = backfillJournalEntries(state);
    expect(out).toHaveLength(0);
  });
});

describe("trialBalance + balanceSheet invariants", () => {
  // Build a state with one report + one invoice and verify the books balance
  const persisted = [
    ...makeReportJournal(sampleReport),
    ...makeInvoiceJournals(sampleInvoice, sampleVendor),
  ];
  const state = { reports: [sampleReport], invoices: [sampleInvoice], vendors: [sampleVendor], payrollRuns: [], contractorPayments: [], journalEntries: persisted };
  const ledger = buildLedger(state);

  it("trial balance debits == credits", () => {
    const tb = trialBalance(ledger, "2026-05-31", null, DEFAULT_CHART);
    expect(tb.totals.balanced).toBe(true);
  });

  it("balance sheet: Assets == Liab + Equity within tolerance", () => {
    const bs = balanceSheet(ledger, "2026-05-31", null, DEFAULT_CHART);
    expect(bs.totals.balanced).toBe(true);
  });
});

describe("bank reconcile", () => {
  it("matches a deposit on amount + within ±5 days", () => {
    const ledger = [{
      id: "je_1", date: "2026-05-04", posted: true, source: "manual",
      lines: [{ accountCode: "1020", debit: 500, credit: 0 }, { accountCode: "4340", debit: 0, credit: 500 }],
    }];
    const stmt = [{ id: "bt_1", date: "2026-05-06", amount: 500, description: "Deposit" }];
    const out = reconcile(ledger, "1020", stmt, "2026-05-31");
    expect(out.matchedPairs).toHaveLength(1);
    expect(out.outstandingBank).toHaveLength(0);
    expect(out.outstandingLedger).toHaveLength(0);
  });

  it("does NOT match if the date gap is more than 5 days", () => {
    const ledger = [{
      id: "je_1", date: "2026-05-01", posted: true, source: "manual",
      lines: [{ accountCode: "1020", debit: 500, credit: 0 }, { accountCode: "4340", debit: 0, credit: 500 }],
    }];
    const stmt = [{ id: "bt_1", date: "2026-05-15", amount: 500, description: "Deposit" }];
    const out = reconcile(ledger, "1020", stmt, "2026-05-31");
    expect(out.matchedPairs).toHaveLength(0);
    expect(out.outstandingBank).toHaveLength(1);
    expect(out.outstandingLedger).toHaveLength(1);
  });
});

describe("period-close immutability", () => {
  it("blocks edits when the entry's month is in closedPeriods for the same property", () => {
    const e = { date: "2026-04-15", propertyId: "p1" };
    expect(isJournalLocked(e, [{ propertyId: "p1", month: "2026-04" }])).toBe(true);
  });

  it("allows edits in a different month", () => {
    const e = { date: "2026-05-15", propertyId: "p1" };
    expect(isJournalLocked(e, [{ propertyId: "p1", month: "2026-04" }])).toBe(false);
  });

  it("allows edits in same month for a different property", () => {
    const e = { date: "2026-04-15", propertyId: "p2" };
    expect(isJournalLocked(e, [{ propertyId: "p1", month: "2026-04" }])).toBe(false);
  });
});

describe("approval workflow", () => {
  const big = {
    id: "je_big", date: "2026-05-10", propertyId: "p1", source: "manual", posted: true,
    lines: [{ accountCode: "5010", debit: 10000, credit: 0 }, { accountCode: "1020", debit: 0, credit: 10000 }],
  };
  const small = {
    id: "je_small", date: "2026-05-10", propertyId: "p1", source: "manual", posted: true,
    lines: [{ accountCode: "5010", debit: 100, credit: 0 }, { accountCode: "1020", debit: 0, credit: 100 }],
  };

  it("flags large manual JEs as needing approval", () => {
    expect(requiresApproval(big)).toBe(true);
    expect(requiresApproval(small)).toBe(false);
  });

  it("auto-derived journals never require approval, regardless of size", () => {
    const auto = { ...big, source: "auto-from-payroll" };
    expect(requiresApproval(auto)).toBe(false);
  });

  it("isEffective gates pending large entries out of the books", () => {
    expect(isEffective(big)).toBe(false);                        // pending by default
    expect(isEffective({ ...big, approvalState: "approved" })).toBe(true);
    expect(isEffective({ ...big, approvalState: "rejected" })).toBe(false);
    expect(isEffective(small)).toBe(true);                       // small posts immediately
  });

  it("buildLedger excludes pending JEs from the ledger", () => {
    const state = { reports: [], invoices: [], payrollRuns: [], contractorPayments: [], journalEntries: [big, small] };
    const ledger = buildLedger(state);
    expect(ledger.find(e => e.id === "je_big")).toBeUndefined();
    expect(ledger.find(e => e.id === "je_small")).toBeTruthy();
  });

  it("buildLedger with includePending: true returns everything for review UIs", () => {
    const state = { reports: [], invoices: [], payrollRuns: [], contractorPayments: [], journalEntries: [big, small] };
    const ledger = buildLedger(state, { includePending: true });
    expect(ledger.find(e => e.id === "je_big")).toBeTruthy();
  });
});

describe("period close wizard", () => {
  it("returns pass overall when books balance + nothing pending", () => {
    const persisted = makeReportJournal({ ...sampleReport, date: "2026-05-15" });
    const state = {
      reports: [{ ...sampleReport, date: "2026-05-15" }],
      invoices: [], payrollRuns: [], contractorPayments: [],
      journalEntries: persisted, bankRecs: [], closedPeriods: [],
    };
    const out = closePeriodChecks(state, "p1", "2026-05");
    expect(out.checks.find(c => c.id === "tb").status).toBe("pass");
    expect(out.checks.find(c => c.id === "drafts").status).toBe("pass");
    expect(out.checks.find(c => c.id === "approvals").status).toBe("pass");
  });

  it("flags draft journal entries as failing", () => {
    const draft = { id: "je_d", date: "2026-05-10", propertyId: "p1", source: "manual", posted: false,
      lines: [{ accountCode: "5010", debit: 50, credit: 0 }, { accountCode: "1020", debit: 0, credit: 50 }] };
    const state = { reports: [], invoices: [], payrollRuns: [], contractorPayments: [], journalEntries: [draft], bankRecs: [], closedPeriods: [] };
    const out = closePeriodChecks(state, "p1", "2026-05");
    expect(out.checks.find(c => c.id === "drafts").status).toBe("fail");
  });

  it("creates reversing entries with debits and credits swapped on day 1 of next period", () => {
    const accrual = {
      id: "je_acc", date: "2026-05-31", propertyId: "p1", source: "manual", posted: true,
      reversing: true,
      lines: [{ accountCode: "5010", debit: 1000, credit: 0 }, { accountCode: "2020", debit: 0, credit: 1000 }],
    };
    const state = { journalEntries: [accrual] };
    const reversals = reversingEntriesFor(state, "p1", "2026-05", "u1");
    expect(reversals).toHaveLength(1);
    const r = reversals[0];
    expect(r.date).toBe("2026-06-01");
    expect(r.lines[0]).toEqual(expect.objectContaining({ accountCode: "5010", debit: 0, credit: 1000 }));
    expect(r.lines[1]).toEqual(expect.objectContaining({ accountCode: "2020", debit: 1000, credit: 0 }));
    expect(r.reversingOf).toBe("je_acc");
  });
});

describe("tenancy scaffolding", () => {
  it("stamps records with the default tenant", () => {
    const r = withTenant({ id: "x" });
    expect(r.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("does not overwrite an existing tenantId", () => {
    const r = withTenant({ id: "x", tenantId: "t_other" });
    expect(r.tenantId).toBe("t_other");
  });
});
