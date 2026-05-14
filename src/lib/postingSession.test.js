import { describe, it, expect } from "vitest";
import {
  beginSession, attachToSession, completeSession, reverseSession,
  findSessionForEntry, describeSession,
} from "./postingSession.js";

const mkEntry = (id) => ({
  id, date: "2026-05-01", propertyId: "p1", description: `Entry ${id}`,
  lines: [
    { accountCode: "1010", debit: 100, credit: 0, memo: "" },
    { accountCode: "4110", debit: 0, credit: 100, memo: "" },
  ],
  posted: true,
});

describe("posting sessions", () => {
  it("begins a session in the open state", () => {
    const s = beginSession({ reason: "night-audit", user: { id: "u1", name: "alice" } });
    expect(s.status).toBe("open");
    expect(s.reason).toBe("night-audit");
    expect(s.user).toBe("u1");
    expect(s.summary.entryCount).toBe(0);
  });

  it("attaches entries and accumulates totals", () => {
    const s = beginSession({ reason: "ap-run" });
    const { session, entries } = attachToSession(s, [mkEntry("a"), mkEntry("b")]);
    expect(session.summary.entryCount).toBe(2);
    expect(session.summary.totalDebit).toBe(200);
    expect(session.summary.totalCredit).toBe(200);
    expect(entries[0].postingSessionId).toBe(s.id);
    expect(entries[1].postingSessionId).toBe(s.id);
  });

  it("refuses to attach to a closed session", () => {
    const closed = completeSession(beginSession({}));
    expect(() => attachToSession(closed, [mkEntry("a")])).toThrow();
  });

  it("completes a session with a chain root", () => {
    const s = beginSession({});
    const { session } = attachToSession(s, [mkEntry("a")]);
    const done = completeSession(session, "deadbeef");
    expect(done.status).toBe("closed");
    expect(done.chainRoot).toBe("deadbeef");
    expect(done.completedAt).toBeTruthy();
  });

  it("reverses a session by producing opposite-side entries", () => {
    const s = beginSession({ reason: "ap-run" });
    const orig = [mkEntry("a"), mkEntry("b")];
    const { session, entries } = attachToSession(s, orig);
    const closed = completeSession(session);
    const { reversalSession, reversalEntries } = reverseSession(closed, entries, { user: { id: "u1" } });
    expect(reversalEntries).toHaveLength(2);
    // First reversal — debits and credits swapped
    expect(reversalEntries[0].lines[0].debit).toBe(0);
    expect(reversalEntries[0].lines[0].credit).toBe(100);
    expect(reversalEntries[0].reversingOf).toBe("a");
    expect(reversalSession.reason).toBe("reversal");
    expect(reversalSession.sourceRef.id).toBe(closed.id);
  });

  it("findSessionForEntry returns the right session", () => {
    const s1 = beginSession({}); const r1 = attachToSession(s1, [mkEntry("a")]);
    const s2 = beginSession({}); const r2 = attachToSession(s2, [mkEntry("b")]);
    const found = findSessionForEntry([r1.session, r2.session], "b");
    expect(found.id).toBe(r2.session.id);
  });

  it("describeSession formats nicely", () => {
    const s = beginSession({ reason: "ap-run" });
    const { session } = attachToSession(s, [mkEntry("a")]);
    const text = describeSession(session);
    expect(text).toContain("ap-run");
    expect(text).toContain("1 entry");
  });
});
