/* HotelOps · Audit log
 * =================================================================
 * Append-only event log: who, when, what, before, after. Persists
 * separately from the main app state in localStorage so a state
 * restore doesn't overwrite history. Capped at MAX_ENTRIES; oldest
 * are pruned in batches of 200 to keep writes cheap.
 *
 * Entry shape:
 *   { id, ts, userId, userName, action, entityType, entityId, before, after, meta }
 */

const KEY = "hotelops:auditLog";
const MAX_ENTRIES = 5000;
const PRUNE_BATCH = 200;

let _seq = 0;

/** Append a new event. Returns the entry. */
export function logEvent({ userId, userName, action, entityType, entityId, before, after, meta }) {
  _seq = (_seq + 1) % 1_000_000;
  const seqStr = String(_seq).padStart(6, "0");
  const entry = {
    id: `evt_${Date.now()}_${seqStr}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    seq: _seq,
    userId: userId || null,
    userName: userName || "system",
    action,
    entityType,
    entityId: entityId || null,
    before: snapshot(before),
    after: snapshot(after),
    meta: meta || null,
  };
  const list = readLog();
  list.push(entry);
  if (list.length > MAX_ENTRIES) list.splice(0, PRUNE_BATCH);
  writeLog(list);
  return entry;
}

/** All events, newest first. */
export function readEvents({ since, until, action, entityType, entityId, userId, limit } = {}) {
  let list = readLog();
  if (since) list = list.filter(e => e.ts >= since);
  if (until) list = list.filter(e => e.ts <= until);
  if (action) list = list.filter(e => e.action === action);
  if (entityType) list = list.filter(e => e.entityType === entityType);
  if (entityId) list = list.filter(e => e.entityId === entityId);
  if (userId) list = list.filter(e => e.userId === userId);
  list.sort((a, b) => {
    const t = b.ts.localeCompare(a.ts);
    if (t !== 0) return t;
    return (b.seq || 0) - (a.seq || 0);
  });
  if (limit) list = list.slice(0, limit);
  return list;
}

/** Diff helper — returns { changedFields: [...], summary: "x → y" }. */
export function diffSummary(before, after) {
  if (!before && !after) return { changedFields: [], summary: "" };
  if (!before) return { changedFields: Object.keys(after || {}), summary: "(created)" };
  if (!after) return { changedFields: Object.keys(before || {}), summary: "(deleted)" };
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const k of fields) {
    if (k.startsWith("_")) continue;
    if (typeof before[k] === "object" && typeof after[k] === "object") {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
    } else if (before[k] !== after[k]) {
      changed.push(k);
    }
  }
  return {
    changedFields: changed,
    summary: changed.length === 0
      ? "(no field changes)"
      : changed.slice(0, 3).map(f => `${f}: ${fmt(before[f])} → ${fmt(after[f])}`).join("; ") + (changed.length > 3 ? `; +${changed.length - 3} more` : ""),
  };
}

function snapshot(o) {
  if (o == null) return null;
  try {
    const s = JSON.parse(JSON.stringify(o));
    // Strip giant blobs (attachments base64) so the log stays small
    if (Array.isArray(s.attachments)) {
      s.attachments = s.attachments.map(a => ({ ...a, dataUrl: a.dataUrl ? `[${a.dataUrl.length} chars]` : null }));
    }
    return s;
  } catch { return null; }
}

function readLog() {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function writeLog(list) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
function fmt(v) {
  if (v == null) return "—";
  if (typeof v === "string" && v.length > 30) return v.slice(0, 27) + "...";
  if (typeof v === "object") return "{...}";
  return String(v);
}

/** Erase the audit log. Use only with explicit user confirmation. */
export function clearLog() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
}

/**
 * Compare two app-state snapshots and emit one or more events for the
 * collections that changed. This is what the update() mutator wraps.
 */
export function detectStateChanges({ before, after, user }) {
  const COLLECTIONS = ["properties", "employees", "shifts", "schedule", "reports", "budgets", "vendors", "invoices", "payrollRuns", "contractors", "contractorPayments", "journalEntries", "closedPeriods", "bankRecs"];
  const events = [];
  for (const col of COLLECTIONS) {
    const a = before?.[col] || [];
    const b = after?.[col] || [];
    if (a === b) continue;
    if (a.length === b.length && a.every((x, i) => x === b[i])) continue;

    const aById = Object.fromEntries(a.map(x => [x.id, x]));
    const bById = Object.fromEntries(b.map(x => [x.id, x]));

    // Adds
    for (const id of Object.keys(bById)) {
      if (!aById[id]) {
        events.push({
          userId: user?.id, userName: user ? `${user.firstName} ${user.lastName}` : "system",
          action: "create", entityType: col, entityId: id,
          before: null, after: bById[id], meta: null,
        });
      }
    }
    // Updates
    for (const id of Object.keys(bById)) {
      if (aById[id] && aById[id] !== bById[id]) {
        const d = diffSummary(aById[id], bById[id]);
        if (d.changedFields.length > 0) {
          events.push({
            userId: user?.id, userName: user ? `${user.firstName} ${user.lastName}` : "system",
            action: "update", entityType: col, entityId: id,
            before: aById[id], after: bById[id],
            meta: { changedFields: d.changedFields },
          });
        }
      }
    }
    // Deletes
    for (const id of Object.keys(aById)) {
      if (!bById[id]) {
        events.push({
          userId: user?.id, userName: user ? `${user.firstName} ${user.lastName}` : "system",
          action: "delete", entityType: col, entityId: id,
          before: aById[id], after: null, meta: null,
        });
      }
    }
  }
  return events;
}
