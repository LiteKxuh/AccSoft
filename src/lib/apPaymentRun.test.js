import { describe, it, expect } from "vitest";
import { buildPaymentRun, commitPaymentRun } from "./apPaymentRun.js";

const mkInvoice = (id, vendorId, amount, overrides = {}) => ({
  id, vendorId, amount,
  status: "open",
  approvalState: "approved",
  propertyId: "p1",
  number: `INV-${id}`,
  issuedDate: "2026-05-01",
  ...overrides,
});

const vendors = [
  { id: "v1", name: "Sysco", bankRoutingNumber: "021000021", bankAccountNumber: "12345678", bankAccountType: "checking" },
  { id: "v2", name: "Local Linens", bankRoutingNumber: "021000021", bankAccountNumber: "98765432", bankAccountType: "checking" },
];

const company = {
  name: "Hotel Holdings LLC",
  taxId: "123456789",
  originatingDfi: "021000021",
  bankName: "Test Bank",
};

describe("buildPaymentRun", () => {
  it("requires at least one selection", () => {
    expect(() => buildPaymentRun({ invoices: [], vendors, selectedIds: [] })).toThrow();
  });

  it("rejects unknown invoices", () => {
    expect(() => buildPaymentRun({ invoices: [], vendors, selectedIds: ["i1"] })).toThrow();
  });

  it("rejects already-paid invoices", () => {
    const invoices = [mkInvoice("i1", "v1", 100, { status: "paid" })];
    expect(() => buildPaymentRun({ invoices, vendors, selectedIds: ["i1"] })).toThrow(/already paid/);
  });

  it("rejects unapproved invoices", () => {
    const invoices = [mkInvoice("i1", "v1", 100, { approvalState: "pending" })];
    expect(() => buildPaymentRun({ invoices, vendors, selectedIds: ["i1"] })).toThrow(/not approved/);
  });

  it("rejects zero or negative amounts", () => {
    const invoices = [mkInvoice("i1", "v1", 0)];
    expect(() => buildPaymentRun({ invoices, vendors, selectedIds: ["i1"] })).toThrow(/amount/);
  });

  it("returns a plan with totalAmount when valid", () => {
    const invoices = [mkInvoice("i1", "v1", 250), mkInvoice("i2", "v2", 175)];
    const plan = buildPaymentRun({ invoices, vendors, selectedIds: ["i1", "i2"] });
    expect(plan.lines).toHaveLength(2);
    expect(plan.totalAmount).toBe(425);
  });
});

describe("commitPaymentRun", () => {
  it("produces balanced JEs, NACHA, and session in one atomic patch", () => {
    const invoices = [mkInvoice("i1", "v1", 250), mkInvoice("i2", "v2", 175)];
    const plan = buildPaymentRun({ invoices, vendors, selectedIds: ["i1", "i2"] });
    const { patch, nacha, session } = commitPaymentRun({
      plan, company, effectiveDate: "2026-05-14", user: { id: "u1" }, propertyId: "p1",
    });
    expect(session.entryIds).toHaveLength(2);
    expect(session.status).toBe("closed");
    expect(nacha.batchSummary.paymentCount).toBe(2);
    expect(nacha.batchSummary.totalAmount).toBeCloseTo(425, 2);
    expect(patch.__append.journalEntries).toHaveLength(2);
    expect(patch.__append.postingSessions).toHaveLength(1);
    // Every JE balances and references the bank
    for (const je of patch.__append.journalEntries) {
      const drs = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
      const crs = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
      expect(drs).toBeCloseTo(crs, 2);
    }
    // Invoices are flipped to paid
    expect(patch.__replaceById.invoices.every(i => i.status === "paid")).toBe(true);
    expect(patch.__replaceById.invoices.every(i => i.paymentSessionId === session.id)).toBe(true);
  });

  it("throws on missing company info", () => {
    const invoices = [mkInvoice("i1", "v1", 100)];
    const plan = buildPaymentRun({ invoices, vendors, selectedIds: ["i1"] });
    expect(() => commitPaymentRun({ plan, company: {}, effectiveDate: "2026-05-14" })).toThrow();
  });
});
