/* HotelOps · Hospitality Integration Hub
 * =================================================================
 * Abstraction layer that sits above every external hospitality system —
 * PMS (OPERA, OnQ, Mews, Cloudbeds, Maestro, SynXis), revenue
 * management (Duetto, Lighthouse), payment processors (Stripe, Micros),
 * POS (Toast), payroll (ADP, Paychex), and reservation engines.
 *
 * The hub does NOT own external API credentials or perform network
 * I/O directly — those are provided by adapter implementations.
 * Adapters share:
 *
 *   {
 *     id, label, kind,                    // "pms" | "rms" | "pos" | "payroll" | "payment" | "channel"
 *     transport: "rest" | "soap" | "csv" | "webhook" | "ftp",
 *     capabilities: [string],             // "reservations", "folios", "rates", "inventory", "transactions"
 *     normalize(input, type)              // map vendor payload → canonical shape
 *     verify({ credential, ctx })         // returns { ok, info, error? }
 *     pull(type, opts)                    // returns canonical records
 *     push?(type, payload, opts)          // optional outbound
 *   }
 *
 * The hub itself provides:
 *   - registry & lookup
 *   - sync queue + retry policy
 *   - canonical schema definitions
 *   - sync observability (last sync, last error, success rate)
 *   - conflict resolution helpers
 *   - normalization pass-through
 *
 * Pure, deterministic, network-free. Adapters can be tested with mocks.
 */

import { createEventBus } from "./workflowKernel.js";

/* ---------- Canonical schemas ---------- */

/**
 * Canonical record shapes the rest of the system reads from. Every
 * adapter must normalize() its vendor payloads into these.
 */
export const CANONICAL_SCHEMAS = {
  reservation: ["id", "propertyId", "guestName", "arrival", "departure", "roomType", "rate", "channel", "status"],
  folio:       ["id", "reservationId", "propertyId", "openDate", "closeDate", "totalCharges", "totalPayments", "balance"],
  rate:        ["id", "propertyId", "date", "roomType", "rate", "currency"],
  inventory:   ["propertyId", "date", "roomType", "available", "sold", "outOfOrder"],
  transaction: ["id", "propertyId", "date", "amount", "type", "guestId", "method"],
  employee:    ["id", "propertyId", "name", "title", "departmentId", "payRate", "active"],
};

/* ---------- Adapter registry ---------- */

const REGISTRY = new Map();

export function registerAdapter(adapter) {
  if (!adapter?.id) throw new Error("registerAdapter: id required");
  if (typeof adapter.normalize !== "function") throw new Error("registerAdapter: normalize() required");
  if (typeof adapter.verify !== "function") throw new Error("registerAdapter: verify() required");
  if (typeof adapter.pull !== "function") throw new Error("registerAdapter: pull() required");
  REGISTRY.set(adapter.id, adapter);
  return adapter;
}

export function getAdapter(id) {
  return REGISTRY.get(id) || null;
}

export function listAdapters(filter = {}) {
  const all = Array.from(REGISTRY.values());
  return all.filter(a =>
    (!filter.kind || a.kind === filter.kind) &&
    (!filter.transport || a.transport === filter.transport) &&
    (!filter.capability || (a.capabilities || []).includes(filter.capability))
  );
}

export function unregisterAdapter(id) {
  return REGISTRY.delete(id);
}

/* ---------- Sync queue + scheduler ---------- */

/**
 * Build a sync plan: list of (adapter, type) pairs to execute, respecting
 * adapter capabilities and the operator's preferences.
 */
export function buildSyncPlan({ adapterIds = null, types = null, ctx = {} } = {}) {
  const adapters = adapterIds
    ? adapterIds.map(id => REGISTRY.get(id)).filter(Boolean)
    : Array.from(REGISTRY.values());
  const plan = [];
  for (const a of adapters) {
    for (const cap of (a.capabilities || [])) {
      if (types && !types.includes(cap)) continue;
      plan.push({ adapterId: a.id, type: cap, queuedAt: new Date().toISOString() });
    }
  }
  return plan;
}

