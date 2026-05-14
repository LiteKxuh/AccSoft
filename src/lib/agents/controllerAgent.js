/* HotelOps · Controller Agent
 * =================================================================
 * Forensic accountant's lens. Aggregates the financial forensics
 * findings + chain health + period close + approval backlog, then
 * delivers a risk-prioritized work list.
 */

import { factsBlock } from "./agentRuntime.js";
import { runForensics } from "../forensics.js";
import { chainHealth } from "../ledgerForensics.js";

export const CONTROLLER_AGENT = {
  id: "controller",
  label: "Controller Agent",
  description: "Forensic risk review: duplicates, payroll outliers, ghost revenue, chain integrity, approval backlog.",
  permissionAction: "je.view-chain",
  maxTokens: 1500,

  buildBriefing({ state, propertyId, asOf }) {
    const propFiltered = propertyId
      ? { ...state, journalEntries: (state.journalEntries || []).filter(j => j.propertyId === propertyId), invoices: (state.invoices || []).filter(i => i.propertyId === propertyId) }
      : state;
    const forensics = runForensics(propFiltered);
    const chain = chainHealth(state);
    const pendingJE = (state.journalEntries || []).filter(e => !e.void && e.posted && e.approvalState === "pending" && (!propertyId || e.propertyId === propertyId));
    const pendingAP = (state.invoices || []).filter(i => i.approvalState === "pending" && i.status !== "void" && (!propertyId || i.propertyId === propertyId));
    return {
      propertyId, asOf,
      riskScore: forensics.riskScore,
      riskBand: forensics.riskBand,
      findingCounts: forensics.counts,
      topFindings: forensics.findings.slice(0, 12),
      chainHealth: {
        totalEntries: chain.totalEntries,
        chainedEntries: chain.chainedEntries,
        unchainedPosted: chain.unchainedPosted,
        sessionCount: chain.sessionCount,
        healthyPct: chain.healthyPct,
      },
      approvalsPendingJE: pendingJE.length,
      approvalsPendingAP: pendingAP.length,
    };
  },

  deterministic(briefing) {
    const recs = [];
    const findings = [];
    if (briefing.chainHealth.unchainedPosted > 0) {
      findings.push(`${briefing.chainHealth.unchainedPosted} posted JE(s) missing chain hash — auditability gap.`);
      recs.push({ action: "Re-stamp the missing entries via Forensics → admin rebuild (controller only).", priority: "high" });
    }
    if (briefing.riskBand === "high" || briefing.riskBand === "critical") {
      findings.push(`Risk band is ${briefing.riskBand} (score ${briefing.riskScore}).`);
      recs.push({ action: "Open the Forensics Risk pane and triage the top 5 findings.", priority: "high" });
    }
    if (briefing.approvalsPendingJE + briefing.approvalsPendingAP > 10) {
      findings.push(`${briefing.approvalsPendingJE + briefing.approvalsPendingAP} items pending approval.`);
      recs.push({ action: "Work the Approval Inbox — items above your threshold escalate to regional.", priority: "medium" });
    }
    return { findings, recommendations: recs.slice(0, 6) };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a hotel controller reviewing forensic risk + ledger integrity.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "executiveSummary": "2-3 sentences for the regional controller",
  "topRisks": [{ "label": string, "severity": "high"|"medium"|"low", "cite": string }],
  "actionPlan": [{ "step": string, "owner": "controller"|"agm"|"gm", "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      executiveSummary: deterministic.findings[0] || `Risk band ${briefing.riskBand}. ${briefing.topFindings.length} active findings.`,
      topRisks: briefing.topFindings.slice(0, 6).map(f => ({ label: f.label, severity: f.severity, cite: f.code })),
      actionPlan: deterministic.recommendations.map(r => ({ step: r.action, owner: "controller", priority: r.priority })),
      evidence: [{ cite: "snap.riskScore", fact: String(briefing.riskScore) }],
    };
  },
};
