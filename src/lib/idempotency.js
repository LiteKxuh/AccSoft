/* HotelOps · Idempotency keys
 * =================================================================
 * Prevents duplicate financial postings under rapid double-clicks,
 * retries after a network hiccup, or batch re-runs. The key combines
 * a logical event (e.g. "ap-pay-{invoiceId}") with the day; if the
 * same key shows up twice in a window, the second attempt no-ops.
 *
 * Storage is in localStorage so it survives reloads. For multi-user /
 * cloud deployments the same interface backs a server-side store.
 *
 *   reserveKey(key, { ttlHours = 48 })  → true if acquired, false if already present
 *   hasKey(key)
 *   releaseKey(key)
 *   prune()
 */

const STORE_KEY = "hotelops:idempotencyKeys";

function load() {
  if (typeof localStorage === "undefined") return globalThis.__hotelops_idemp || {};
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}

function save(map) {
  if (typeof localStorage === "undefined") {
    globalThis.__hotelops_idemp = map;
    return;
  }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch {}
}

export function reserveKey(key, { ttlHours = 48 } = {}) {
  if (!key) return false;
  const map = load();
  const now = Date.now();
  prune(map, now);
  if (map[key] && map[key].expiresAt > now) return false;
  map[key] = { acquiredAt: now, expiresAt: now + ttlHours * 3600 * 1000 };
  save(map);
  return true;
}

export function hasKey(key) {
  if (!key) return false;
  const map = load();
  const now = Date.now();
  return !!(map[key] && map[key].expiresAt > now);
}

export function releaseKey(key) {
  if (!key) return;
  const map = load();
  delete map[key];
  save(map);
}

export function prune(map = null, now = Date.now()) {
  const m = map || load();
  let changed = false;
  for (const k of Object.keys(m)) {
    if (m[k].expiresAt <= now) {
      delete m[k];
      changed = true;
    }
  }
  if (!map && changed) save(m);
  return m;
}

/** Convenience: composable keys for common operations. */
export function apPayKey(invoiceId, day = null) {
  return `ap-pay::${invoiceId}::${day || new Date().toISOString().slice(0, 10)}`;
}
export function payrollPostKey(runId) { return `payroll-post::${runId}`; }
export function reportPostKey(reportId) { return `report-post::${reportId}`; }
export function mgmtFeePostKey(propertyId, month) { return `mgmtfee-post::${propertyId}::${month}`; }
