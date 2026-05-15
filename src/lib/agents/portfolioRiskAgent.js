/* HotelOps · Portfolio Risk Agent
 * =================================================================
 * Reads the kernel's portfolio graph + unified risk intelligence
 * across every property and produces a regional risk briefing.
 * Intended audience: regional director, ownership, or controller.
 */

import { factsBlock } from "./agentRuntime.js";
import { buildPortfolioGraph } from "../hotelOperatingKernel.js";
import { runPortfolioRisk } from "../riskIntelligenceEngine.js";

export const PORTFOLIO_RISK_AGENT = {
  id: "portfolio-risk",
  label: "Portfolio Risk Agent",
  description: "Cross-property risk briefing: ledger, payroll, AP, operational waste. Ranks worst offenders.",
  permissionAction: "report.view",
  maxTokens: 1500,

  buildBriefing({ state, propertyIds, asOf, period = null, enrichReport = null }) {
    const portfolio = buildPortfolioGraph(state, { propertyIds, asOf, enrichReport });
    const risk = runPortfolioRisk(state, { propertyIds, period, asOf });
    return {
      asOf,
      propertyCount: portfolio.coverage?.evaluated || 0,
      portfolioIndices: portfolio.portfolio || null,
      worstByHealth: portfolio.ranking?.bottom || [],
      worstByRisk: risk.worst || [],
      avgRiskScore: risk.avgScore || 0,
      perProperty: (risk.perProperty || []).map(r => ({
        propertyId: r.propertyId,
        riskScore: r.riskScore,
        riskBand: r.riskBand,
        topFindings: (r.findings || []).slice(0, 3).map(f => ({ code: f.code, severity: f.severity, label: f.label })),
      })),
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (briefing.avgRiskScore > 20) {
      findings.push(`Portfolio average risk score ${briefing.avgRiskScore} is elevated.`);
      recs.push({ action: "Schedule a controller-led portfolio review this week.", priority: "high" });
    }
    if ((briefing.worstByRisk || []).length) {
      const w = briefing.worstByRisk[0];
      findings.push(`Highest-risk property: ${w.propertyId} (band ${w.riskBand}, score ${w.riskScore}).`);
      recs.push({ action: `Open property ${w.propertyId} risk pane and triage top 3 findings.`, priority: "high" });
    }
    if ((briefing.worstByHealth || [])[0]) {
      const w = briefing.worstByHealth[0];
      findings.push(`Lowest-health property: ${w.propertyId} (health ${w.health}).`);
    }
    return { findings, recommendations: recs };
  },

  promptBuilder(briefing, deterministic) {
    return `You are the portfolio risk officer for a multi-property hotel group.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "executiveSummary": "2-3 sentences for the regional director",
  "topRisks": [{ "propertyId": string, "label": string, "severity": "high"|"medium"|"low", "cite": string }],
  "portfolioActions": [{ "step": string, "owner": string, "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      executiveSummary: deterministic.findings[0] || `Portfolio risk score averaging ${briefing.avgRiskScore}.`,
      topRisks: (briefing.worstByRisk || []).slice(0, 5).map(r => ({
        propertyId: r.propertyId, label: `${r.riskBand} band (${r.riskScore})`, severity: "high", cite: `risk.perProperty.${r.propertyId}`,
      })),
      portfolioActions: deterministic.recommendations.map(r => ({ step: r.action, owner: "regional", priority: r.priority })),
      evidence: [{ cite: "snap.avgRiskScore", fact: String(briefing.avgRiskScore) }],
    };
  },
};
