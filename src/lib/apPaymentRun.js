/* HotelOps · AP payment run workflow
 * =================================================================
 * Wraps NACHA file generation, posting session, idempotency, and JE
 * creation into a single atomic operation:
 *
 *   1) Caller selects approved & unpaid invoices.
 *   2) buildPaymentRun() validates: every invoice must be approved,
 *      open, in scope. Refuses on first inconsistency.
 *   3) reservePaymentRun() takes an idempotency lock so a double-click
 *      doesn't generate two NACHA files / double-post.
 *   4) commitPaymentRun() emits:
 *        - posting session (reason: "ap-run")
 *        - JE per invoice: Dr A/P, Cr Bank
 *        - invoices updated with status=paid + paidDate
 *        - NACHA file payload via apAutomation.generateNACHA
 *
 * Returns a single state patch the caller passes to update().
 */

import { generateNACHA } from "./apAutomation.js";
import { beginSession, attachToSession, completeSession } from "./postingSession.js";
import { reserveKey } from "./idempotency.js";
import { isBalanced } from "./gl.js";
import { fromCents, toCents } from "./money.js";

const RUN_KEY_PREFIX = "ap-payment-run::";

/**
 * Validate the selected invoices for posting. Returns the run plan or throws.
 *
 * @param {object} input
 * @param {Array}  input.invoices          state.invoices
 * @param {Array}  input.vendors           state.vendors
 * @param {Array}  input.selectedIds       array of invoice IDs
 * @param {string} input.bankAccountCode   e.g. "1020"
 */
export function buildPaymentRun({ invoices, vendors, selectedIds, bankAccountCode = "1020" }) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw makeErr("AP_RUN_EMPTY", "No invoices selected.");
  }
  const lookup = new Map((invoices || []).map(i => [i.id, i]));
  const vlookup = new Map((vendors || []).map(v => [v.id, v]));
  const lines = [];
  let totalAmountCents = 0;
  for (const id of selectedIds) {
    const inv = lookup.get(id);
    if (!inv) throw makeErr("AP_RUN_MISSING", `Invoice ${id} not found.`);
    if (inv.status === "paid") throw makeErr("AP_RUN_ALREADY_PAID", `Invoice ${id} is already paid.`);
    if (inv.status === "void") throw makeErr("AP_RUN_VOIDED", `Invoice ${id} is voided.`);
    if (inv.approvalState !== "approved") throw makeErr("AP_RUN_UNAPPROVED", `Invoice ${id} is not approved.`);
    const vendor = vlookup.get(inv.vendorId);
    const amt = Number(inv.amount) || 0;
    if (amt <= 0) throw makeErr("AP_RUN_BAD_AMOUNT", `Invoice ${id} has non-positive amount.`);
    lines.push({ invoice: inv, vendor, amount: amt });
    totalAmountCents += toCents(amt);
  }
  return {
    lines,
    totalAmount: fromCents(totalAmountCents),
    bankAccountCode,
  };
}

/** Idempotency-key reserve. Returns true if the run can proceed. */
export function reservePaymentRun({ propertyId, effectiveDate, selectedIds }) {
  const key = `${RUN_KEY_PREFIX}${propertyId}::${effectiveDate}::${selectedIds.slice().sort().join(",")}`;
  return reserveKey(key, { ttlHours: 24 });
}

/**
 * Generate NACHA + the posting session + the AP payment JEs + the
 * invoice updates. Returns { patch, nacha, session } — the caller
 * passes patch to update().
 *
 * @param {object} input
 * @param {object} input.plan            output of buildPaymentRun
 * @param {object} input.company         { name, taxId, originatingDfi, bankName? }
 * @param {string} input.effectiveDate   YYYY-MM-DD
 * @param {object} input.user
 * @param {string} input.propertyId
 */
export function commitPaymentRun({ plan, company, effectiveDate, user, propertyId }) {
  if (!plan?.lines?.length) throw makeErr("AP_RUN_EMPTY", "No invoices in run.");
  if (!company?.name) throw makeErr("AP_RUN_NO_COMPANY", "Originating company info missing.");
  if (!effectiveDate) throw makeErr("AP_RUN_NO_DATE", "Effective date required.");

  // Build payments payload for NACHA
  const payments = plan.lines.map(({ invoice, vendor, amount }) => ({
    id: invoice.id,
    payeeName: vendor?.name || "(unknown)",
    payeeAccountNumber: vendor?.bankAccountNumber || "",
    payeeRoutingNumber: vendor?.bankRoutingNumber || "",
    accountType: vendor?.bankAccountType || "checking",
    amount,
    addenda: invoice.number || invoice.invoiceNumber || "",
  }));

  // NACHA file (text payload; the caller offers download)
  let nacha;
  try {
    nacha = generateNACHA({ company, effectiveDate, payments });
  } catch (e) {
    throw makeErr("AP_RUN_NACHA_FAILED", e.message || "NACHA generation failed");
  }

  // Posting session
  let session = beginSession({ reason: "ap-run", user, sourceRef: { type: "ap-payment-run", id: nacha.filename }, note: `${plan.lines.length} invoices · ${plan.totalAmount.toFixed(2)}` });

  // One JE per invoice: Dr 2010 (A/P), Cr bank
  const jes = plan.lines.map(({ invoice, vendor, amount }) => ({
    id: `apjepay_${invoice.id}_${session.id}`,
    date: effectiveDate,
    propertyId: invoice.propertyId || propertyId,
    description: `AP payment · ${vendor?.name || "vendor"} · ${invoice.number || invoice.invoiceNumber || invoice.id}`,
    source: "auto-from-ap-payment",
    sourceId: invoice.id,
    posted: true,
    lines: [
      { accountCode: "2010", debit: amount, credit: 0, memo: `A/P clear · ${vendor?.name || ""}` },
      { accountCode: plan.bankAccountCode, debit: 0, credit: amount, memo: `Bank payment · ${vendor?.name || ""}` },
    ],
    createdAt: new Date().toISOString(),
    createdBy: user?.id || null,
    approvalState: "approved",
  }));
  // Validate every JE balances
  for (const je of jes) {
    if (!isBalanced(je)) throw makeErr("AP_RUN_JE_UNBALANCED", `JE ${je.id} did not balance.`);
  }
  const attach = attachToSession(session, jes);
  session = completeSession(attach.session);

  // Invoice patches: mark each paid
  const updatedInvoices = plan.lines.map(({ invoice }) => ({
    ...invoice,
    status: "paid",
    paidDate: effectiveDate,
    paidBy: user?.id || null,
    paymentSessionId: session.id,
  }));

  return {
    patch: {
      // Append new JEs and the session (caller merges with existing arrays)
      __append: {
        journalEntries: attach.entries,
        postingSessions: [session],
      },
      __replaceById: {
        invoices: updatedInvoices,
      },
    },
    nacha,
    session,
  };
}

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
