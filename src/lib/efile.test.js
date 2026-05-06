import { describe, it, expect } from "vitest";
import { generateEFW2, generate1099NECFire } from "./efile.js";

describe("EFW2 (W-2)", () => {
  const submitter = {
    ein: "12-3456789",
    name: "MOUNTAIN INN LLC",
    address: "1 MAIN ST",
    city: "PHOENIX",
    state: "AZ",
    zip: "85001",
  };
  const employer = { ein: "12-3456789", name: "MOUNTAIN INN LLC", address: "1 MAIN ST", city: "PHOENIX", state: "AZ", zip: "85001" };
  const w2s = [
    { ssn: "123-45-6789", firstName: "JANE", lastName: "DOE", wages: 52000, federalIncomeTaxWithheld: 6240, socialSecurityWages: 52000, socialSecurityTax: 3224, medicareWages: 52000, medicareTax: 754 },
    { ssn: "987-65-4321", firstName: "JOHN", lastName: "ROE", wages: 41000, federalIncomeTaxWithheld: 4920, socialSecurityWages: 41000, socialSecurityTax: 2542, medicareWages: 41000, medicareTax: 594.50 },
  ];

  it("emits exactly 5 record types: RA, RE, RW per employee, RT, RF", () => {
    const out = generateEFW2({ submitter, employer, w2s, taxYear: 2025 });
    const lines = out.content.split("\n").filter(Boolean);
    expect(lines.length).toBe(2 + w2s.length + 2); // RA + RE + n*RW + RT + RF
    expect(lines[0].startsWith("RA")).toBe(true);
    expect(lines[1].startsWith("RE")).toBe(true);
    expect(lines[2].startsWith("RW")).toBe(true);
    expect(lines[3].startsWith("RW")).toBe(true);
    expect(lines[4].startsWith("RT")).toBe(true);
    expect(lines[5].startsWith("RF")).toBe(true);
  });

  it("each line is exactly 512 chars", () => {
    const out = generateEFW2({ submitter, employer, w2s, taxYear: 2025 });
    out.content.split("\n").filter(Boolean).forEach(l => expect(l.length).toBe(512));
  });

  it("encodes wages as zero-padded cents", () => {
    const out = generateEFW2({ submitter, employer, w2s, taxYear: 2025 });
    const rw = out.content.split("\n").find(l => l.startsWith("RW"));
    // RW columns: wages start at col 188 (after 2 + 9 + 15 + 15 + 20 + 4 + 22 + 22 + 22 + 2 + 5 + 4 + 5 + 23 + 15 + 2 = 187)
    // Wages = 52000 → 5,200,000 cents → "00005200000"
    expect(rw).toContain("00005200000");
  });

  it("throws when required fields missing", () => {
    expect(() => generateEFW2({ submitter: { name: "x" }, employer, w2s, taxYear: 2025 })).toThrow();
    expect(() => generateEFW2({ submitter, employer: {}, w2s, taxYear: 2025 })).toThrow();
    expect(() => generateEFW2({ submitter, employer, w2s: [], taxYear: 2025 })).toThrow();
  });

  it("totals match sum of W-2s", () => {
    const out = generateEFW2({ submitter, employer, w2s, taxYear: 2025 });
    expect(out.summary.wages).toBe(93000);
    expect(out.summary.fitWh).toBe(11160);
    expect(out.summary.count).toBe(2);
  });
});

describe("FIRE (1099-NEC)", () => {
  const transmitter = { tin: "12-3456789", name: "MOUNTAIN INN LLC", tcc: "12345", address: "1 MAIN", city: "PHOENIX", state: "AZ", zip: "85001" };
  const payer = { tin: "12-3456789", name: "MOUNTAIN INN LLC", address: "1 MAIN", city: "PHOENIX", state: "AZ", zip: "85001" };
  const payees = [
    { tin: "111-22-3333", name: "JANE CONTRACTOR", address: "5 PINE", city: "TUCSON", state: "AZ", zip: "85701", nonemployeeCompensation: 12500 },
    { tin: "444-55-6666", name: "BOB CONSULTANT", address: "9 OAK", city: "MESA", state: "AZ", zip: "85201", nonemployeeCompensation: 8200 },
  ];

  it("emits T, A, B per payee, C, F", () => {
    const out = generate1099NECFire({ transmitter, payer, payees, taxYear: 2025 });
    const lines = out.content.split("\n").filter(Boolean);
    expect(lines[0].startsWith("T")).toBe(true);
    expect(lines[1].startsWith("A")).toBe(true);
    expect(lines[2].startsWith("B")).toBe(true);
    expect(lines[3].startsWith("B")).toBe(true);
    expect(lines[4].startsWith("C")).toBe(true);
    expect(lines[5].startsWith("F")).toBe(true);
    expect(lines.length).toBe(6);
  });

  it("each line is exactly 750 chars", () => {
    const out = generate1099NECFire({ transmitter, payer, payees, taxYear: 2025 });
    out.content.split("\n").filter(Boolean).forEach(l => expect(l.length).toBe(750));
  });

  it("summary matches input", () => {
    const out = generate1099NECFire({ transmitter, payer, payees, taxYear: 2025 });
    expect(out.summary.payeeCount).toBe(2);
    expect(out.summary.total).toBe(20700);
  });
});
