/* HotelOps · Night Audit Agent
 * =================================================================
 * Operational specialist: reviews the night audit reconciliation
 * findings + anomalies + ledger health, then explains what to verify
 * before rolling the date. NEVER decides; it surfaces decisions.
 */

import { factsBlock } from "./agentRuntime.js";
import { runNightAudit } from "../nightAudit.js";
import { localAnomalies, buildBaseline } from "../aiOps.js";

export const NIGHT_AUDIT_AGENT = {
  id: "night-audit",
  label: "Night Audit Agent",
  description: "Reviews the night audit reconciliation, anomalies, and settlement integrity before rollover.",
  permissionAction: "audit.run",
  maxTokens: 1200,

  buildBriefing({ state, propertyId, asOf, enrichReport }) {
    const enrich = enrichReport || ((r) => r);
    const propReports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
    const today = propReports.find(r => r.date === asOf);
    const baseline = buildBaseline(propReports, propertyId, asOf);
    const auditResult = today ? runNightAudit(today, state.properties?.find(p => p.id === propertyId)?.settings || null) : null;
    const anomalies = today ? localAnomalies(today, baseline) : [];
    return {
      propertyId,
      asOf,
      hasReport: !!today,
      todayMetrics: today ? {
        roomsSold: today.roomsSold,
        roomsAvailable: today.roomsAvailable,
        occupancy: today.occupancy,
        adr: today.adr,
        revpar: today.revpar,
        totalRevenue: today.totalRevenue,
      } : null,
      baseline,
      auditScore: auditResult?.score,
      auditStatus: auditResult?.status,
      auditChecks: auditResult?.checks?.map(c => ({ id: c.id, status: c.status, label: c.label, detail: c.detail, severity: c.severity })) || [],
      anomalies,
    };
  },

  deterministic(briefing) {
    const top = [];
    if (!briefing.hasReport) {
      return {
        rollover: { safe: false, reason: "no-report-posted" },
        topActions: ["Post tonight's audit before any rollover attempt."],
        findings: [],
      };
    }
    if (briefing.auditStatus === "fail") {
      top.push("Do NOT roll the date — at least one hard-fail check is unresolved.");
    }
    const failingChecks = (briefing.auditChecks || []).filter(c => c.status === "fail");
    for (const c of failingChecks) top.push(`Resolve: ${c.label} (${c.detail})`);
    const highSevAnoms = (briefing.anomalies || []).filter(a => a.severity === "high");
    for (const a of highSevAnoms) top.push(`Investigate: ${a.label}`);
    return {
      rollover: { safe: briefing.auditStatus === "pass", reason: briefing.auditStatus },
      topActions: top.slice(0, 5),
      findings: [...failingChecks, ...highSevAnoms].slice(0, 8),
    };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a night auditor reviewing the reconciliation results below for ${briefing.propertyId} on ${briefing.asOf}.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "verdict": "safe-to-roll" | "needs-review" | "hold",
  "summary": "2 short sentences for the morning manager log",
  "rootCauses": [{ "hypothesis": string, "evidence": string, "cite": string }],
  "recommendations": [{ "action": string, "owner": "night-auditor" | "agm" | "controller", "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": "snap.path.to.fact", "fact": "what you cited" }]
}

Reference ONLY the numbers in FACTS. The verdict must align with deterministic.rollover.safe.`;
  },

  localFallback(briefing, deterministic) {
    const verdict = deterministic.rollover.safe ? "safe-to-roll" : briefing.auditStatus === "fail" ? "hold" : "needs-review";
    return {
      verdict,
      summary: !briefing.hasReport
        ? "No report posted for tonight. Roll cannot proceed."
        : verdict === "safe-to-roll"
          ? `Audit clean (${briefing.auditScore}/100). All deterministic checks passed.`
          : `Audit returned ${verdict}. ${deterministic.findings.length} item(s) need resolution before rolling.`,
      rootCauses: [],
      recommendations: deterministic.topActions.map(a => ({ action: a, owner: "night-auditor", priority: "high" })),
      evidence: [{ cite: "snap.auditScore", fact: String(briefing.auditScore) }],
    };
  },
};
