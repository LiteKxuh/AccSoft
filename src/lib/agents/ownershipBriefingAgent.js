/* HotelOps · Ownership Briefing Agent
 * =================================================================
 * Composes an owner-facing briefing. Strips operational minutiae,
 * highlights NOI/EBITDA pressure, capital flags, distribution math.
 * Reads from kernel + owner statement + capex modules.
 */

import { factsBlock } from "./agentRuntime.js";
import { buildOperationalGraph } from "../hotelOperatingKernel.js";

export const OWNERSHIP_BRIEFING_AGENT = {
  id: "ownership-briefing",
  label: "Ownership Briefing Agent",
  description: "Owner-facing summary: distribution math, profitability pressure, capital flags.",
  permissionAction: "report.view",
  maxTokens: 1400,

  buildBriefing({ state, propertyId, asOf, enrichReport = null }) {
    const graph = buildOperationalGraph(state, { propertyId, asOf, enrichReport });
    if (graph.status !== "ok") {
      return { propertyId, asOf, status: graph.status };
    }
    const snap = graph.snap;
    const ownership = (state.ownerships || []).filter(o => o.propertyId === propertyId);
    return {
      propertyId, asOf, tier: graph.tier,
      indices: graph.indices,
      mtdRevenue: snap.mtd?.revenue || 0,
      mtdOccupancy: snap.mtd?.occupancy || 0,
      mtdAdr: snap.mtd?.adr || 0,
      mtdRevpar: snap.mtd?.revpar || 0,
      laborPctRev: snap.labor?.mtdPctRev || 0,
      capexOverBudget: snap.capex?.statusCounts?.overBudget || 0,
      capexTotalBudget: snap.capex?.totals?.budget || 0,
      capexTotalSpent: snap.capex?.totals?.spent || 0,
      cashCovered: snap.ledger?.cashCovered || 0,
      apOver120: snap.ledger?.apOver120 || 0,
      pressurePoints: (graph.pressurePoints || []).slice(0, 8),
      profitabilityPressureScore: graph.indices.profitabilityPressureScore,
      ownershipCount: ownership.length,
    };
  },

  deterministic(briefing) {
    if (briefing.status && briefing.status !== "ok" && briefing.tier === undefined) {
      return { findings: ["No data available for this period."], recommendations: [] };
    }
    const findings = [];
    const recs = [];
    if (briefing.profitabilityPressureScore > 50) {
      findings.push(`Profitability pressure score ${briefing.profitabilityPressureScore}/100 — margins under stress.`);
      recs.push({ action: "Review variable cost trends + GOP margin trajectory with GM.", priority: "high" });
    }
    if (briefing.capexOverBudget > 0) {
      findings.push(`${briefing.capexOverBudget} capex project(s) over budget.`);
      recs.push({ action: "Owner sign-off required on overrun before further commitment.", priority: "high" });
    }
    if (briefing.apOver120 > 0) {
      findings.push(`$${briefing.apOver120.toFixed(0)} A/P aged over 120 days — vendor relationship exposure.`);
    }
    if (briefing.laborPctRev > 0.40) {
      findings.push(`Labor at ${(briefing.laborPctRev * 100).toFixed(1)}% of revenue.`);
    }
    return { findings, recommendations: recs };
  },

  promptBuilder(briefing, deterministic) {
    return `You are writing a property owner's monthly briefing. Plain English, no jargon.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "headline": "1 sentence: the month's story",
  "performance": [
    { "metric": "Revenue MTD" | "Occupancy" | "ADR" | "RevPAR" | "Labor %", "value": string, "comment": string, "cite": string }
  ],
  "capitalNotes": [string],
  "actionsForOwner": [string],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      headline: deterministic.findings[0] || `${briefing.tier || "—"} property — health index ${briefing.indices?.hotelHealthIndex || "—"}.`,
      performance: briefing.tier ? [
        { metric: "Revenue MTD", value: `$${briefing.mtdRevenue.toFixed(0)}`, comment: "", cite: "snap.mtdRevenue" },
        { metric: "Occupancy", value: `${(briefing.mtdOccupancy * 100).toFixed(1)}%`, comment: "", cite: "snap.mtdOccupancy" },
        { metric: "ADR", value: `$${briefing.mtdAdr.toFixed(2)}`, comment: "", cite: "snap.mtdAdr" },
        { metric: "Labor %", value: `${(briefing.laborPctRev * 100).toFixed(1)}%`, comment: briefing.laborPctRev > 0.40 ? "Above industry benchmark" : "", cite: "snap.laborPctRev" },
      ] : [],
      capitalNotes: briefing.capexOverBudget > 0 ? [`${briefing.capexOverBudget} capex project(s) over budget`] : [],
      actionsForOwner: deterministic.recommendations.map(r => r.action),
      evidence: [{ cite: "snap.indices", fact: JSON.stringify(briefing.indices || {}) }],
    };
  },
};
