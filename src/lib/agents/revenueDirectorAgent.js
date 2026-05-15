/* HotelOps · Revenue Director Agent
 * =================================================================
 * Top-of-stack revenue strategist. Reads revenueAIEngine output and
 * frames a directive list for the on-property RM team. Goes beyond
 * the operational Revenue Agent — this one prioritizes across nights,
 * channels, and segments.
 */

import { factsBlock } from "./agentRuntime.js";
import { runRevenueAI } from "../revenueAIEngine.js";

export const REVENUE_DIRECTOR_AGENT = {
  id: "revenue-director",
  label: "Revenue Director Agent",
  description: "Top-of-stack revenue strategy: opportunity ranking, segment mix, OTA dependency, elasticity.",
  permissionAction: "forecast.view",
  maxTokens: 1600,

  buildBriefing({ state, propertyId, asOf, enrichReport = null, capacity = null }) {
    const ai = runRevenueAI({ state, propertyId, asOf, capacity, enrichReport });
    return {
      propertyId, asOf,
      tier: state.properties?.find(p => p.id === propertyId)?.tier || null,
      elasticity: ai.elasticity,
      otaDependency: ai.otaDependency,
      demandVolatility: ai.demandVolatility,
      segmentProfitability: ai.segmentProfitability?.status === "ok"
        ? ai.segmentProfitability.segments.slice(0, 6).map(s => ({
            segment: s.segment, revenue: s.revenue, netAdr: s.netAdr, acquisitionPct: s.acquisitionPct, contributionMargin: s.contributionMargin,
          }))
        : null,
      opportunities: ai.opportunities?.opportunities?.slice(0, 8) || [],
      summary: ai.opportunities?.summary || null,
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (briefing.elasticity?.status === "ok" && briefing.elasticity.elasticity < -1) {
      findings.push(`Demand is very price-sensitive (elasticity ${briefing.elasticity.elasticity}) — avoid aggressive lifts.`);
    }
    if (briefing.otaDependency?.status === "ok" && (briefing.otaDependency.band === "high" || briefing.otaDependency.band === "critical")) {
      findings.push(`OTA share ${(briefing.otaDependency.otaShare * 100).toFixed(0)}% — direct-channel margin opportunity.`);
      recs.push({ action: briefing.otaDependency.recommendation, priority: "high" });
    }
    const highOpps = (briefing.opportunities || []).filter(o => o.severity === "high");
    for (const o of highOpps.slice(0, 3)) {
      findings.push(`${o.label} — ${o.rationale}`);
      recs.push({ action: o.action || `Address ${o.code}`, priority: "high" });
    }
    if (briefing.demandVolatility?.status === "ok" && briefing.demandVolatility.band === "very-high") {
      findings.push("Demand volatility very high — reinforce group base or corporate negotiated rates.");
    }
    return { findings, recommendations: recs };
  },

  promptBuilder(briefing, deterministic) {
    return `You are the regional Director of Revenue for a hotel group.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "2-3 sentences for an ownership group",
  "weeklyPriorities": [{ "priority": string, "rationale": string, "cite": string }],
  "channelStrategy": { "ota": string, "direct": string, "group": string },
  "scenarios": [{ "name": string, "ifThen": string }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      summary: deterministic.findings.join(" ") || "Revenue strategy nominal.",
      weeklyPriorities: (briefing.opportunities || []).slice(0, 5).map(o => ({
        priority: o.label, rationale: o.rationale, cite: `opportunities.${o.code}`,
      })),
      channelStrategy: {
        ota: briefing.otaDependency?.recommendation || "Hold mix",
        direct: "Promote direct via loyalty + best-rate-guarantee",
        group: briefing.demandVolatility?.band === "very-high" ? "Add group base to smooth volatility" : "Maintain group mix",
      },
      scenarios: deterministic.recommendations.slice(0, 3).map(r => ({ name: "Action", ifThen: r.action })),
      evidence: [{ cite: "snap.summary.expectedTotalLift", fact: String(briefing.summary?.expectedTotalLift || 0) }],
    };
  },
};
