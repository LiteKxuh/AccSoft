import { describe, it, expect } from "vitest";
import { verifyLedger, sessionTimeline, entryLineage, chainHealth } from "./ledgerForensics.js";
import { stampEntry } from "./ledgerChain.js";

async function buildChain(entries) {
  const out = [];
  let prev = "";
  for (const e of entries) {
    const stamped = await stampEntry(e, prev);
    out.push(stamped);
    prev = stamped.chainHash;
  }
  return out;
}

const mkEntry = (overrides = {}) => ({
  id: overrides.id || "je_x",
  date: overrides.date || "2026-05-01",
  propertyId: overrides.propertyId || "p1",
  description: overrides.description || "Test",
  source: "manual",
  posted: true,
  lines: [
    { accountCode: "1010", debit: 100, credit: 0 },
    { accountCode: "4110", debit: 0, credit: 100 },
  ],
  persistedAt: overrides.persistedAt || "2026-05-01T12:00:00Z",
  ...overrides,
});

describe("verifyLedger", () => {
  it("returns ok on a clean chain", async () => {
    const chain = await buildChain([
      mkEntry({ id: "a" }),
      mkEntry({ id: "b", persistedAt: "2026-05-02T12:00:00Z" }),
    ]);
    const state = { journalEntries: chain };
    const r = await verifyLedger(state);
    expect(r.ok).toBe(true);
    expect(r.length).toBe(2);
  });

  it("flags a tampered entry", async () => {
    const chain = await buildChain([mkEntry({ id: "a" })]);
    // Edit the amount silently
    chain[0].lines[0].debit = 9999;
    const state = { journalEntries: chain };
    const r = await verifyLedger(state);
    expect(r.ok).toBe(false);
    expect(r.entry.id).toBe("a");
  });
});

describe("sessionTimeline", () => {
  it("returns sessions ordered by startedAt desc", () => {
    const state = {
      postingSessions: [
        { id: "s1", startedAt: "2026-05-01T08:00:00Z", reason: "night-audit", entryIds: ["e1"], summary: { totalDebit: 100, totalCredit: 100 }, status: "closed" },
        { id: "s2", startedAt: "2026-05-02T08:00:00Z", reason: "ap-run", entryIds: ["e2"], summary: { totalDebit: 200, totalCredit: 200 }, status: "closed" },
      ],
      journalEntries: [
        mkEntry({ id: "e1" }),
        mkEntry({ id: "e2", propertyId: "p2" }),
      ],
    };
    const t = sessionTimeline(state);
    expect(t[0].id).toBe("s2");
    expect(t[1].id).toBe("s1");
  });

  it("filters by property", () => {
    const state = {
      postingSessions: [
        { id: "s1", startedAt: "2026-05-01T08:00:00Z", reason: "night-audit", entryIds: ["e1"], summary: {} },
        { id: "s2", startedAt: "2026-05-01T08:00:00Z", reason: "night-audit", entryIds: ["e2"], summary: {} },
      ],
      journalEntries: [
        mkEntry({ id: "e1", propertyId: "p1" }),
        mkEntry({ id: "e2", propertyId: "p2" }),
      ],
    };
    const t = sessionTimeline(state, { propertyId: "p1" });
    expect(t.length).toBe(1);
    expect(t[0].id).toBe("s1");
  });
});

describe("entryLineage", () => {
  it("returns full lineage with session + reversal", () => {
    const state = {
      postingSessions: [{ id: "s1", entryIds: ["e1"], summary: {} }],
      journalEntries: [
        mkEntry({ id: "e1", postingSessionId: "s1", chainHash: "abc", chainPrev: null }),
        mkEntry({ id: "rev_e1", reversingOf: "e1", chainHash: "def", chainPrev: "abc" }),
      ],
    };
    const lineage = entryLineage(state, "e1");
    expect(lineage.entry.id).toBe("e1");
    expect(lineage.session.id).toBe("s1");
    expect(lineage.chainHash).toBe("abc");
  });

  it("returns null for unknown entry", () => {
    expect(entryLineage({}, "missing")).toBeNull();
  });
});

describe("chainHealth", () => {
  it("counts posted-but-unchained entries", () => {
    const state = {
      journalEntries: [
        mkEntry({ id: "a", chainHash: "h1" }),
        mkEntry({ id: "b" }), // unchained
        mkEntry({ id: "c", chainHash: "h3" }),
      ],
      postingSessions: [],
    };
    const h = chainHealth(state);
    expect(h.totalEntries).toBe(3);
    expect(h.unchainedPosted).toBe(1);
    expect(h.chainedEntries).toBe(2);
  });
});