/**
 * Execute a sync plan. Returns per-step results + adapter-level health.
 * The hub never throws — failures are captured per step.
 */
export async function runSyncPlan(plan, { ctx = {}, bus = null, onStep = null } = {}) {
  const results = [];
  for (const step of plan) {
    const adapter = REGISTRY.get(step.adapterId);
    const startedAt = new Date().toISOString();
    if (!adapter) {
      results.push({ ...step, ok: false, error: "adapter not registered", startedAt, finishedAt: new Date().toISOString() });
      continue;
    }
    bus?.emit("sync.start", { adapterId: adapter.id, type: step.type });
    let pulled;
    try {
      pulled = await adapter.pull(step.type, { ctx });
    } catch (e) {
      pulled = { ok: false, error: e?.message || String(e), records: [] };
    }
    // Normalize records if adapter returned raw
    let records = pulled?.records || [];
    if (records.length && typeof adapter.normalize === "function") {
      try {
        records = records.map(r => adapter.normalize(r, step.type));
      } catch (e) {
        records = [];
        pulled = { ok: false, error: `normalize failed: ${e?.message || e}` };
      }
    }
    const ok = !!pulled?.ok;
    const result = {
      ...step,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok,
      recordCount: records.length,
      records,
      error: pulled?.error || null,
    };
    results.push(result);
    if (onStep) onStep(result);
    bus?.emit(ok ? "sync.succeed" : "sync.fail", { adapterId: adapter.id, type: step.type, recordCount: records.length, error: result.error });
  }
  return results;
}

/* ---------- Observability ---------- */

/** Roll up sync results into an integration health snapshot. */
export function integrationHealth(syncResults = []) {
  const byAdapter = new Map();
  for (const r of syncResults) {
    if (!byAdapter.has(r.adapterId)) byAdapter.set(r.adapterId, { adapterId: r.adapterId, total: 0, succeeded: 0, failed: 0, lastSync: null, lastError: null, totalRecords: 0 });
    const row = byAdapter.get(r.adapterId);
    row.total++;
    if (r.ok) row.succeeded++;
    else { row.failed++; row.lastError = r.error; }
    row.totalRecords += r.recordCount || 0;
    if (!row.lastSync || r.finishedAt > row.lastSync) row.lastSync = r.finishedAt;
  }
  const rows = Array.from(byAdapter.values()).map(r => ({
    ...r,
    successRate: r.total > 0 ? r.succeeded / r.total : 1,
    health: r.failed === 0 ? "healthy" : r.failed > r.succeeded ? "unhealthy" : "degraded",
  }));
  return {
    adapterCount: rows.length,
    totalSyncs: rows.reduce((s, r) => s + r.total, 0),
    healthyCount: rows.filter(r => r.health === "healthy").length,
    rows,
  };
}

/* ---------- Conflict resolution ---------- */

/**
 * Reconcile a canonical record from multiple sources. Last-write-wins by
 * default; caller can supply a precedence map (sourceId → rank, higher wins).
 */
export function reconcileRecord(records = [], { precedence = {} } = {}) {
  if (!records.length) return null;
  if (records.length === 1) return records[0];
  // Pick the highest-precedence source, or by latest updatedAt
  const ranked = [...records].sort((a, b) => {
    const rA = precedence[a._source] || 0;
    const rB = precedence[b._source] || 0;
    if (rA !== rB) return rB - rA;
    return String(b.updatedAt || b._receivedAt || "").localeCompare(String(a.updatedAt || a._receivedAt || ""));
  });
  return ranked[0];
}

/* ---------- Adapter stubs (deterministic, demo-able) ----------
 * Real implementations would replace pull() with HTTP/SOAP calls.
 * The stubs here verify the schema contract and let UI dev proceed.
 */

