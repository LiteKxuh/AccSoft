/* HotelOps · AP Intelligence Agent
 * =================================================================
 * Inspects AP exposure: duplicates, new-vendor patterns, aging, and
 * over-budget capex commitments. Routes recommendations to controller.
 */

import { factsBlock } from "./agentRuntime.js";
import { detectDuplicateInvoices, detectVendorBehavior } from "../forensics.js";
import { apAging } from "../aging.js";

export const AP_INTELLIGENCE_AGENT = {
  id: "ap-intelligence",
  label: "AP Intelligence Agent",
  description: "AP forensics: duplicates, new-vendor risk, aged exposure, payment-run sanity.",
  permissionAction: "ap.approve",
  maxTokens: 1300,

  buildBriefing({ state, propertyId, asOf }) {
    const invoices = (state.invoices || []).filter(i => !propertyId || i.propertyId === propertyId);
    const duplicates = detectDuplicateInvoices(invoices);
    const vendorBehavior = detectVendorBehavior(invoices, state.vendors || []);
    const aging = apAging({
      invoices, vendors: state.vendors || [], propIds: propertyId ? [propertyId] : null, asOf: new Date(asOf),
    });
    const pending = invoices.filter(i => i.approvalState === "pending" && i.status !== "void");
    return {
      propertyId, asOf,
      invoiceCount: invoices.length,
      pendingApprovalCount: pending.length,
      pendingApprovalDollar: pending.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      agingTotals: aging.totals,
      duplicateFindings: duplicates.slice(0, 8),
      newVendorFlags: vendorBehavior.slice(0, 5),
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if ((briefing.duplicateFindings || []).length) {
      findings.push(`${briefing.duplicateFindings.length} duplicate / likely-duplicate invoice cluster(s).`);
      recs.push({ action: "Open the AP module → Duplicate Review.", priority: "high" });
    }
    if ((briefing.agingTotals?.b120 || 0) > 0) {
      findings.push(`$${briefing.agingTotals.b120.toFixed(0)} aged over 120 days.`);
      recs.push({ action: "Push the over-120 list — vendor relationship at risk.", priority: "high" });
    }
    if ((briefing.newVendorFlags || []).length) {
      findings.push(`${briefing.newVendorFlags.length} new-vendor large-invoice flag(s).`);
      recs.push({ action: "Verify W-9 / COI / ACH for new vendors before paying.", priority: "medium" });
    }
    if (briefing.pendingApprovalDollar > 25_000) {
      findings.push(`$${briefing.pendingApprovalDollar.toFixed(0)} pending approval.`);
      recs.push({ action: "Drain the AP Approval Inbox — items above threshold are escalating.", priority: "medium" });
    }
    return { findings, recommendations: recs };
  },

  promptBuilder(briefing, deterministic) {
    return `You are an AP supervisor reviewing weekly exposure.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "2 sentences",
  "redFlags": [{ "label": string, "severity": "high"|"medium"|"low", "cite": string }],
  "nextSteps": [{ "step": string, "priority": "high"|"medium"|"low", "owner": string }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      summary: deterministic.findings.join(" "),
      redFlags: [
        ...(briefing.duplicateFindings || []).map(f => ({ label: f.label, severity: f.severity, cite: `duplicateFindings.${f.id}` })),
        ...(briefing.newVendorFlags || []).map(f => ({ label: f.label, severity: f.severity, cite: `newVendorFlags.${f.id}` })),
      ].slice(0, 6),
      nextSteps: deterministic.recommendations.map(r => ({ step: r.action, priority: r.priority, owner: "ap" })),
      evidence: [{ cite: "snap.agingTotals.b120", fact: String(briefing.agingTotals?.b120 || 0) }],
    };
  },
};
