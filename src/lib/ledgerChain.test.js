import { describe, it, expect } from "vitest";
import { canonicalize, computeHash, stampEntry, verifyChain, chainOrder, rebuildChain } from "./ledgerChain.js";

const mkEntry = (overrides = {}) => ({
  id: "je_1",
  date: "2026-05-01",
  propertyId: "p1",
  description: "Test entry",
  source: "manual",
  lines: [
    { accountCode: "1010", debit: 100, credit: 0, memo: "Cash" },
    { accountCode: "4110", debit: 0, credit: 100, memo: "Rev" },
  ],
  posted: true,
  persistedAt: "2026-05-01T12:00:00Z",
  ...overrides,
});

describe("canonicalize — stable across key ordering", () => {
  it("produces identical output for reordered fields", () => {
    const a = mkEntry();
    const b = { description: "Test entry", date: "2026-05-01", propertyId: "p1", id: "je_1", source: "manual", posted: true, persistedAt: "2026-05-01T12:00:00Z",
      lines: [
        { credit: 0, debit: 100, accountCode: "1010", memo: "Cash" },
        { credit: 100, accountCode: "4110", debit: 0, memo: "Rev" },
      ],
    };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("excludes mutation-prone metadata (createdBy, persistedAt)", () => {
    const a = mkEntry();
    const b = mkEntry({ createdBy: "alice", chainStampedAt: "different" });
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

describe("stampEntry / verifyChain", () => {
  it("stamps and chains entries in order", async () => {
    const e1 = await stampEntry(mkEntry({ id: "j1" }), "");
    const e2 = await stampEntry(mkEntry({ id: "j2", persistedAt: "2026-05-02T12:00:00Z" }), e1.chainHash);
    const e3 = await stampEntry(mkEntry({ id: "j3", persistedAt: "2026-05-03T12:00:00Z" }), e2.chainHash);
    const result = await verifyChain([e1, e2, e3]);
    expect(result.ok).toBe(true);
    expect(result.length).toBe(3);
  });

  it("detects tampering — silent edit to a posted entry breaks the chain", async () => {
    const e1 = await stampEntry(mkEntry({ id: "j1" }), "");
    const e2 = await stampEntry(mkEntry({ id: "j2", persistedAt: "2026-05-02T12:00:00Z" }), e1.chainHash);
    // Adversary edits e1's amount silently
    const tampered = { ...e1, lines: [
      { accountCode: "1010", debit: 9999, credit: 0, memo: "Cash" },
      { accountCode: "4110", debit: 0, credit: 100, memo: "Rev" },
    ]};
    const result = await verifyChain([tampered, e2]);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.entry.id).toBe("j1");
  });

  it("detects reordering tampering", async () => {
    const e1 = await stampEntry(mkEntry({ id: "j1" }), "");
    const e2 = await stampEntry(mkEntry({ id: "j2", persistedAt: "2026-05-02T12:00:00Z" }), e1.chainHash);
    // Pretend an adversary swapped persistedAt to reorder — chain link will mismatch
    const swapped1 = { ...e1, persistedAt: "2026-05-03T12:00:00Z" };
    const swapped2 = { ...e2, persistedAt: "2026-05-02T11:00:00Z" };
    const result = await verifyChain([swapped1, swapped2]);
    expect(result.ok).toBe(false);
  });

  it("chainOrder filters non-posted and voided entries", () => {
    const entries = [
      { id: "a", posted: true,  void: false, chainHash: "h1", persistedAt: "2026-05-01" },
      { id: "b", posted: false, void: false, chainHash: "h2", persistedAt: "2026-05-02" },
      { id: "c", posted: true,  void: true,  chainHash: "h3", persistedAt: "2026-05-03" },
      { id: "d", posted: true,  void: false, chainHash: "h4", persistedAt: "2026-05-04" },
    ];
    const ordered = chainOrder(entries);
    expect(ordered.map(x => x.id)).toEqual(["a", "d"]);
  });
});

describe("rebuildChain — administrative reset only", () => {
  it("re-stamps entries so verifyChain passes", async () => {
    const corrupt = [
      { ...mkEntry({ id: "j1" }), chainHash: "bogus", chainPrev: null },
      { ...mkEntry({ id: "j2", persistedAt: "2026-05-02T12:00:00Z" }), chainHash: "bogus2", chainPrev: "bogus" },
    ];
    const rebuilt = await rebuildChain(corrupt);
    const result = await verifyChain(rebuilt);
    expect(result.ok).toBe(true);
  });
});

describe("computeHash is deterministic", () => {
  it("same input → same hash", async () => {
    const a = await computeHash("hello world");
    const b = await computeHash("hello world");
    expect(a).toBe(b);
  });

  it("different input → different hash", async () => {
    const a = await computeHash("hello world");
    const b = await computeHash("hello world!");
    expect(a).not.toBe(b);
  });
});
