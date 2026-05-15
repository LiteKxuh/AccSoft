/* HotelOps · Payroll Audit Agent
 * =================================================================
 * Reads the payroll forensics output + the latest batch and gives a
 * controller-style readout: where to look, who to interview, what's
 * blocking sign-off.
 */

import { factsBlock } from "./agentRuntime.js";
import { runPayrollForensics } from "../workforce/payrollForensics.js";

export const PAYROLL_AUDIT_AGENT = {
  id: "payroll-audit",
  label: "Payroll Audit Agent",
  description: "Reviews payroll forensics + active batches before sign-off.",
  permissionAction: "je.view-chain",
  maxTokens: 1500,

  buildBriefing({ state }) {
    const forensics = runPayrollForensics(state);
    const openBatches = (state.payrollBatches || []).filter(b => b.status !== "posted");
    return {
      forensics: {
        riskScore: forensics.riskScore,
        riskBand: forensics.riskBand,
        counts: forensics.counts,
        topFindings: forensics.findings.slice(0, 10),
      },
      openBatches: openBatches.map(b => ({ id: b.id, status: b.status, periodEnd: b.periodEnd, totalGross: b.totals?.gross })),
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (briefing.forensics.riskBand === "high" || briefing.forensics.riskBand === "critical") {
      findings.push(`Payroll risk band: ${briefing.forensics.riskBand} (score ${briefing.forensics.riskScore}).`);
      recs.push({ action: "Triage the top 5 findings before approving the current batch.", priority: "high" });
    }
    const ghost = briefing.forensics.topFindings.filter(f => f.code === "ghost.no_shifts");
    if (ghost.length) {
      findings.push(`${ghost.length} ghost-employee candidate(s).`);
      recs.push({ action: "Verify each ghost candidate has a valid I-9 and active job code.", priority: "high" });
    }
    const buddy = briefing.forensics.topFindings.filter(f => f.code === "buddy.same_device");
    if (buddy.length) {
      findings.push(`${buddy.length} buddy-punch signal(s).`);
      recs.push({ action: "Pull device logs for the flagged kiosks; interview supervisors.", priority: "medium" });
    }
    return { findings, recommendations: recs.slice(0, 6) };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a payroll auditor.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "verdict": "ok-to-approve"|"hold"|"partial-hold",
  "summary": "2 sentences",
  "actionPlan": [{ "step": string, "owner": "controller"|"gm"|"agm", "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    const verdict = briefing.forensics.riskBand === "clean" || briefing.forensics.riskBand === "low" ? "ok-to-approve" : "partial-hold";
    return {
      verdict,
      summary: deterministic.findings[0] || "Payroll clean. No active findings.",
      actionPlan: deterministic.recommendations.map(r => ({ step: r.action, owner: "controller", priority: r.priority })),
      evidence: [{ cite: "snap.forensics.riskScore", fact: String(briefing.forensics.riskScore) }],
    };
  },
};
