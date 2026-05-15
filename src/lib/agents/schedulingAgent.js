/* HotelOps · Scheduling Agent
 * =================================================================
 * Reads occupancy forecast + current schedule + employee roster.
 * Recommends staffing adjustments by department; defers to
 * scheduleEngine deterministic logic for the math.
 */

import { factsBlock } from "./agentRuntime.js";
import { buildPace } from "../paceReport.js";
import { buildScheduleFromForecast, validateSchedule, scoreScheduleEfficiency, simulateLaborCost, tierForAdr } from "../workforce/scheduleEngine.js";
import { normalizeEmployee } from "../workforce/employeeProfile.js";

export const SCHEDULING_AGENT = {
  id: "scheduling",
  label: "Scheduling Agent",
  description: "Reviews next 14-day schedule vs forecast occupancy. Surfaces gaps and OT risk.",
  permissionAction: "report.view",
  maxTokens: 1200,

  buildBriefing({ state, propertyId, asOf, enrichReport }) {
    const enrich = enrichReport || ((r) => r);
    const reports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
    const pace = buildPace({ reports, asOf, options: { horizon: 14 } });
    const property = (state.properties || []).find(p => p.id === propertyId);
    const capacity = property?.rooms || 100;
    const employees = (state.employees || []).map(normalizeEmployee);
    const occDays = pace.status === "ok"
      ? pace.forward.map(f => ({ date: f.date, occupancy: f.projectedOccupancy, capacity }))
      : [];
    const tier = pace.status === "ok" ? pace.market.tier : "midscale";
    const draft = occDays.length
      ? buildScheduleFromForecast({ days: occDays, employees, opts: { tier } })
      : { entries: [], notes: ["insufficient forecast"] };
    const validation = validateSchedule({
      schedule: state.schedule || [],
      employees,
      weekStart: asOf,
      weekEnd: occDays[occDays.length - 1]?.date || asOf,
    });
    const efficiency = scoreScheduleEfficiency({
      schedule: state.schedule || [],
      occupancyDays: occDays,
      productivityTarget: tier === "luxury" ? 11 : 14,
    });
    const cost = simulateLaborCost({ schedule: state.schedule || [], employees });
    return {
      propertyId, asOf, tier, capacity,
      forecastDays: occDays.length,
      draftScheduleEntries: draft.entries.length,
      draftNotes: draft.notes,
      validationIssues: validation.issues,
      efficiency,
      laborCost: cost.totalCost,
    };
  },

  deterministic(briefing) {
    const recs = [];
    const findings = [];
    if (briefing.draftNotes?.length) {
      for (const note of briefing.draftNotes) findings.push(note);
    }
    const otIssues = briefing.validationIssues?.filter(i => i.code === "ot-projected" || i.code === "double-time-projected") || [];
    if (otIssues.length) {
      findings.push(`${otIssues.length} OT projection(s) in current schedule.`);
      recs.push({ action: "Rebalance shifts to avoid projected overtime.", priority: "medium" });
    }
    if (briefing.efficiency?.status === "ok" && briefing.efficiency.score < 70) {
      findings.push(`Schedule efficiency ${briefing.efficiency.score}/100 — staffing fit weak.`);
      recs.push({ action: "Regenerate schedule from forecast and review gaps.", priority: "high" });
    }
    return { findings, recommendations: recs.slice(0, 5) };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a hotel scheduling specialist reviewing the next 14 days.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "1-2 sentence read",
  "gaps": [{ "label": string, "department": string, "cite": string }],
  "recommendations": [{ "action": string, "owner": "gm"|"agm"|"controller", "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      summary: deterministic.findings[0] || `Schedule efficiency ${briefing.efficiency?.score ?? "—"}/100.`,
      gaps: (briefing.draftNotes || []).map(n => ({ label: n, department: "—", cite: "snap.draftNotes" })),
      recommendations: deterministic.recommendations.map(r => ({ action: r.action, owner: "gm", priority: r.priority })),
      evidence: [{ cite: "snap.efficiency.score", fact: String(briefing.efficiency?.score) }],
    };
  },
};
