/* HotelOps · Adjustments / corrections
 * =================================================================
 * Posted JEs are immutable. To "edit" a posted entry, an operator
 * creates a correction pair:
 *
 *   1) reversal of the original (auto)
 *   2) the corrected entry with the new values
 *
 * Both land in the chain; neither modifies historical data. The pair
 * shares a `correctionGroupId` so reports can collapse them visually.
 *
 *   buildReversal(original)         → reversing JE
 *   buildCorrectionPair(orig, fix)  → [reversal, replacement]
 *
 * The replacement preserves the original's date by default (the
 * accounting event still happened on that day), and the reversal
 * also uses the original date so MTD reports stay flat. Callers who
 * want the reversal "in the next period" can pass `reversalDate`.
 */

import { isBalanced, assertPostable } from "./gl.js";

let _adjCtr = 0;
function gid() {
  _adjCtr += 1;
  return `cg_${Date.now().toString(36)}_${_adjCtr.toString(36)}`;
}

export function buildReversal(orig, {
  reversalDate = null,
  reason = "Correction",
  user = null,
  correctionGroupId = null,
} = {}) {
  if (!orig || !Array.isArray(orig.lines) || orig.lines.length === 0) {
    throw new Error("buildReversal: original has no lines");
  }
  if (orig.void) {
    throw new Error("buildReversal: original is already voided");
  }
  return {
    id: `rev_${orig.id}_${Date.now().toString(36)}`,
    date: reversalDate || orig.date,
    propertyId: orig.propertyId,
    description: `Reversal · ${orig.description || ""}`.slice(0, 200),
    source: "auto-reversal",
    sourceId: orig.id,
    reversingOf: orig.id,
    correctionGroupId,
    lines: orig.lines.map(l => ({
      accountCode: l.accountCode,
      debit: Number(l.credit) || 0,
      credit: Number(l.debit) || 0,
      memo: l.memo ? `Reversal · ${l.memo}` : "Reversal",
    })),
    posted: true,
    createdAt: new Date().toISOString(),
    createdBy: user?.id || null,
    reason,
  };
}

/**
 * Build the [reversal, replacement] pair. The replacement carries the user's
 * edits; the reversal undoes the original. Both must be balanced before posting.
 *
 * @param {object} orig       original JE
 * @param {object} draft      the user's corrected entry — must contain new `lines`,
 *                            and optionally new `description` / `date` / `propertyId`.
 * @param {object} ctx        { closedPeriods?, chart?, user?, reversalDate?, reason? }
 */
export function buildCorrectionPair(orig, draft, ctx = {}) {
  const cgId = gid();
  const reversal = buildReversal(orig, {
    reversalDate: ctx.reversalDate || orig.date,
    reason: ctx.reason || "Correction",
    user: ctx.user,
    correctionGroupId: cgId,
  });
  const replacement = {
    id: `cor_${orig.id}_${Date.now().toString(36)}`,
    date: draft.date || orig.date,
    propertyId: draft.propertyId || orig.propertyId,
    description: draft.description || orig.description,
    source: orig.source && orig.source.startsWith("auto-") ? `manual-correction:${orig.source}` : "manual",
    sourceId: null,
    correctionGroupId: cgId,
    replacementOf: orig.id,
    lines: (draft.lines || []).map(l => ({
      accountCode: l.accountCode,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo || "",
    })),
    posted: true,
    createdAt: new Date().toISOString(),
    createdBy: ctx.user?.id || null,
    reason: ctx.reason || "Correction",
  };
  if (!isBalanced(replacement)) {
    throw new Error("buildCorrectionPair: replacement is not balanced");
  }
  if (!isBalanced(reversal)) {
    throw new Error("buildCorrectionPair: reversal is not balanced");
  }
  if (ctx.chart || ctx.closedPeriods) {
    assertPostable(reversal,    { closedPeriods: ctx.closedPeriods, chart: ctx.chart });
    assertPostable(replacement, { closedPeriods: ctx.closedPeriods, chart: ctx.chart });
  }
  return { reversal, replacement, correctionGroupId: cgId };
}

/** Mark the source as voided once the reversal is in the books. */
export function markVoided(orig, reversal, { user = null, reason = null } = {}) {
  return {
    ...orig,
    void: true,
    voidedBy: reversal.id,
    voidedAt: new Date().toISOString(),
    voidedByUser: user?.id || null,
    voidReason: reason || "Correction",
  };
}
