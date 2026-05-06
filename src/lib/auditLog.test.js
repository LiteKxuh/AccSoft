import { describe, it, expect, beforeEach } from "vitest";
import { logEvent, readEvents, diffSummary, detectStateChanges, clearLog } from "./auditLog.js";

// vitest's global env doesn't include localStorage by default; provide a minimal mock.
beforeEach(() => {
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
});

describe("auditLog", () => {
  it("appends and reads events newest-first", () => {
    logEvent({ userId: "u1", userName: "Alice", action: "create", entityType: "invoices", entityId: "inv1" });
    logEvent({ userId: "u2", userName: "Bob", action: "update", entityType: "invoices", entityId: "inv1" });
    const events = readEvents();
    expect(events.length).toBe(2);
    expect(events[0].action).toBe("update");
    expect(events[1].action).toBe("create");
  });

  it("filters by entityType and userId", () => {
    logEvent({ userId: "u1", userName: "Alice", action: "create", entityType: "invoices", entityId: "i1" });
    logEvent({ userId: "u1", userName: "Alice", action: "create", entityType: "vendors", entityId: "v1" });
    logEvent({ userId: "u2", userName: "Bob", action: "create", entityType: "invoices", entityId: "i2" });
    expect(readEvents({ entityType: "invoices" }).length).toBe(2);
    expect(readEvents({ userId: "u1" }).length).toBe(2);
    expect(readEvents({ userId: "u1", entityType: "vendors" }).length).toBe(1);
  });

  it("strips attachment data URLs from snapshots", () => {
    logEvent({
      action: "update", entityType: "journalEntries", entityId: "j1",
      after: { id: "j1", attachments: [{ name: "r.pdf", dataUrl: "data:application/pdf;base64," + "A".repeat(5000) }] },
    });
    const e = readEvents()[0];
    expect(e.after.attachments[0].dataUrl).toMatch(/\d+ chars/);
  });

  it("diffSummary lists changed fields", () => {
    const before = { id: "i1", amount: 100, status: "open" };
    const after = { id: "i1", amount: 100, status: "paid", paidDate: "2026-04-01" };
    const d = diffSummary(before, after);
    expect(d.changedFields).toContain("status");
    expect(d.changedFields).toContain("paidDate");
    expect(d.summary).toContain("status");
  });

  it("detectStateChanges emits create/update/delete for collection diffs", () => {
    const before = {
      invoices: [{ id: "i1", amount: 100, status: "open" }],
      vendors: [{ id: "v1", name: "Sysco" }],
    };
    const after = {
      invoices: [{ id: "i1", amount: 100, status: "paid" }, { id: "i2", amount: 50, status: "open" }],
      vendors: [],
    };
    const events = detectStateChanges({ before, after, user: { id: "u1", firstName: "A", lastName: "B" } });
    expect(events.find(e => e.action === "create" && e.entityId === "i2")).toBeDefined();
    expect(events.find(e => e.action === "update" && e.entityId === "i1")).toBeDefined();
    expect(events.find(e => e.action === "delete" && e.entityId === "v1")).toBeDefined();
  });

  it("clearLog wipes history", () => {
    logEvent({ action: "x", entityType: "y" });
    expect(readEvents().length).toBe(1);
    clearLog();
    expect(readEvents().length).toBe(0);
  });
});
