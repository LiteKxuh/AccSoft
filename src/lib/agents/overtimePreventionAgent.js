/* HotelOps · Overtime Prevention Agent
 * =================================================================
 * Forward-looking: who is on track to trip OT this week, and what
 * shifts to move. Uses workforce overtime predictor + roster.
 */

import { factsBlock } from "./agentRuntime.js";
import { overtimePredictor } from "../laborOptimization.js";

export const OVERTIME_PREVENTION_AGENT = {
  id: "overtime-prevention",
  label: "Overtime Prevention Agent",
  description: "Identifies employees on track to trip OT this week and recommends shift swaps.",
  permissionAction: "report.view",
  maxTokens: 1000,

  buildBriefing({ state, asOf, propertyId }) {
    const monday = new Date(asOf || new Date());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    const shifts = (state.shifts || []).filter(s => !propertyId || !s.propertyId || s.propertyId === propertyId);
    const predictions = overtimePredictor({
      shifts,
      employees: state.employees || [],
      weekStart: monday.toISOString().slice(0, 10),
      weekEnd: sunday.toISOString().slice(0, 10),
    });
    return {
      propertyId, asOf,
      atRisk: predictions.filter(p => p.overTimeRisk === "yes"),
      borderline: predictions.filter(p => p.overTimeRisk === "borderline"),
      safe: predictions.filter(p => p.overTimeRisk === "no").length,
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (briefing.atRisk.length) {
      findings.push(`${briefing.atRisk.length} employee(s) projected to hit OT this week.`);
      for (const p of briefing.atRisk.slice(0, 5)) {
        recs.push({ action: `Move shifts for ${p.employeeName} (currently ${p.hoursToDate}h, projecting ${p.projectedHours}h).`, priority: "medium" });
      }
    }
    if (briefing.borderline.length) {
      findings.push(`${briefing.borderline.length} employee(s) within 4h of OT threshold.`);
    }
    return { findings, recommendations: recs.slice(0, 5) };
  },

  promptBuilder(briefing, deterministic) {
    return `You are an OT-prevention specialist for a hotel.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "1-2 sentences",
  "atRiskCount": number,
  "swapPlan": [{ "employee": string, "currentHours": number, "suggestion": string }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      summary: deterministic.findings[0] || "No OT risk this week.",
      atRiskCount: briefing.atRisk.length,
      swapPlan: briefing.atRisk.slice(0, 5).map(p => ({
        employee: p.employeeName,
        currentHours: p.hoursToDate,
        suggestion: `Project ${p.projectedHours.toFixed(1)}h — move ${p.otHoursProjected.toFixed(1)}h to another employee.`,
      })),
      evidence: [{ cite: "snap.atRisk[].employeeName", fact: `${briefing.atRisk.length} at risk` }],
    };
  },
};
