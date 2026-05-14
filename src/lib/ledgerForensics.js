/* HotelOps · Ledger forensics
 * =================================================================
 * Operator-facing wrapper over ledgerChain.js + postingSession.js.
 * Surfaces tamper evidence and lineage in a form that's safe to
 * show in the UI without leaking hash internals.
 *
 *   verifyLedger(state)
 *     → { ok, brokenAt, entry, expected, actual, reason, length }
 *
 *   sessionTimeline(state, { propertyId?, range? })
 *     → [{ id, startedAt, reason, user, entryCount, totalDebit,
 *          totalCredit, status, chainRoot, properties }]
 *
 *   entryLineage(state, entryId)
 *     → { entry, session, reversingOf, replacementOf, voidedBy, chain }
 *
 *   chainHealth(state)
 *     → { totalEntries, chainedEntries, gaps, sessionBreaks }
 */

import { verifyChain, chainOrder } from "./ledgerChain.js";

function safeSlice(s, n) { return String(s || "").slice(0, n); }

export async function verifyLedger(state) {
  const entries = state?.journalEntries || [];
  return verifyChain(entries);
}

export function sessionTimeline(state, { propertyId = null, range = null } = {}) {
  const sessions = state?.postingSessions || [];
  const entries = new Map((state?.journalEntries || []).map(j => [j.id, j]));
  return sessions
    .map(s => {
      const sessEntries = (s.entryIds || []).map(id => entries.get(id)).filter(Boolean);
      const properties = Array.from(new Set(sessEntries.map(e => e.propertyId))).filter(Boolean);
      if (propertyId && !properties.includes(propertyId)) return null;
      if (range && (s.startedAt < range.start || s.startedAt > range.end)) return null;
      return {
        id: s.id,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        reason: s.reason,
        user: s.user,
        userName: s.userName,
        entryCount: sessEntries.length,
        totalDebit: s.summary?.totalDebit || 0,
        totalCredit: s.summary?.totalCredit || 0,
        status: s.status,
        chainRoot: s.chainRoot ? safeSlice(s.chainRoot, 12) : null,
        properties,
        reversedBy: s.reversedBy || null,
        note: s.note || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

export function entryLineage(state, entryId) {
  const entries = state?.journalEntries || [];
  const sessions = state?.postingSessions || [];
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return null;
  const session = entry.postingSessionId ? sessions.find(s => s.id === entry.postingSessionId) : null;
  const reversingOf = entry.reversingOf ? entries.find(e => e.id === entry.reversingOf) : null;
  const replacementOf = entry.replacementOf ? entries.find(e => e.id === entry.replacementOf) : null;
  const voidedBy = entry.voidedBy ? entries.find(e => e.id === entry.voidedBy) : null;
  return {
    entry,
    session,
    reversingOf,
    replacementOf,
    voidedBy,
    chainPrev: entry.chainPrev,
    chainHash: entry.chainHash,
  };
}

export function chainHealth(state) {
  const all = state?.journalEntries || [];
  const chained = chainOrder(all);
  const sessions = state?.postingSessions || [];
  const sessionIds = new Set(sessions.map(s => s.id));
  // Entries with sessionId pointer but no matching session row
  const orphanSessionRefs = all.filter(e => e.postingSessionId && !sessionIds.has(e.postingSessionId)).length;
  // Entries posted but missing chainHash
  const unchained = all.filter(e => e.posted && !e.void && !e.chainHash).length;
  return {
    totalEntries: all.length,
    chainedEntries: chained.length,
    unchainedPosted: unchained,
    orphanSessionRefs,
    sessionCount: sessions.length,
    healthyPct: chained.length + unchained > 0 ? chained.length / (chained.length + unchained) : 1,
  };
}
