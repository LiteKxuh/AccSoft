/* HotelOps · Forecast Analyst Agent
 * =================================================================
 * Reads forecast accuracy history + pace + segment mix and explains
 * what's driving accuracy drift. Recommends specific tuning actions.
 */

import { factsBlock } from "./agentRuntime.js";
import { gradeForecastHistory } from "../adaptiveLearningLayer.js";
import { buildPace } from "../paceReport.js";

export const FORECAST_ANALYST_AGENT = {
  id: "forecast-analyst",
  label: "Forecast Analyst Agent",
  description: "Grades the forecast, explains bias, recommends what to tune.",
  permissionAction: "report.view",
  maxTokens: 1300,

  buildBriefing({ state, propertyId, asOf, enrichReport = null }) {
    const enrich = enrichReport || (r => r);
    const reports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
    const grading = gradeForecastHistory({
      forecasts: state.forecasts || [], reports, propertyId,
    });
    let pace = null;
    try { pace = buildPace({ reports, asOf, options: { horizon: 14 } }); } catch { /* swallow */ }
    return {
      propertyId, asOf,
      forecastGrade: grading.status === "ok" ? {
        verdict: grading.summary.verdict,
        mape: grading.summary.mape,
        bias: grading.summary.bias,
        forecastCount: grading.summary.totalForecasts,
        pointCount: grading.summary.totalGradedPoints,
        byHorizon: grading.byHorizon.slice(0, 14),
      } : null,
      pace: pace?.status === "ok" ? {
        market: pace.market,
        projection7: pace.projection.d7,
        projection14: pace.projection.d14,
        pickupRooms: pace.pickup?.rooms || 0,
        washFactor: pace.washFactor,
      } : null,
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    const g = briefing.forecastGrade;
    if (!g) {
      findings.push("Not enough forecast history yet — grade more periods.");
    } else {
      findings.push(`Forecast verdict: ${g.verdict} (MAPE ${(g.mape * 100).toFixed(1)}%).`);
      if (Math.abs(g.bias) > 0.05) {
        findings.push(`Systematic ${g.bias > 0 ? "over" : "under"}-prediction by ${(Math.abs(g.bias) * 100).toFixed(1)}%.`);
        recs.push({ action: g.bias > 0 ? "Tighten wash factor / cancellation assumptions." : "Loosen wash / increase booking pace weights.", priority: "high" });
      }
      const longHorizon = (g.byHorizon || []).filter(h => h.horizonDays >= 7);
      if (longHorizon.length && longHorizon.every(h => h.mape > 0.15)) {
        findings.push("Long-horizon accuracy degrades — re-baseline group block detection.");
        recs.push({ action: "Inspect group blocks > 7 days out for stale assumptions.", priority: "medium" });
      }
    }
    return { findings, recommendations: recs };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a forecast analyst diagnosing model accuracy.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "1-2 sentences",
  "bias": { "direction": "over"|"under"|"none", "magnitudePct": number, "cite": string },
  "horizons": [{ "horizonDays": number, "verdict": string, "cite": string }],
  "tuningActions": [{ "step": string, "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    const g = briefing.forecastGrade;
    return {
      summary: deterministic.findings[0] || "Forecast review pending.",
      bias: g ? { direction: g.bias > 0.02 ? "over" : g.bias < -0.02 ? "under" : "none", magnitudePct: Math.abs(g.bias) * 100, cite: "forecastGrade.bias" } : null,
      horizons: (g?.byHorizon || []).map(h => ({
        horizonDays: h.horizonDays,
        verdict: h.mape < 0.05 ? "excellent" : h.mape < 0.10 ? "good" : h.mape < 0.20 ? "fair" : "poor",
        cite: `forecastGrade.byHorizon[${h.horizonDays}]`,
      })),
      tuningActions: deterministic.recommendations.map(r => ({ step: r.action, priority: r.priority })),
      evidence: [{ cite: "forecastGrade.verdict", fact: g?.verdict || "—" }],
    };
  },
};
