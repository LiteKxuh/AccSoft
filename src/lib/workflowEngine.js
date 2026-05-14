/* HotelOps · Workflow / automation engine
 * =================================================================
 * Trigger-action rules that evaluate a hotelState snapshot and emit
 * a list of automation events (alert | task | escalation | recommendation).
 * Pure function — same input always produces the same output.
 *
 *   evaluate(snapshot, rules)            → [event]
 *   evaluatePortfolio(snapshots, rules)  → [event]   (with propertyId on each)
 *   applyEvents(state, events, user)     → state patch (append events into state.automationEvents)
 *
 * Rule definition:
 *   {
 *     id: "rules.labor.overspend",
 *     enabled: true,
 *     trigger: ({ snap }) => boolean,
 *     produce: ({ snap, user }) => {
 *       label, severity: "info"|"medium"|"high", action, payload, dedupeKey
 *     },
 *   }
 *
 * The engine handles dedupe across runs via dedupeKey so a single
 * sustained condition does not spam the inbox.
 */

import { DEFAULT_RULES } from "./automationRules.js";

export const SEVERITIES = ["info", "low", "medium", "high"];

export function evaluate(snap, rules = DEFAULT_RULES, ctx = {}) {
  if (!snap || snap.status !== "ok") return [];
  const out = [];
  for (const rule of (rules || [])) {
    if (rule.enabled === false) continue;
    let matched = false;
    try { matched = !!rule.trigger({ snap, ctx }); } catch { matched = false; }
    if (!matched) continue;
    let produced;
    try { produced = rule.produce({ snap, ctx }); } catch { continue; }
    if (!produced) continue;
    out.push({
      ruleId: rule.id,
      propertyId: snap.propertyId,
      asOf: snap.asOf,
      severity: produced.severity || "medium",
      label: produced.label,
      action: produced.action || "alert",
      payload: produced.payload || {},
      dedupeKey: produced.dedupeKey || `${rule.id}::${snap.propertyId}::${snap.asOf}`,
      createdAt: new Date().toISOString(),
    });
  }
  return out;
}

export function evaluatePortfolio(snapshots, rules = DEFAULT_RULES, ctx = {}) {
  const all = [];
  for (const s of (snapshots || [])) {
    for (const ev of evaluate(s, rules, ctx)) all.push(ev);
  }
  return all;
}

/** Returns the state patch that appends new events, skipping any duplicate dedupeKey already in state OR within the input batch. */
export function applyEvents(state, events, user) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const seen = new Set((state.automationEvents || []).map(e => e.dedupeKey));
  const fresh = [];
  for (const e of events) {
    if (seen.has(e.dedupeKey)) continue;
    seen.add(e.dedupeKey);
    fresh.push({
      ...e,
      id: `aev_${e.ruleId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      status: "open",
      user: user?.id || null,
    });
  }
  if (!fresh.length) return null;
  return { automationEvents: [...(state.automationEvents || []), ...fresh] };
}

export function resolveEvent(state, eventId, user, resolution = "resolved") {
  return {
    automationEvents: (state.automationEvents || []).map(e =>
      e.id === eventId
        ? { ...e, status: resolution, resolvedAt: new Date().toISOString(), resolvedBy: user?.id || null }
        : e
    ),
  };
}

export function summarizeAutomation(state, { since = null, status = null } = {}) {
  const events = (state.automationEvents || []).filter(e =>
    (!since || e.createdAt >= since) && (!status || e.status === status)
  );
  const bySeverity = events.reduce((acc, e) => { acc[e.severity] = (acc[e.severity] || 0) + 1; return acc; }, {});
  const byRule = events.reduce((acc, e) => { acc[e.ruleId] = (acc[e.ruleId] || 0) + 1; return acc; }, {});
  const byProperty = events.reduce((acc, e) => { acc[e.propertyId] = (acc[e.propertyId] || 0) + 1; return acc; }, {});
  return {
    total: events.length,
    bySeverity,
    byRule,
    byProperty,
    open: events.filter(e => e.status === "open").length,
    resolved: events.filter(e => e.status === "resolved").length,
    dismissed: events.filter(e => e.status === "dismissed").length,
  };
}
