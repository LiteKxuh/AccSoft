/* HotelOps · Approval inbox
 * =================================================================
 * Centralized "what needs my approval right now" queue for JEs and
 * AP invoices. Respects RBAC approval limits — an AGM with a $5,000
 * limit only sees entries up to $5,000; controller sees up to $250k;
 * ownership sees everything.
 *
 *   inboxFor(state, role, ctx?)
 *     → { journalEntries: [...], invoices: [...], total }
 *
 *   approveJE(state, entryId, user, role)
 *     → { update, ok, reason? }
 *
 *   rejectJE(state, entryId, user, role, reason)
 *     → { update, ok, reason? }
 *
 * Returns state patches (caller wires them via the existing update()).
 */

import { can, approveLimit } from "./rbac.js";
import { entryTotals } from "./gl.js";

export function inboxFor(state, role, ctx = {}) {
  const limit = approveLimit(role);
  const allEntries = state?.journalEntries || [];
  const journalEntries = allEntries
    .filter(e =>
      e.posted && !e.void
      && e.approvalState === "pending"
      && (!ctx.propertyId || e.propertyId === ctx.propertyId)
    )
    .filter(e => {
      const t = entryTotals(e).debit;
      // Hide entries above the role's limit — let a more senior role handle them
      return limit === Infinity || t <= limit;
    })
    .sort((a, b) => (b.persistedAt || b.createdAt || "").localeCompare(a.persistedAt || a.createdAt || ""));

  const invoices = (state?.invoices || [])
    .filter(i =>
      i.approvalState === "pending"
      && i.status !== "void"
      && (!ctx.propertyId || i.propertyId === ctx.propertyId)
    )
    .filter(i => limit === Infinity || (Number(i.amount) || 0) <= limit)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  return {
    journalEntries,
    invoices,
    total: journalEntries.length + invoices.length,
    roleLimit: limit,
  };
}

export function approveJE(state, entryId, user, role) {
  const entry = (state?.journalEntries || []).find(e => e.id === entryId);
  if (!entry) return { ok: false, reason: "Entry not found." };
  const amt = entryTotals(entry).debit;
  if (!can(role, "je.approve", { amount: amt })) {
    return { ok: false, reason: `Role "${role}" cannot approve $${amt.toFixed(2)} — exceeds limit ${approveLimit(role)}.` };
  }
  const journalEntries = (state.journalEntries || []).map(e =>
    e.id === entryId
      ? { ...e, approvalState: "approved", approvedBy: user?.id, approvedAt: new Date().toISOString(), rejectedAt: null, rejectedBy: null, rejectReason: null }
      : e
  );
  return { ok: true, update: { journalEntries } };
}

export function rejectJE(state, entryId, user, role, reason) {
  const entry = (state?.journalEntries || []).find(e => e.id === entryId);
  if (!entry) return { ok: false, reason: "Entry not found." };
  if (!can(role, "je.approve")) {
    return { ok: false, reason: "Role cannot reject entries." };
  }
  const journalEntries = (state.journalEntries || []).map(e =>
    e.id === entryId
      ? { ...e, approvalState: "rejected", rejectedBy: user?.id, rejectedAt: new Date().toISOString(), rejectReason: reason || "Rejected" }
      : e
  );
  return { ok: true, update: { journalEntries } };
}

export function approveInvoice(state, invoiceId, user, role) {
  const inv = (state?.invoices || []).find(i => i.id === invoiceId);
  if (!inv) return { ok: false, reason: "Invoice not found." };
  if (!can(role, "ap.approve", { amount: Number(inv.amount) || 0 })) {
    return { ok: false, reason: `Role "${role}" cannot approve invoice ${invoiceId} — limit exceeded.` };
  }
  const invoices = (state.invoices || []).map(i =>
    i.id === invoiceId
      ? { ...i, approvalState: "approved", approvedBy: user?.id, approvedAt: new Date().toISOString() }
      : i
  );
  return { ok: true, update: { invoices } };
}
