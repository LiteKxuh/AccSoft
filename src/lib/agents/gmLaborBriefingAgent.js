/* HotelOps · GM Labor Briefing Agent
 * =================================================================
 * Morning briefing focused on labor: yesterday's labor %, today's
 * coverage gaps, upcoming OT risk, productivity verdict.
 */

import { factsBlock } from "./agentRuntime.js";
import { snapshot } from "../hotelState.js";
import { overtimePredictor } from "../laborOptimization.js";

export const GM_LABOR_BRIEFING_AGENT = {
  id: "gm-labor-briefing",
  label: "GM Labor Briefing Agent",
  description: "5-minute labor pulse for the GM: yesterday, today, week ahead.",
  permissionAction: "report.view",
  maxTokens: 1000,

  buildBriefing({ state, propertyId, asOf, enrichReport }) {
    const snap = snapshot(state, { propertyId, asOf, enrichReport });
    const monday = new Date(asOf);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    const ot = overtimePredictor({
      shifts: (state.shifts || []).filter(s => !s.propertyId || s.propertyId === propertyId),
      employees: state.employees || [],
      weekStart: monday.toISOString().slice(0, 10),
      weekEnd: sunday.toISOString().slice(0, 10),
    });
    return {
      propertyId, asOf,
      snap: snap.status === "ok" ? {
        mtdLaborPct: snap.labor.mtdPctRev,
        mtdLaborCost: snap.labor.mtdCost,
        scheduledHours: snap.labor.scheduledHours,
        actualHours: snap.labor.actualHours,
        driftPct: snap.labor.driftPct,
        compression: snap.compression,
      } : null,
      otAtRisk: ot.filter(p => p.overTimeRisk === "yes").length,
      otBorderline: ot.filter(p => p.overTimeRisk === "borderline").length,
    };
  },

  deterministic(briefing) {
    if (!briefing.snap) return { priorities: ["No data."] };
    const priorities = [];
    if (briefing.snap.mtdLaborPct > 0.35) priorities.push(`Labor MTD ${(briefing.snap.mtdLaborPct * 100).toFixed(1)}% — investigate top drivers.`);
    if (Math.abs(briefing.snap.driftPct) > 0.12) priorities.push(`Schedule drift ${(briefing.snap.driftPct * 100).toFixed(1)}%.`);
    if (briefing.otAtRisk > 0) priorities.push(`${briefing.otAtRisk} employee(s) at OT risk this week.`);
    if (briefing.snap.compression) priorities.push("Compression on the forward 7 days — review staffing.");
    return { priorities };
  },

  promptBuilder(briefing, deterministic) {
    return `You are writing a 5-minute labor briefing for a GM.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "headline": "1 sentence",
  "topPriorities": [string],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      headline: briefing.snap
        ? `Labor MTD ${(briefing.snap.mtdLaborPct * 100).toFixed(1)}% · drift ${(briefing.snap.driftPct * 100).toFixed(1)}%.`
        : "No data.",
      topPriorities: deterministic.priorities,
      evidence: [{ cite: "snap.labor.mtdPctRev", fact: String(briefing.snap?.mtdLaborPct || 0) }],
    };
  },
};
