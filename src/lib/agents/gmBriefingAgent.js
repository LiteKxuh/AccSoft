/* HotelOps · GM Briefing Agent
 * =================================================================
 * Composes a morning operational brief for a General Manager from the
 * digital-twin snapshot + overnight delta + automation queue.
 * Designed to read like a 90-second standup.
 */

import { factsBlock } from "./agentRuntime.js";
import { snapshot, overnightDelta } from "../hotelState.js";
import { evaluate } from "../workflowEngine.js";

export const GM_BRIEFING_AGENT = {
  id: "gm-briefing",
  label: "GM Briefing Agent",
  description: "Morning standup brief: overnight delta, risk flags, next-action queue.",
  permissionAction: "report.view",
  maxTokens: 1200,

  buildBriefing({ state, propertyId, asOf, enrichReport }) {
    const snap = snapshot(state, { propertyId, asOf, enrichReport });
    const overnight = overnightDelta(state, { propertyId, asOf, enrichReport });
    const events = snap.status === "ok" ? evaluate(snap) : [];
    return {
      propertyId, asOf,
      snap: snap.status === "ok" ? {
        tier: snap.tier,
        today: snap.today,
        mtd: snap.mtd,
        labor: snap.labor,
        audit: snap.audit,
        approvals: snap.approvals,
        riskFlags: snap.riskFlags,
        compression: snap.compression,
      } : null,
      overnight: overnight.status === "ok" ? overnight.delta : null,
      automationEvents: events.map(e => ({ id: e.ruleId, severity: e.severity, label: e.label })),
    };
  },

  deterministic(briefing) {
    if (!briefing.snap) return { headline: "No data for today.", priorities: [] };
    const priorities = [];
    if (briefing.snap.audit?.status === "fail") priorities.push("Night audit failed — block rollover.");
    if (briefing.snap.riskFlags?.some(r => r.severity === "high")) priorities.push("High-severity operational flag — see digital twin.");
    if (briefing.snap.approvals?.pendingDollar > 25_000) priorities.push(`$${briefing.snap.approvals.pendingDollar.toFixed(0)} of approvals waiting.`);
    if (briefing.snap.compression) priorities.push("Forward 7-day compression — check rate controls.");
    if (briefing.snap.labor?.mtdPctRev > 0.35) priorities.push(`Labor ${(briefing.snap.labor.mtdPctRev * 100).toFixed(1)}% of revenue.`);
    return { headline: `${briefing.snap.tier} tier · MTD revenue $${briefing.snap.mtd.revenue.toFixed(0)} · audit ${briefing.snap.audit?.status || "—"}`, priorities };
  },

  promptBuilder(briefing, deterministic) {
    return `You are writing a 90-second morning standup for a General Manager.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "headline": "1-sentence overnight pulse",
  "bullets": [
    { "topic": string, "value": string, "callout": string, "cite": string }
  ],
  "topPriorities": [string],
  "askLater": [string],
  "evidence": [{ "cite": string, "fact": string }]
}

Bullets should be specific with numbers. Cite which fact each bullet pulls from.`;
  },

  localFallback(briefing, deterministic) {
    return {
      headline: deterministic.headline,
      bullets: briefing.snap ? [
        { topic: "Revenue today", value: `$${(briefing.snap.today?.revenue || 0).toFixed(0)}`, callout: "", cite: "snap.today.revenue" },
        { topic: "Occupancy MTD", value: `${((briefing.snap.mtd.occupancy || 0) * 100).toFixed(1)}%`, callout: "", cite: "snap.mtd.occupancy" },
        { topic: "Labor % of rev", value: `${((briefing.snap.labor?.mtdPctRev || 0) * 100).toFixed(1)}%`, callout: briefing.snap.labor?.mtdPctRev > 0.35 ? "Above target" : "", cite: "snap.labor.mtdPctRev" },
        { topic: "Audit score", value: `${briefing.snap.audit?.score || "—"}/100`, callout: briefing.snap.audit?.status === "fail" ? "Hard fail" : "", cite: "snap.audit.score" },
      ] : [],
      topPriorities: deterministic.priorities,
      askLater: briefing.automationEvents.map(e => e.label).slice(0, 4),
      evidence: [],
    };
  },
};