function stubAdapter({ id, label, kind, transport = "rest", capabilities = [] }) {
  return {
    id, label, kind, transport, capabilities,
    normalize(input, type) {
      // Identity normalization — pretend the input was already canonical
      return { ...input, _source: id, _receivedAt: new Date().toISOString() };
    },
    async verify({ credential = null } = {}) {
      return { ok: !!credential, info: credential ? `${label} reachable (stub)` : "missing credential" };
    },
    async pull(type, opts = {}) {
      if (!capabilities.includes(type)) return { ok: false, error: `capability ${type} not supported`, records: [] };
      // Stub returns empty success — real adapter would fetch
      return { ok: true, records: [] };
    },
  };
}

/** Register the platform's well-known integration stubs. */
export function registerDefaultAdapters() {
  const defaults = [
    { id: "opera", label: "Oracle Hospitality OPERA", kind: "pms", transport: "soap", capabilities: ["reservations", "folios", "rates", "inventory"] },
    { id: "onq", label: "OnQ PMS (Hilton)", kind: "pms", transport: "rest", capabilities: ["reservations", "folios"] },
    { id: "mews", label: "Mews", kind: "pms", transport: "rest", capabilities: ["reservations", "folios", "rates", "inventory"] },
    { id: "cloudbeds", label: "Cloudbeds", kind: "pms", transport: "rest", capabilities: ["reservations", "folios", "rates"] },
    { id: "maestro", label: "Maestro PMS", kind: "pms", transport: "soap", capabilities: ["reservations", "folios"] },
    { id: "synxis", label: "Sabre SynXis", kind: "channel", transport: "rest", capabilities: ["rates", "inventory", "reservations"] },
    { id: "duetto", label: "Duetto RMS", kind: "rms", transport: "rest", capabilities: ["rates"] },
    { id: "lighthouse", label: "Lighthouse Intelligence", kind: "rms", transport: "rest", capabilities: ["rates"] },
    { id: "toast", label: "Toast POS", kind: "pos", transport: "rest", capabilities: ["transactions"] },
    { id: "micros", label: "Oracle MICROS Simphony", kind: "pos", transport: "rest", capabilities: ["transactions"] },
    { id: "stripe", label: "Stripe", kind: "payment", transport: "rest", capabilities: ["transactions"] },
    { id: "adp", label: "ADP Workforce Now", kind: "payroll", transport: "rest", capabilities: ["employee"] },
    { id: "paychex", label: "Paychex Flex", kind: "payroll", transport: "rest", capabilities: ["employee"] },
  ];
  for (const d of defaults) {
    if (!REGISTRY.has(d.id)) registerAdapter(stubAdapter(d));
  }
  return Array.from(REGISTRY.values()).map(a => ({ id: a.id, label: a.label, kind: a.kind, capabilities: a.capabilities }));
}

/* ---------- Webhook ingestion ---------- */

/**
 * Validate and normalize an inbound webhook payload. Returns a canonical
 * record (or null) plus an "event" describing what happened, suitable
 * for emission through the workflow kernel bus.
 */
export function ingestWebhook({ adapterId, type, payload }) {
  const adapter = REGISTRY.get(adapterId);
  if (!adapter) return { ok: false, error: "unknown adapter" };
  if (!CANONICAL_SCHEMAS[type]) return { ok: false, error: `unknown type ${type}` };
  let normalized;
  try {
    normalized = adapter.normalize(payload, type);
  } catch (e) {
    return { ok: false, error: `normalize failed: ${e?.message || e}` };
  }
  // Verify all canonical keys are present
  const required = CANONICAL_SCHEMAS[type];
  const missing = required.filter(k => normalized[k] === undefined);
  if (missing.length) {
    return { ok: false, error: `missing required fields: ${missing.join(", ")}`, record: normalized };
  }
  return {
    ok: true,
    record: normalized,
    event: { kind: "webhook.received", adapterId, type, at: new Date().toISOString() },
  };
}

/* ---------- Helpers exposed for tests ---------- */

export const __test = { stubAdapter };
