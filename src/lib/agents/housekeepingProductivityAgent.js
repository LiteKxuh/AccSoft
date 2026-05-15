/* HotelOps · Housekeeping Productivity Agent
 * =================================================================
 * Calculates rooms-per-attendant vs tier benchmarks; recommends
 * realistic improvements. No "fire everyone" output.
 */

import { factsBlock } from "./agentRuntime.js";
import { roomsPerAttendant } from "../laborOptimization.js";

export const HOUSEKEEPING_AGENT = {
  id: "housekeeping-productivity",
  label: "Housekeeping Productivity Agent",
  description: "Computes MTD rooms-per-attendant vs tier benchmark and recommends targets.",
  permissionAction: "report.view",
  maxTokens: 1000,

  buildBriefing({ state, propertyId, asOf, enrichReport }) {
    const enrich = enrichReport || ((r) => r);
    const monthStart = `${asOf.slice(0, 7)}-01`;
    const reports = (state.reports || []).filter(r => r.propertyId === propertyId && r.date >= monthStart && r.date <= asOf).map(enrich);
    const roomsSold = reports.reduce((s, r) => s + (Number(r.roomsSold) || 0), 0);
    // Identify housekeeping shifts
    const empByDept = new Map((state.employees || []).map(e => [e.id, (e.homeDepartment || "").toLowerCase()]));
    const shifts = (state.shifts || []).filter(s => {
      const dept = (s.departmentId || empByDept.get(s.employeeId) || "").toLowerCase();
      return dept.includes("housekeep") || s.jobCodeId === "room_attendant";
    }).filter(s => s.clockIn >= monthStart + "T00:00:00Z" && s.clockIn <= asOf + "T23:59:59Z");
    const hours = shifts.reduce((s, sh) => {
      const start = new Date(sh.clockIn), end = sh.clockOut ? new Date(sh.clockOut) : null;
      if (!end) return s;
      return s + Math.max(0, (end - start) / 3600_000 - (Number(sh.breakMinutes) || 0) / 60);
    }, 0);
    // Classify tier from ADR median
    const adrs = reports.map(r => Number(r.adr) || 0).filter(v => v > 0).sort((a, b) => a - b);
    const medAdr = adrs.length ? adrs[Math.floor(adrs.length / 2)] : 0;
    const tier = medAdr >= 250 ? "luxury"
      : medAdr >= 170 ? "upper-upscale"
      : medAdr >= 110 ? "upscale"
      : medAdr >= 70  ? "midscale" : "economy";
    const productivity = hours > 0 ? roomsPerAttendant({ housekeepingHours: hours, roomsCleaned: roomsSold, tier }) : { status: "no-data" };
    return {
      propertyId, asOf, tier, roomsSold, hkHours: hours, productivity,
    };
  },

  deterministic(briefing) {
    const findings = [];
    const recs = [];
    if (briefing.productivity?.status !== "ok") {
      findings.push("Insufficient housekeeping shift data MTD.");
      return { findings, recommendations: [] };
    }
    findings.push(briefing.productivity.headline);
    if (briefing.productivity.verdict === "below-target") {
      recs.push({ action: "Coach attendants on the 30-minute room standard; review supplies cart workflow.", priority: "medium" });
    } else if (briefing.productivity.verdict === "above-target") {
      recs.push({ action: "Verify rooms-cleaned count is accurate — productivity 20%+ above tier target deserves a spot check.", priority: "low" });
    }
    return { findings, recommendations: recs };
  },

  promptBuilder(briefing, deterministic) {
    return `You are a housekeeping productivity analyst.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "verdict": "below-target"|"near-target"|"above-target",
  "summary": "1-2 sentence read",
  "recommendations": [{ "action": string, "owner": "gm"|"agm", "priority": "high"|"medium"|"low" }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      verdict: briefing.productivity?.verdict || "no-data",
      summary: deterministic.findings[0] || "—",
      recommendations: deterministic.recommendations.map(r => ({ action: r.action, owner: "gm", priority: r.priority })),
      evidence: [{ cite: "snap.productivity.headline", fact: briefing.productivity?.headline || "—" }],
    };
  },
};
