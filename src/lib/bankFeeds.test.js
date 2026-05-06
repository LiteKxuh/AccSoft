import { describe, it, expect } from "vitest";
import { parseBankCSV, matchTransactions } from "./bankFeeds.js";

describe("parseBankCSV", () => {
  it("parses Chase-style CSV with date,description,amount", () => {
    const csv = `Date,Description,Amount
2026-04-01,SYSCO PHOENIX,-1234.56
2026-04-02,DEPOSIT - GUEST FOLIOS,9876.00
2026-04-03,WESTERN LINEN,-487.20`;
    const out = parseBankCSV(csv);
    expect(out.length).toBe(3);
    expect(out[0].date).toBe("2026-04-01");
    expect(out[0].amount).toBe(-1234.56);
    expect(out[1].amount).toBe(9876);
    expect(out[2].name).toBe("WESTERN LINEN");
  });

  it("handles quoted descriptions with commas", () => {
    const csv = `Date,Description,Amount
04/01/2026,"FOOD SERVICES, INC",-300.00`;
    const out = parseBankCSV(csv);
    expect(out.length).toBe(1);
    expect(out[0].name).toBe("FOOD SERVICES, INC");
    expect(out[0].date).toBe("2026-04-01");
  });

  it("normalizes US-style dates", () => {
    const csv = `Date,Description,Amount
4/1/26,X,-50.00`;
    const out = parseBankCSV(csv);
    expect(out[0].date).toBe("2026-04-01");
  });
});

describe("matchTransactions", () => {
  it("matches a paid invoice by amount + date window", () => {
    const bankTxns = [{ id: "t1", date: "2026-04-15", amount: -1234.56, name: "SYSCO" }];
    const invoices = [
      { id: "inv1", amount: 1234.56, status: "paid", paidDate: "2026-04-14" },
      { id: "inv2", amount: 500, status: "paid", paidDate: "2026-04-15" },
    ];
    const out = matchTransactions({ bankTxns, invoices, journalEntries: [], payrollRuns: [] });
    expect(out.matches.length).toBe(1);
    expect(out.matches[0].type).toBe("invoice");
    expect(out.matches[0].id).toBe("inv1");
    expect(out.unmatchedTxns.length).toBe(0);
  });

  it("falls back to payroll when no invoice matches", () => {
    const bankTxns = [{ id: "t1", date: "2026-04-15", amount: -8500, name: "PAYROLL" }];
    const payrollRuns = [{ id: "r1", payDate: "2026-04-15", netPay: 8500 }];
    const out = matchTransactions({ bankTxns, invoices: [], payrollRuns, journalEntries: [] });
    expect(out.matches.length).toBe(1);
    expect(out.matches[0].type).toBe("payroll");
  });

  it("respects date window", () => {
    const bankTxns = [{ id: "t1", date: "2026-04-15", amount: -100 }];
    const invoices = [{ id: "inv1", amount: 100, status: "paid", paidDate: "2026-04-01" }]; // 14 days off
    const out = matchTransactions({ bankTxns, invoices, journalEntries: [], payrollRuns: [], windowDays: 4 });
    expect(out.matches.length).toBe(0);
    expect(out.unmatchedTxns.length).toBe(1);
  });

  it("respects amount tolerance", () => {
    const bankTxns = [{ id: "t1", date: "2026-04-15", amount: -100 }];
    const invoices = [{ id: "inv1", amount: 105, status: "paid", paidDate: "2026-04-15" }];
    const out = matchTransactions({ bankTxns, invoices, journalEntries: [], payrollRuns: [], tolerance: 0.5 });
    expect(out.matches.length).toBe(0);
  });
});
