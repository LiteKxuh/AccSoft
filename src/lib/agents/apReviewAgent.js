/* HotelOps · AP Review Agent
 * =================================================================
 * Reviews open AP, flags duplicates, vendor diligence, and aging.
 * Uses forensics + aging + idempotency awareness. Pre-payment-run
 * sanity pass.
 */

import { factsBlock } from "./agentRuntime.js";
import { apAging } from "../aging.js";
import { detectDuplicateInvoices, detectVendorBehavior, detectApprovalBypass } from "../forensics.js";

export const AP_REVIEW_AGENT = {
  id: "ap-review",
  label: "AP Review Agent",
  description: "Pre-payment AP review: duplicates, aging hotspots, vendor diligence, approval bypass.",
  permissionAction: "ap.approve",
  maxTokens: 1200,

  buildBriefing({ state, propertyId, asOf }) {
    const propIds = propertyId ? [propertyId] : undefined;
    const ap = apAging({ invoices: state.invoices || [], vendors: state.vendors || [], propIds, asOf: new Date(asOf) });
    const dupes = detectDuplicateInvoices(state.invoices || []);
    const vendor = detectVendorBehavior(state.invoices || [], state.vendors || []);
    const bypass = detectApprovalBypass([], state.invoices || []); // invoice-only path
    return {
      propertyId, asOf,
      aging: ap.totals,
      weightedAverageDays: ap.weightedAverageDays,
      topVendors: ap.byVendor.slice(0, 10),
      duplicates: dupes.slice(0, 12),
      vendorDiligence: vendor.slice(0, 8),
      approvalBypass: bypass.slice(0, 6),
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (briefing.duplicates.length) {
      findings.push(`${briefing.duplicates.length} suspected duplicate invoice(s).`);
      recs.push({ action: "Review and void the duplicates before the next payment run.", priority: "high" });
    }
    if (briefing.approvalBypass.length) {
      findings.push(`${briefing.approvalBypass.length} invoice(s) paid without approval.`);
      recs.push({ action: "Backfill the approval trail or document the policy exception.", priority: "high" });
    }
    if ((briefing.aging.b120 || 0) > 0) {
      findings.push(`$${briefing.aging.b120.toFixed(0)} over 120 days — vendor relationships at risk.`);
      recs.push({ action: "Reach out to top-aged vendors with a settlement plan.", priority: "medium" });
    }
    if (briefing.vendorDiligence.length) {
      findings.push(`${briefing.vendorDiligence.length} new vendor(s) with large first invoices.`);
      recs.push({ action: "Verify W-9 / bank instructions for new vendors before paying.", priority: "high" });
    }
    return { findings, recommendations: recs.slice(0, 5) };
  },

  promptBuilder(briefing, deterministic) {
    return `You are reviewing A/P before a payment run.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "verdict": "ok-to-pay"|"hold"|"partial-hold",
  "summary": "1-2 sentence read",
  "actionItems": [{ "item": string, "owner": "controller"|"agm", "priority": "high"|"medium"|"low", "cite": string }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    const verdict = briefing.duplicates.length > 0 || briefing.approvalBypass.length > 0 ? "partial-hold" : "ok-to-pay";
    return {
      verdict,
      summary: deterministic.findings[0] || "A/P clean. Aging within normal ranges.",
      actionItems: deterministic.recommendations.map((r, i) => ({ item: r.action, owner: "controller", priority: r.priority, cite: "deterministic.findings" })),
      evidence: [{ cite: "snap.aging.b120", fact: String(briefing.aging.b120 || 0) }],
    };
  },
};
