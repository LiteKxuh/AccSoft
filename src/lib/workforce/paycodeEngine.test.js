import { describe, it, expect } from "vitest";
import { buildPayCodeLines, sumLines, getPayCode, PAY_CODES } from "./paycodeEngine.js";

describe("getPayCode + PAY_CODES", () => {
  it("returns null for unknown code", () => {
    expect(getPayCode("UNKNOWN")).toBeNull();
  });

  it("REG is OT-eligible base, OT is not", () => {
    expect(getPayCode("REG").includedInOvertimeBase).toBe(true);
    expect(getPayCode("OT").includedInOvertimeBase).toBe(false);
  });

  it("ADJ requires approval", () => {
    expect(getPayCode("ADJ").requiresApproval).toBe(true);
  });
});

describe("buildPayCodeLines", () => {
  const split = { regular: 40, ot: 8, doubleTime: 2, holiday: 8 };

  it("creates REG / OT / DT / HOL lines from an OT split", () => {
    const lines = buildPayCodeLines({ split, rate: 20 });
    const codes = lines.map(l => l.code);
    expect(codes).toContain("REG");
    expect(codes).toContain("OT");
    expect(codes).toContain("DT");
    expect(codes).toContain("HOL");
  });

  it("OT line uses 1.5× rate", () => {
    const lines = buildPayCodeLines({ split, rate: 20 });
    const ot = lines.find(l => l.code === "OT");
    expect(ot.rate).toBe(30);
    expect(ot.amount).toBe(240);
  });

  it("DT line uses 2× rate", () => {
    const lines = buildPayCodeLines({ split, rate: 20 });
    const dt = lines.find(l => l.code === "DT");
    expect(dt.rate).toBe(40);
    expect(dt.amount).toBe(80);
  });

  it("emits PTO/BONUS/TIPS extras", () => {
    const lines = buildPayCodeLines({
      split: { regular: 40, ot: 0, doubleTime: 0, holiday: 0 },
      rate: 20,
      extras: { ptoHours: 8, bonus: 250, tips: 80, tipsCC: 120, serviceCharge: 50 },
    });
    const find = (c) => lines.find(l => l.code === c);
    expect(find("PTO").amount).toBe(160);
    expect(find("BONUS").amount).toBe(250);
    expect(find("TIPS").amount).toBe(80);
    expect(find("TIPS_CC").amount).toBe(120);
    expect(find("SVC").amount).toBe(50);
  });

  it("ADJ requires reason and approvedBy", () => {
    expect(() => buildPayCodeLines({
      split: { regular: 0, ot: 0, doubleTime: 0, holiday: 0 },
      rate: 20,
      extras: { adjustments: [{ amount: 50 }] },
    })).toThrow(/reason/);
    expect(() => buildPayCodeLines({
      split: { regular: 0, ot: 0, doubleTime: 0, holiday: 0 },
      rate: 20,
      extras: { adjustments: [{ amount: 50, reason: "comp" }] },
    })).toThrow(/approvedBy/);
  });
});

describe("sumLines", () => {
  it("buckets totals by category", () => {
    const lines = [
      { code: "REG", amount: 800 },
      { code: "OT", amount: 240 },
      { code: "PTO", amount: 160 },
      { code: "TIPS", amount: 100 },
      { code: "ADJ", amount: -50 },
    ];
    const s = sumLines(lines);
    expect(s.gross).toBe(1250);
    expect(s.taxableWages).toBe(1250);
    expect(s.tips).toBe(100);
    expect(s.benefits).toBe(160);
    expect(s.adjustments).toBe(-50);
  });
});
