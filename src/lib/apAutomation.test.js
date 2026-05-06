import { describe, it, expect } from "vitest";
import { generateNACHA, buildCheckRun, amountInWords } from "./apAutomation.js";

describe("NACHA generation", () => {
  const company = {
    name: "MOUNTAIN INN LLC",
    taxId: "12-3456789",
    bankName: "FIRST NATL BANK",
    originatingDfi: "11000025",
  };
  const payments = [
    { id: "INV001", payeeName: "SYSCO PHOENIX", payeeAccountNumber: "1234567890", payeeRoutingNumber: "021000021", accountType: "checking", amount: 1234.56 },
    { id: "INV002", payeeName: "WESTERN LINEN", payeeAccountNumber: "9876543210", payeeRoutingNumber: "121000248", accountType: "checking", amount: 487.20 },
  ];

  it("produces a 94-char fixed-width file with at least 5 records", () => {
    const out = generateNACHA({ company, effectiveDate: "2026-04-15", payments });
    expect(out.content).toBeDefined();
    expect(out.batchSummary.paymentCount).toBe(2);
    expect(out.batchSummary.totalAmount).toBeCloseTo(1721.76, 2);
    const lines = out.content.split("\n").filter(Boolean);
    // file header, batch header, 2 detail, batch control, file control, padding
    expect(lines.length).toBeGreaterThanOrEqual(6);
    lines.forEach(l => expect(l.length).toBe(94));
    expect(lines[0][0]).toBe("1");                  // file header
    expect(lines[1][0]).toBe("5");                  // batch header
    expect(lines[2][0]).toBe("6");                  // entry detail
    expect(lines[lines.length - 1].length).toBe(94);
  });

  it("pads to a multiple of 10 lines (NACHA blocking)", () => {
    const out = generateNACHA({ company, effectiveDate: "2026-04-15", payments });
    const lines = out.content.split("\n").filter(Boolean);
    expect(lines.length % 10).toBe(0);
  });

  it("throws when company info is incomplete", () => {
    expect(() => generateNACHA({ company: { name: "X" }, effectiveDate: "2026-04-15", payments }))
      .toThrow();
  });

  it("throws on empty payments", () => {
    expect(() => generateNACHA({ company, effectiveDate: "2026-04-15", payments: [] }))
      .toThrow();
  });
});

describe("check run", () => {
  it("assigns sequential check numbers from start", () => {
    const out = buildCheckRun({
      payments: [
        { vendorId: "v1", amount: 250 },
        { vendorId: "v2", amount: 600.45 },
      ],
      vendors: [{ id: "v1", name: "Sysco" }, { id: "v2", name: "Western Linen", address: "100 Main" }],
      company: { name: "Mountain Inn" },
      runDate: "2026-04-15",
      startCheckNo: 5001,
    });
    expect(out.checks.length).toBe(2);
    expect(out.checks[0].checkNumber).toBe(5001);
    expect(out.checks[1].checkNumber).toBe(5002);
    expect(out.summary.endCheckNo).toBe(5002);
    expect(out.summary.total).toBeCloseTo(850.45, 2);
  });
});

describe("amountInWords", () => {
  it("formats round dollars", () => {
    expect(amountInWords(1)).toBe("One and 00/100");
    expect(amountInWords(100)).toBe("One hundred and 00/100");
    expect(amountInWords(2500)).toBe("Two thousand five hundred and 00/100");
  });
  it("formats cents", () => {
    expect(amountInWords(1234.56)).toBe("One thousand two hundred thirty-four and 56/100");
    expect(amountInWords(0.99)).toBe("Zero and 99/100");
  });
});
