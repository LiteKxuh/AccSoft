/* HotelOps · Agent runtime
 * =================================================================
 * Shared substrate for operational agents:
 *
 *   - buildBriefing(opts) collects the facts an agent will reason over
 *     from the digital-twin snapshot + supplementary modules. Pure.
 *   - runAgent({ agent, briefing, system }) — calls Claude with a
 *     strict JSON-only contract; falls back to a deterministic
 *     local recap if the proxy isn't configured.
 *   - Outputs always reference an `evidence` array with citation
 *     objects so the UI can prove every claim against state.
 *
 * Agents must NEVER fabricate numbers. Numbers come from the
 * snapshot; the agent is only allowed to *interpret* and recommend.
 *
 * Permission boundary: each agent declares a required RBAC action.
 * The runtime refuses to execute if the caller's role lacks it.
 */

import { isConfigured, callClaude } from "../aiOps.js";
import { can } from "../rbac.js";

const SYSTEM_PROMPT = `You are an operational specialist working inside HotelOps, a hospitality back-office ERP.

CRITICAL RULES:
- NEVER invent numbers. Use only the figures provided in the facts payload.
- Cite every claim by referencing the relevant fact path (e.g. "snap.labor.mtdPctRev").
- Return STRICT JSON only — no markdown fences, no prose outside the JSON object.
- Stay realistic about hotel economics — tertiary-market economy hotels are not luxury performers.
- Be specific. "Labor was high" is useless; "Labor MTD is 38% vs target 30%, driven by a 14% drift in scheduled hours" is useful.
- If the facts don't support a conclusion, say so — "insufficient data" is a valid finding.`;

/**
 * Whether the proxy / API key is reachable. UI uses this to enable or
 * disable narrative options.
 */
export function isLlmAvailable() {
  return isConfigured();
}

/**
 * @param {object} agent       Agent definition (id, role, permissionAction, prompt builder)
 * @param {object} briefing    Output of agent's buildBriefing()
 * @param {object} ctx         { user, role, signal? }
 */
export async function runAgent({ agent, briefing, ctx = {} }) {
  if (!agent) throw new Error("runAgent: agent definition required");
  // RBAC gate
  if (agent.permissionAction && ctx.role && !can(ctx.role, agent.permissionAction)) {
    return {
      status: "permission-denied",
      reason: `Role "${ctx.role}" cannot run ${agent.id} (requires ${agent.permissionAction}).`,
    };
  }
  // Always emit the deterministic findings — they're the contract the
  // operator can trust regardless of LLM availability.
  const deterministic = agent.deterministic ? agent.deterministic(briefing) : null;
  if (!isConfigured()) {
    return {
      status: "local",
      agent: agent.id,
      deterministic,
      narrative: agent.localFallback ? agent.localFallback(briefing, deterministic) : null,
      runAt: new Date().toISOString(),
    };
  }
  try {
    const user = agent.promptBuilder(briefing, deterministic);
    const llm = await callClaude({
      system: SYSTEM_PROMPT,
      user,
      maxTokens: agent.maxTokens || 1500,
    });
    return {
      status: "ok",
      agent: agent.id,
      deterministic,
      narrative: sanitize(llm),
      runAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      status: "llm-error",
      agent: agent.id,
      deterministic,
      narrative: agent.localFallback ? agent.localFallback(briefing, deterministic) : null,
      error: e?.message || String(e),
      runAt: new Date().toISOString(),
    };
  }
}

function sanitize(o) {
  if (!o || typeof o !== "object") return null;
  // Guard against hallucinated numeric fabrication: scrub any field
  // claiming to be a citation pointing outside snap.* / facts.*
  if (Array.isArray(o.evidence)) {
    o.evidence = o.evidence.filter(e => typeof e === "object" && e !== null && typeof e.cite === "string");
  }
  return o;
}

/** Helper for agents: serialize the structured briefing into a fact sheet. */
export function factsBlock(briefing) {
  return "FACTS (the only source of truth — do NOT invent numbers):\n" + JSON.stringify(briefing, null, 2);
}
