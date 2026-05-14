/* HotelOps · Revenue Strategy Agent
 * =================================================================
 * Reads pace, pickup, compset (if loaded), and segment mix. Produces
 * concrete revenue strategy moves anchored to the property's market
 * tier — economy hotels do not get told to raise ADR to $300.
 */

import { factsBlock } from "./agentRuntime.js";
import { buildPace } from "../paceReport.js";
import { buildSegmentMix } from "../segmentMix.js";
import { computeCompsetIndices } from "../compset.js";

export const REVENUE_AGENT = {
  id: "revenue-strategy",
  label: "Revenue Strategy Agent",
  description: "Reads pace, pickup, compset, and segment mix; recommends revenue moves with realism-clamped pricing.",
  permissionAction: "forecast.view",
  maxTokens: 1500,

  buildBriefing({ state, propertyId, asOf, enrichReport }) {
    const enrich = enrichReport || ((r) => r);
    const propReports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
    const py = (state.reports || []).filter(r => r.propertyId === propertyId && r.date.startsWith(String(Number(asOf.slice(0, 4)) - 1))).map(enrich);
    const pace = buildPace({ reports: propReports, asOf, priorYear: py, options: { horizon: 14 } });
    const monthStart = `${asOf.slice(0, 7)}-01`;
    const mix = buildSegmentMix({ reports: state.reports || [], propertyId, start: monthStart, end: asOf });
    const compsetIndices = computeCompsetIndices({
      snapshots: state.compsetSnapshots || [],
      reports: state.reports || [],
      propertyId,
      start: monthStart,
      end: asOf,
    });
    return {
      propertyId,
      asOf,
      pace: pace.status === "ok" ? {
        market: pace.market,
        mtd: pace.mtd,
        priorYear: pace.priorYear,
        pickup: pace.pickup,
        washFactor: pace.washFactor,
        projection: pace.projection,
        forward: pace.forward.map(p => ({ date: p.date, occ: p.projectedOccupancy, adr: p.projectedAdr, conf: p.confidence })),
      } : null,
      paceStatus: pace.status,
      segmentMix: mix.mix.slice(0, 6),
      compsetIndices: compsetIndices.status === "ok" ? {
        averages: compsetIndices.averages,
        propTier: compsetIndices.propTier,
        n: compsetIndices.period.n,
      } : null,
      compsetStatus: compsetIndices.status,
    };
  },

  deterministic(briefing) {
    const recs = [];
    const findings = [];
    if (briefing.paceStatus !== "ok") {
      return { recommendations: [{ action: "Insufficient pace history — load 14+ days of reports.", priority: "medium" }], findings: [] };
    }
    // Compression / wash
    const cap = briefing.pace.market.occCap;
    const high = briefing.pace.forward.filter(p => p.occ >= cap * 0.95).length;
    if (high >= 3) {
      findings.push(`Compression detected on ${high} of next 14 days near the ${(cap * 100).toFixed(0)}% ${briefing.pace.market.tier} ceiling.`);
      recs.push({ action: "Review BAR fences / minimum length-of-stay on compressed dates.", priority: "high" });
    }
    if (briefing.pace.washFactor != null && briefing.pace.washFactor > briefing.pace.market.washCap * 0.8) {
      findings.push(`Observed wash factor ${(briefing.pace.washFactor * 100).toFixed(1)}% approaches market cap.`);
      recs.push({ action: "Tighten cancellation policy or pre-stay deposit requirement.", priority: "medium" });
    }
    if (briefing.pace.priorYear && briefing.pace.priorYear.revGrowth != null && briefing.pace.priorYear.revGrowth < -0.05) {
      findings.push(`YoY pace ${(briefing.pace.priorYear.revGrowth * 100).toFixed(1)}% — investigating segments.`);
      recs.push({ action: "Diagnose YoY shortfall: review segment-by-segment ADR and room nights.", priority: "high" });
    }
    if (briefing.compsetIndices?.averages) {
      const ad = briefing.compsetIndices.averages;
      if (ad.adrIndex != null && ad.adrIndex < 95) {
        findings.push(`ADR index ${ad.adrIndex.toFixed(1)} — pricing below comp-set.`);
        recs.push({ action: "Test rate lift on shoulder nights where compset ADR is higher.", priority: "medium" });
      }
      if (ad.occIndex != null && ad.occIndex < 90) {
        findings.push(`OCC index ${ad.occIndex.toFixed(1)} — losing share.`);
        recs.push({ action: "Increase OTA visibility on weak weekday inventory.", priority: "medium" });
      }
    }
    // Segment mix shifts
    const ota = briefing.segmentMix.find(s => s.segment === "ota" || s.segment === "OTA");
    if (ota && ota.share > 0.45) {
      findings.push(`OTA share ${(ota.share * 100).toFixed(1)}% is high — commission drag.`);
      recs.push({ action: "Invest in direct booking incentives to reduce OTA dependence.", priority: "medium" });
    }
    return { recommendations: recs.slice(0, 6), findings };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a revenue manager for a hotel in the ${briefing.pace?.market?.tier || "unknown"} tier. Market reality matters — do NOT recommend luxury pricing for an economy property or vice versa.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "thesis": "1-sentence reading of the demand picture",
  "opportunities": [
    {
      "title": string,
      "rationale": string,
      "estimatedLift": "string with $ or %",
      "confidence": "high"|"medium"|"low",
      "cite": "snap.pace.X or snap.segmentMix[i]",
      "actions": [string]
    }
  ],
  "risks": [{ "label": string, "cite": string }],
  "evidence": [{ "cite": string, "fact": string }]
}

Stay realistic — economy tertiary hotels should not be told to chase luxury ADRs.`;
  },

  localFallback(briefing, deterministic) {
    return {
      thesis: briefing.paceStatus === "ok"
        ? `Market tier ${briefing.pace?.market?.tier}. Forward 14-day projection ${briefing.pace?.projection?.d14 ? `$${briefing.pace.projection.d14.toFixed(0)}` : "—"}.`
        : "Insufficient pace history for a revenue thesis.",
      opportunities: deterministic.recommendations.map(r => ({
        title: r.action,
        rationale: deterministic.findings[0] || "",
        estimatedLift: "—",
        confidence: r.priority === "high" ? "high" : "medium",
        cite: "deterministic.findings",
        actions: [],
      })),
      risks: [],
      evidence: [],
    };
  },
};
