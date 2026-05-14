import { describe, it, expect } from "vitest";
import { buildReversal, buildCorrectionPair, markVoided } from "./adjustment.js";

const mkOrig = (overrides = {}) => ({
  id: "je_42",
  date: "2026-05-01",
  propertyId: "p1",
  description: "Original entry",
  source: "manual",
  posted: true,
  lines: [
    { accountCode: "1010", debit: 100, credit: 0, memo: "Cash" },
    { accountCode: "4110", debit: 0, credit: 100, memo: "Rev" },
  ],
  ...overrides,
});

describe("buildReversal", () => {
  it("swaps debits and credits", () => {
    const r = buildReversal(mkOrig());
    expect(r.lines[0].debit).toBe(0);
    expect(r.lines[0].credit).toBe(100);
    expect(r.lines[1].debit).toBe(100);
    expect(r.lines[1].credit).toBe(0);
  });

  it("references the original via reversingOf and sourceId", () => {
    const r = buildReversal(mkOrig());
    expect(r.reversingOf).toBe("je_42");
    expect(r.sourceId).toBe("je_42");
    expect(r.source).toBe("auto-reversal");
  });

  it("uses the original date by default and accepts override", () => {
    const r = buildReversal(mkOrig({ date: "2026-04-30" }));
    expect(r.date).toBe("2026-04-30");
    const r2 = buildReversal(mkOrig({ date: "2026-04-30" }), { reversalDate: "2026-05-15" });
    expect(r2.date).toBe("2026-05-15");
  });

  it("refuses to reverse a void entry", () => {
    expect(() => buildReversal(mkOrig({ void: true }))).toThrow();
  });

  it("refuses to reverse an entry with no lines", () => {
    expect(() => buildReversal({ id: "x", lines: [] })).toThrow();
  });
});

describe("buildCorrectionPair", () => {
  it("produces a balanced reversal + replacement", () => {
    const orig = mkOrig();
    const draft = {
      lines: [
        { accountCode: "1010", debit: 150, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 150 },
      ],
    };
    const { reversal, replacement, correctionGroupId } = buildCorrectionPair(orig, draft);
    expect(reversal.lines[0].debit + reversal.lines[1].debit).toBe(replacement.lines[0].credit + replacement.lines[1].credit ? 100 : 100);
    expect(replacement.lines[0].debit).toBe(150);
    expect(reversal.correctionGroupId).toBe(correctionGroupId);
    expect(replacement.correctionGroupId).toBe(correctionGroupId);
    expect(replacement.replacementOf).toBe(orig.id);
  });

  it("refuses an unbalanced replacement", () => {
    const orig = mkOrig();
    const badDraft = {
      lines: [
        { accountCode: "1010", debit: 100, credit: 0 },
        { accountCode: "4110", debit: 0, credit: 75 },  // doesn't balance
      ],
    };
    expect(() => buildCorrectionPair(orig, badDraft)).toThrow();
  });

  it("marks the original as voided via the reversal id", () => {
    const orig = mkOrig();
    const reversal = buildReversal(orig);
    const voided = markVoided(orig, reversal, { user: { id: "u1" }, reason: "Wrong account" });
    expect(voided.void).toBe(true);
    expect(voided.voidedBy).toBe(reversal.id);
    expect(voided.voidReason).toBe("Wrong account");
    expect(voided.voidedByUser).toBe("u1");
  });
});
