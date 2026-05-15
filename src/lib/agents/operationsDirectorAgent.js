/* HotelOps · Operations Director Agent
 * =================================================================
 * Cross-departmental coordinator. Reads the kernel's coordination
 * signals + twin's cascade risks + autonomous-rule events and routes
 * the right action to the right department head with the right urgency.
 *
 * The Ops Director is unique because it does NOT just report status;
 * it produces a coordinated action plan with department owners and
 * sequence ordering (HK → FD → night-audit, etc.).
 */

import { factsBlock } from "./agentRuntime.js";
import { buildOperationalGraph } from "../hotelOperatingKernel.js";
import { buildOperationalTwin } from "../operationalDigitalTwin.js";
import { evaluateAutonomous } from "../autonomousRules.js";

const DEPT_OWNERS = {
  housekeeping: "DOH",
  "front-desk": "FOM",
  food_beverage: "DOFB",
  fb: "DOFB",
  maintenance: "DOE",
  audit: "Night Auditor / Controller",
  revenue: "Revenue Manager",
  controller: "Controller",
  payroll: "Controller",
  ap: "AP Clerk",
  capex: "Controller / Owner",
  labor: "GM",
  staffing: "GM",
  guest: "GM",
  profitability: "GM / Controller",
};

export const OPERATIONS_DIRECTOR_AGENT = {
  id: "operations-director",
  label: "Operations Director Agent",
  description: "Cross-departmental orchestrator: routes today's pressure to the right dept head with sequenced actions.",
  permissionAction: "report.view",
  maxTokens: 1500,

  buildBriefing({ state, propertyId, asOf, enrichReport = null, productivityPerShift = null }) {
    const graph = buildOperationalGraph(state, { propertyId, asOf, enrichReport });
    if (graph.status !== "ok") return { propertyId, asOf, status: graph.status };
    const twin = buildOperationalTwin(state, { propertyId, asOf, enrichReport, productivityPerShift });
    const autonomousEvents = evaluateAutonomous(graph, twin.status === "ok" ? twin : null);
    return {
      propertyId, asOf, status: "ok",
      indices: graph.indices,
      pressurePoints: graph.pressurePoints,
      coordination: graph.coordination,
      twin: twin.status === "ok" ? {
        inventory: twin.inventory,
        arrivalsDepartures: twin.arrivalsDepartures,
        housekeeping: twin.housekeeping,
        labor: twin.labor,
        maintenance: twin.maintenance,
        bottlenecks: (twin.bottlenecks?.bottlenecks || []).slice(0, 5),
        cascadeRisks: twin.cascadeRisks,
      } : null,
      autonomousEvents: autonomousEvents.map(e => ({ ruleId: e.ruleId, severity: e.severity, label: e.label, payload: e.payload })),
    };
  },

  deterministic(briefing) {
    if (briefing.status !== "ok") return { findings: ["No operational data available."], recommendations: [], orchestration: [] };
    const orchestration = [];
    // Highest-priority autonomous events first
    const highEvents = briefing.autonomousEvents?.filter(e => e.severity === "high") || [];
    for (const e of highEvents) {
      orchestration.push({
        sequence: orchestration.length + 1,
        owner: DEPT_OWNERS[e.payload?.suggestedRecipient] || DEPT_OWNERS[e.payload?.category] || "GM",
        action: e.label,
        priority: "high",
        cite: e.ruleId,
      });
    }
    // Then medium events
    const medEvents = briefing.autonomousEvents?.filter(e => e.severity === "medium") || [];
    for (const e of medEvents.slice(0, 5)) {
      orchestration.push({
        sequence: orchestration.length + 1,
        owner: DEPT_OWNERS[e.payload?.suggestedRecipient] || DEPT_OWNERS[e.payload?.category] || "GM",
        action: e.label,
        priority: "medium",
        cite: e.ruleId,
      });
    }
    // Cascade risk callouts
    const cascadeFindings = [];
    for (const c of (briefing.twin?.cascadeRisks || [])) {
      const downstream = c.impact?.map(i => i.downstream).join(" → ");
      if (downstream) cascadeFindings.push(`${c.source} failure cascades to: ${downstream}`);
    }
    const findings = [];
    if (briefing.indices?.hotelHealthIndex < 60) findings.push(`Hotel health index ${briefing.indices.hotelHealthIndex}/100 — operational pressure elevated.`);
    findings.push(...cascadeFindings);
    findings.push(...briefing.pressurePoints?.slice(0, 3).map(p => p.label) || []);

    return { findings, recommendations: orchestration.map(o => ({ action: o.action, priority: o.priority })), orchestration };
  },

  promptBuilder(briefing, deterministic) {
    return `You are the Director of Operations. Coordinate department heads against today's operational reality.

${factsBlock({ snap: briefing, deterministic })}

Return JSON:
{
  "summary": "2-3 sentences of operational state",
  "orchestration": [{ "sequence": number, "owner": string, "action": string, "priority": "high"|"medium"|"low", "cite": string }],
  "cascadeWarnings": [{ "source": string, "downstream": string, "cite": string }],
  "evidence": [{ "cite": string, "fact": string }]
}`;
  },

  localFallback(briefing, deterministic) {
    return {
      summary: deterministic.findings[0] || `Health index ${briefing.indices?.hotelHealthIndex || "—"}/100. Routing today's pressure.`,
      orchestration: deterministic.orchestration,
      cascadeWarnings: (briefing.twin?.cascadeRisks || []).map(c => ({
        source: c.source,
        downstream: c.impact?.map(i => i.downstream).join(" → ") || "",
        cite: `twin.cascadeRisks.${c.source}`,
      })),
      evidence: [{ cite: "snap.indices.hotelHealthIndex", fact: String(briefing.indices?.hotelHealthIndex || "—") }],
    };
  },
};
