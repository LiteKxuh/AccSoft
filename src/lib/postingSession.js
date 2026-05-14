/* HotelOps · Posting sessions
 * =================================================================
 * A posting session groups every journal entry produced by a single
 * operator action — "post May 12 night audit", "month-end accruals",
 * "AP run 2026-05-14". Sessions give forensic recovery a unit of work:
 * if a batch is wrong, reverse the whole session in one step.
 *
 * Sessions live in state.postingSessions:
 *   {
 *     id, startedAt, completedAt, closedAt?,
 *     reason: "night-audit" | "ap-run" | "payroll" | "manual" | "accrual" | "reversal",
 *     user, sourceRef?,
 *     entryIds: [...],
 *     status: "open" | "closed" | "reversed",
 *     summary: { entryCount, totalDebit, totalCredit },
 *     chainRoot: "<hash of last entry in session>",
 *     reversedBy?: sessionId,
 *   }
 */

import { toCents } from "./money.js";

let _ctr = 0;
function nid() {
  _ctr += 1;
  return `ps_${Date.now().toString(36)}_${_ctr.toString(36)}`;
}

export function beginSession({ reason = "manual", user = null, sourceRef = null, note = null } = {}) {
  return {
    id: nid(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    closedAt: null,
    reason,
    user: user?.id || user || null,
    userName: user?.name || null,
    sourceRef,
    note,
    entryIds: [],
    status: "open",
    summary: { entryCount: 0, totalDebit: 0, totalCredit: 0 },
    chainRoot: null,
    reversedBy: null,
  };
}

/** Attach a session id to each entry and return updated session + entries. */
export function attachToSession(session, entries) {
  if (!session || session.status !== "open") {
    throw new Error("attachToSession: session is not open");
  }
  let debitCents = 0, creditCents = 0;
  const tagged = (entries || []).map((e) => {
    for (const l of (e.lines || [])) {
      debitCents += toCents(l.debit);
      creditCents += toCents(l.credit);
    }
    return { ...e, postingSessionId: session.id };
  });
  const nextSession = {
    ...session,
    entryIds: [...session.entryIds, ...tagged.map(e => e.id)],
    summary: {
      entryCount: session.summary.entryCount + tagged.length,
      totalDebit: session.summary.totalDebit + debitCents / 100,
      totalCredit: session.summary.totalCredit + creditCents / 100,
    },
  };
  return { session: nextSession, entries: tagged };
}

/** Mark the session done and snapshot the latest chainRoot. */
export function completeSession(session, chainRoot = null) {
  return {
    ...session,
    completedAt: new Date().toISOString(),
    status: "closed",
    chainRoot,
  };
}

/** Build a reversing session that contains opposite-side entries for every JE in the source session. */
export function reverseSession(srcSession, srcEntries, { user, note = null, date = null } = {}) {
  if (!srcSession || srcSession.status === "reversed") {
    throw new Error("reverseSession: source session is missing or already reversed");
  }
  const entryById = new Map((srcEntries || []).map(e => [e.id, e]));
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const rev = beginSession({
    reason: "reversal",
    user,
    sourceRef: { type: "session", id: srcSession.id },
    note: note || `Reversal of session ${srcSession.id}`,
  });
  const reversedEntries = [];
  for (const id of srcSession.entryIds) {
    const orig = entryById.get(id);
    if (!orig || orig.void) continue;
    reversedEntries.push({
      id: `rev_${orig.id}_${rev.id}`,
      date: targetDate,
      propertyId: orig.propertyId,
      description: `Reversal · ${orig.description || ""}`.slice(0, 200),
      source: "auto-reversal",
      sourceId: orig.id,
      reversingOf: orig.id,
      lines: (orig.lines || []).map(l => ({
        accountCode: l.accountCode,
        debit: Number(l.credit) || 0,
        credit: Number(l.debit) || 0,
        memo: l.memo ? `Reversal · ${l.memo}` : "Reversal",
      })),
      posted: true,
      createdAt: new Date().toISOString(),
      createdBy: user?.id || null,
    });
  }
  return { reversalSession: rev, reversalEntries: reversedEntries };
}

/** Convenience for the UI — find the session a JE belongs to. */
export function findSessionForEntry(sessions, entryId) {
  return (sessions || []).find(s => (s.entryIds || []).includes(entryId)) || null;
}

/** A summary line for activity feeds. */
export function describeSession(s) {
  if (!s) return "";
  const parts = [s.reason, `${s.summary.entryCount} entr${s.summary.entryCount === 1 ? "y" : "ies"}`];
  if (s.summary.totalDebit) parts.push(`$${s.summary.totalDebit.toFixed(2)}`);
  if (s.status === "reversed") parts.push("(reversed)");
  return parts.join(" · ");
}
