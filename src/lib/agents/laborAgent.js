/* HotelOps · Labor Analyst Agent
 * =================================================================
 * Reads labor cost, schedule drift, productivity. Recommends actions
 * within the realistic bounds of hospitality labor (no "cut 30% of
 * staff" recommendations).
 */

import { factsBlock } from "./agentRuntime.js";
import { laborKPIs, scheduleVsActual } from "../labor.js";

export const LABOR_AGENT = {
  id: "labor-analyst",
  label: "Labor Analyst Agent",
  description: "Diagnoses labor variance: pct of revenue, schedule drift, productivity. Recommends realistic actions.",
  permissionAction: "report.view",
  maxTokens: 1200,

  buildBriefing({ state, propertyId, asOf, enrichReport }) {
    const enrich = enrichReport || ((r) => r);
    const propReports = (state.reports || []).filter(r => r.propertyId === propertyId).map(enrich);
    const monthStart = `${asOf.slice(0, 7)}-01`;
    const shifts = (state.shifts || []).filter(s => !s.propertyId || s.propertyId === propertyId);
    const schedule = (state.schedule || []).filter(s => !s.propertyId || s.propertyId === propertyId);
    const employees = state.employees || [];
    const payrollRuns = (state.payrollRuns || []).filter(r => !r.propertyId || r.propertyId === propertyId);
    const mtdKpi = laborKPIs({ shifts, schedule, payrollRuns, employees, reports: propReports, start: monthStart, end: asOf });
    const drift = scheduleVsActual({ shifts, schedule, employees, start: monthStart, end: asOf });
    const mtdRev = propReports.filter(r => r.date >= monthStart && r.date <= asOf).reduce((s, r) => s + (Number(r.totalRevenue) || 0), 0);
    return {
      propertyId, asOf,
      mtdLaborCost: mtdKpi?.laborCost || 0,
      mtdRevenue: mtdRev,
      mtdPctRev: mtdRev > 0 ? (mtdKpi?.laborCost || 0) / mtdRev : 0,
      scheduledHours: (drift?.rows || []).reduce((s, r) => s + (r.scheduled || 0), 0),
      actualHours: (drift?.rows || []).reduce((s, r) => s + (r.actual || 0), 0),
      driftRows: (drift?.rows || []).slice(0, 10),
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (briefing.mtdRevenue === 0) {
      return { findings: ["No revenue posted MTD — labor analysis withheld."], recommendations: [] };
    }
    const pct = briefing.mtdPctRev;
    if (pct > 0.40) {
      findings.push(`Labor at ${(pct * 100).toFixed(1)}% of revenue (target 30%).`);
      recs.push({ action: "Audit overtime: identify employees with consecutive long shifts and rebalance.", priority: "high" });
    } else if (pct > 0.35) {
      findings.push(`Labor at ${(pct * 100).toFixed(1)}% of revenue — slightly over target.`);
      recs.push({ action: "Review schedule efficiency in next planning cycle.", priority: "medium" });
    }
    const drift = briefing.scheduledHours > 0 ? (briefing.actualHours - briefing.scheduledHours) / briefing.scheduledHours : 0;
    if (Math.abs(drift) > 0.12) {
      findings.push(`Schedule drift ${(drift * 100).toFixed(1)}% (actual ${briefing.actualHours.toFixed(0)}h vs scheduled ${briefing.scheduledHours.toFixed(0)}h).`);
      recs.push({ action: drift > 0 ? "Investigate stay-overs / extra shifts driving clock-in growth." : "Investigate call-outs / under-coverage.", priority: "medium" });
    }
    return { findings, recommendations: recs.slice(0, 5) };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a labor analyst diagnosing variance for a hotel.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "1-2 sentence read of the labor picture",
  "rootCauses": [{ "cause": string, "evidence": string, "cite": "snap.path" }],
  "recommendations": [{ "action": string, "owner": "agm"|"gm"|"controller", "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}

Be hospitality-realistic: no "cut 30% of staff." Operational levers are: schedule rebalancing, OT control, productivity coaching, banquet pre-shift staffing.`;
  },

  localFallback(briefing, deterministic) {
    return {
      summary: deterministic.findings[0] || "Labor on track.",
      rootCauses: deterministic.findings.map(f => ({ cause: f, evidence: "Deterministic finding", cite: "snap.mtdPctRev" })),
      recommendations: deterministic.recommendations.map(r => ({ action: r.action, owner: "gm", priority: r.priority })),
      evidence: [{ cite: "snap.mtdPctRev", fact: `${(briefing.mtdPctRev * 100).toFixed(1)}%` }],
    };
  },
};
