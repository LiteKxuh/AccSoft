/* HotelOps · Guest Experience Agent
 * =================================================================
 * Reads guestExperienceEngine output + kernel op graph and produces a
 * service-recovery directive. Pinpoints department root cause where
 * possible (housekeeping, maintenance, front desk).
 */

import { factsBlock } from "./agentRuntime.js";
import { analyzeGuestExperience } from "../guestExperienceEngine.js";
import { buildOperationalGraph } from "../hotelOperatingKernel.js";

export const GUEST_EXPERIENCE_AGENT = {
  id: "guest-experience",
  label: "Guest Experience Agent",
  description: "Service recovery and root-cause: complaints, sentiment trend, department blame map.",
  permissionAction: "report.view",
  maxTokens: 1400,

  buildBriefing({ state, propertyId, asOf, enrichReport = null, period = null }) {
    const feedback = state.guestFeedback || [];
    const effectivePeriod = period || { start: asOf.slice(0, 7) + "-01", end: asOf };
    const enrich = enrichReport || (r => r);
    const roomsSold = (state.reports || [])
      .filter(r => r.propertyId === propertyId && r.date >= effectivePeriod.start && r.date <= effectivePeriod.end)
      .map(enrich)
      .reduce((s, r) => s + (Number(r.roomsSold) || 0), 0);
    const opGraph = buildOperationalGraph(state, { propertyId, asOf, enrichReport });
    const analysis = analyzeGuestExperience({
      feedback, propertyId, period: effectivePeriod, opGraph, roomsSoldInPeriod: roomsSold,
    });
    return {
      propertyId, asOf, period: effectivePeriod,
      hasFeedback: analysis.status === "ok",
      volume: analysis.volume || 0,
      avgRating: analysis.avgRating || null,
      complaintRate: analysis.complaintRate || null,
      sentiment: analysis.sentimentDistribution || null,
      trend: analysis.trend || null,
      topCategories: (analysis.categories || []).slice(0, 5),
      topComplaints: (analysis.topComplaints || []).slice(0, 5),
      correlations: analysis.correlations || [],
      opIndices: opGraph.status === "ok" ? opGraph.indices : null,
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (!briefing.hasFeedback) {
      findings.push("No guest feedback ingested for this period.");
      return { findings, recommendations: [] };
    }
    if (briefing.trend?.direction === "deteriorating") {
      findings.push(`Sentiment deteriorating (slope ${briefing.trend.slope}).`);
      recs.push({ action: "Walk a sample of rooms with the GM + DOH today.", priority: "high" });
    }
    const top = (briefing.topCategories || [])[0];
    if (top && top.avgSentiment < -0.2) {
      findings.push(`Top complaint area: ${top.category} (${top.count} mentions, sentiment ${top.avgSentiment.toFixed(2)}).`);
      const owner = {
        housekeeping: "DOH", maintenance: "DOE", front_desk: "FOM",
        food_beverage: "DOFB", noise: "GM", pricing: "GM",
        parking: "GM", cleanliness: "DOH", safety: "Security", pets_pests: "DOH",
      }[top.category] || "GM";
      recs.push({ action: `Brief ${owner} and run a targeted audit of ${top.category} touchpoints.`, priority: "high" });
    }
    if (briefing.correlations?.some(c => c.opPressure === "high-staffing-stress")) {
      recs.push({ action: "Labor pressure may be the root cause — verify scheduling vs occupancy forecast.", priority: "medium" });
    }
    return { findings, recommendations: recs };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a Director of Guest Experience writing a service recovery brief.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "2 sentences",
  "rootCauses": [{ "category": string, "severity": "high"|"medium"|"low", "owner": string, "cite": string }],
  "actions": [{ "step": string, "owner": string, "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      summary: deterministic.findings[0] || "Guest experience nominal.",
      rootCauses: (briefing.topCategories || []).slice(0, 3).map(c => ({
        category: c.category,
        severity: c.avgSentiment < -0.3 ? "high" : c.avgSentiment < 0 ? "medium" : "low",
        owner: "department",
        cite: `topCategories.${c.category}`,
      })),
      actions: deterministic.recommendations.map(r => ({ step: r.action, owner: "ops", priority: r.priority })),
      evidence: [{ cite: "snap.trend.direction", fact: briefing.trend?.direction || "unknown" }],
    };
  },
};
