import { describe, it, expect } from "vitest";
import { inboxFor, approveJE, rejectJE, approveInvoice } from "./approvalInbox.js";

const mkPendingJE = (id, amount, propertyId = "p1") => ({
  id, date: "2026-05-01", propertyId, posted: true, void: false,
  approvalState: "pending",
  lines: [
    { accountCode: "1010", debit: amount, credit: 0 },
    { accountCode: "4110", debit: 0, credit: amount },
  ],
  persistedAt: `2026-05-01T${String(Math.floor(amount / 1000)).padStart(2, "0")}:00:00Z`,
});

describe("inboxFor", () => {
  it("filters JEs to those at or below the role's approval limit", () => {
    const state = {
      journalEntries: [
        mkPendingJE("a", 2_000),
        mkPendingJE("b", 8_000),
        mkPendingJE("c", 100_000),
      ],
    };
    const agm = inboxFor(state, "agm"); // limit 5000
    expect(agm.journalEntries.map(e => e.id)).toEqual(["a"]);
    const gm = inboxFor(state, "gm"); // limit 25k
    expect(gm.journalEntries.map(e => e.id).sort()).toEqual(["a", "b"]);
    const controller = inboxFor(state, "controller"); // limit 250k
    expect(controller.journalEntries.length).toBe(3);
  });

  it("filters by property when requested", () => {
    const state = {
      journalEntries: [
        mkPendingJE("a", 1000, "p1"),
        mkPendingJE("b", 1000, "p2"),
      ],
    };
    const r = inboxFor(state, "controller", { propertyId: "p1" });
    expect(r.journalEntries.map(e => e.id)).toEqual(["a"]);
  });

  it("filters AP invoices by approval state and limit", () => {
    const state = {
      invoices: [
        { id: "i1", amount: 500, approvalState: "pending", status: "open", propertyId: "p1" },
        { id: "i2", amount: 50_000, approvalState: "pending", status: "open", propertyId: "p1" },
        { id: "i3", amount: 500, approvalState: "approved", status: "open", propertyId: "p1" },
      ],
    };
    const gm = inboxFor(state, "gm");
    expect(gm.invoices.map(i => i.id)).toEqual(["i1"]);
  });
});

describe("approveJE / rejectJE", () => {
  const state = {
    journalEntries: [
      mkPendingJE("a", 2_000),
      mkPendingJE("b", 50_000),
    ],
  };
  const user = { id: "u1" };

  it("approves when within limit", () => {
    const r = approveJE(state, "a", user, "agm");
    expect(r.ok).toBe(true);
    expect(r.update.journalEntries.find(e => e.id === "a").approvalState).toBe("approved");
  });

  it("refuses when above limit", () => {
    const r = approveJE(state, "b", user, "agm");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeds limit/);
  });

  it("rejects with reason", () => {
    const r = rejectJE(state, "a", user, "controller", "Wrong account");
    expect(r.ok).toBe(true);
    expect(r.update.journalEntries.find(e => e.id === "a").rejectReason).toBe("Wrong account");
  });

  it("returns ok:false for unknown entry", () => {
    expect(approveJE(state, "nope", user, "gm").ok).toBe(false);
  });
});

describe("approveInvoice", () => {
  it("approves when within role limit", () => {
    const state = {
      invoices: [{ id: "i1", amount: 1000, approvalState: "pending", status: "open" }],
    };
    const r = approveInvoice(state, "i1", { id: "u1" }, "gm");
    expect(r.ok).toBe(true);
  });

  it("refuses above limit", () => {
    const state = {
      invoices: [{ id: "i1", amount: 50_000, approvalState: "pending", status: "open" }],
    };
    const r = approveInvoice(state, "i1", { id: "u1" }, "agm");
    expect(r.ok).toBe(false);
  });
});
