import { describe, it, expect } from "vitest";
import {
  toCents, fromCents, sumCents, addMoney, subMoney, mulMoney, eqMoney,
  allocateCents, fmtMoney, fmtMoneyShort, fmtPct, fmtVar,
  validateRevenueRealism,
} from "./money.js";

describe("toCents / fromCents", () => {
  it("rounds half-away-from-zero", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(0.125)).toBe(13);
  });

  it("parses dollar strings", () => {
    expect(toCents("$1,234.56")).toBe(123456);
    expect(toCents("(50.00)")).toBe(-5000);
    expect(toCents(" 99.99 ")).toBe(9999);
  });

  it("returns 0 for bad input", () => {
    expect(toCents(null)).toBe(0);
    expect(toCents("abc")).toBe(0);
    expect(toCents(Infinity)).toBe(0);
  });

  it("round-trips", () => {
    expect(fromCents(toCents(1234.56))).toBe(1234.56);
  });
});

describe("addMoney / subMoney — float drift elimination", () => {
  it("avoids 0.1 + 0.2 drift", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3); // sanity: vanilla floats fail
  });

  it("sums a long chain exactly", () => {
    const ten = addMoney(...Array(100).fill(0.1));
    expect(ten).toBe(10);
  });

  it("subtracts cleanly", () => {
    expect(subMoney(1, 0.9)).toBe(0.1);
  });
});

describe("mulMoney", () => {
  it("multiplies by tax rate", () => {
    expect(mulMoney(100, 0.115)).toBe(11.5);
  });
  it("handles bad factor", () => {
    expect(mulMoney(100, NaN)).toBe(0);
  });
});

describe("eqMoney — balance assertions", () => {
  it("equal within half-cent", () => {
    expect(eqMoney(100.001, 100.002)).toBe(true);
    expect(eqMoney(100.00, 100.01)).toBe(false);
  });
});

describe("allocateCents — split totals without losing pennies", () => {
  it("distributes 100 into 3 as 34/33/33 (sums exactly)", () => {
    const parts = allocateCents(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(100);
  });

  it("handles negative remainder", () => {
    const parts = allocateCents(-100, 3);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(-100);
  });

  it("returns empty for n=0", () => {
    expect(allocateCents(100, 0)).toEqual([]);
  });
});

describe("sumCents", () => {
  it("sums mixed-type values", () => {
    expect(sumCents([1.10, "2.20", 3.30])).toBe(660);
  });
  it("ignores nullish", () => {
    expect(sumCents([1, null, undefined, 2])).toBe(300);
  });
});

describe("formatters", () => {
  it("fmtMoney", () => {
    expect(fmtMoney(1234.56)).toBe("$1,234.56");
    expect(fmtMoney(0)).toBe("$0.00");
    expect(fmtMoney(NaN)).toBe("$0.00");
  });

  it("fmtMoneyShort", () => {
    expect(fmtMoneyShort(1500)).toBe("$1.5K");
    expect(fmtMoneyShort(2_500_000)).toBe("$2.5M");
    expect(fmtMoneyShort(-1500)).toBe("-$1.5K");
  });

  it("fmtPct", () => {
    expect(fmtPct(0.453)).toBe("45.3%");
    expect(fmtPct(NaN)).toBe("—");
  });

  it("fmtVar with sign", () => {
    expect(fmtVar(0.12)).toBe("+12.0%");
    expect(fmtVar(-0.05)).toBe("−5.0%");
  });
});

describe("validateRevenueRealism — guardrails against impossible inputs", () => {
  it("passes plausible numbers", () => {
    const v = validateRevenueRealism({
      roomsSold: 75, roomsAvailable: 100, roomRevenue: 9000, totalRevenue: 10500, laborCost: 2800,
    });
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([]);
  });

  it("flags occupancy > 105%", () => {
    const v = validateRevenueRealism({
      roomsSold: 120, roomsAvailable: 100, roomRevenue: 9000, totalRevenue: 10500,
    });
    expect(v.ok).toBe(false);
    expect(v.warnings.some(w => /Occupancy/.test(w))).toBe(true);
  });

  it("flags absurd ADR", () => {
    const v = validateRevenueRealism({
      roomsSold: 1, roomsAvailable: 100, roomRevenue: 5_000_000, totalRevenue: 5_000_000,
    });
    expect(v.ok).toBe(false);
    expect(v.warnings.some(w => /ADR/.test(w))).toBe(true);
  });

  it("flags labor > 150% of rev", () => {
    const v = validateRevenueRealism({
      roomsSold: 10, roomsAvailable: 100, roomRevenue: 1000, totalRevenue: 1000, laborCost: 2000,
    });
    expect(v.ok).toBe(false);
    expect(v.warnings.some(w => /Labor/.test(w))).toBe(true);
  });
});
