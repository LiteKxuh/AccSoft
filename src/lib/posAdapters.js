/* HotelOps · POS adapters (Toast, Square, Aloha)
 * =================================================================
 * Pulls daily F&B sales from a POS provider and feeds them into the
 * Daily Flash. Inert until the user configures credentials in
 * Settings → Integrations. Each adapter implements:
 *
 *   { name, isConfigured(), pullDailySales(date) -> { food, bar, banquet, raw } }
 *
 * Like bankFeeds.js, network calls are funneled through a server-side
 * worker so credentials don't ship to clients.
 */

const STORAGE_PROVIDER = "hotelops:posProvider";
const STORAGE_PROXY_URL = "hotelops:posProxyUrl";
const STORAGE_PROXY_AUTH = "hotelops:posProxyAuth";

// ---------------- adapter definitions ----------------
const adapters = {
  toast: makeAdapter("toast", "Toast POS"),
  square: makeAdapter("square", "Square for Restaurants"),
  aloha: makeAdapter("aloha", "NCR Aloha"),
  micros: makeAdapter("micros", "Oracle Micros / Simphony"),
};

function makeAdapter(id, label) {
  return {
    id,
    label,
    isConfigured() {
      if (typeof localStorage === "undefined") return false;
      return localStorage.getItem(STORAGE_PROVIDER) === id && !!localStorage.getItem(STORAGE_PROXY_URL);
    },
    async pullDailySales(date) {
      const url = posProxyUrl();
      const res = await fetch(`${url}/${id}/sales`, {
        method: "POST",
        headers: posHeaders(),
        body: JSON.stringify({ date }),
      });
      if (!res.ok) throw new Error(`${label} ${res.status}`);
      const data = await res.json();
      return normalize(data);
    },
    async testConnection() {
      const url = posProxyUrl();
      const res = await fetch(`${url}/${id}/ping`, {
        method: "POST",
        headers: posHeaders(),
      });
      return res.ok;
    },
  };
}

// Try to map disparate POS payloads onto a uniform shape.
function normalize(data) {
  if (!data) return { food: 0, bar: 0, banquet: 0, total: 0, raw: data };
  // Toast-like
  const food = num(data.food ?? data.foodNet ?? data.foodSales ?? data.kitchenSales);
  const bar = num(data.bar ?? data.beverageNet ?? data.barSales ?? data.alcoholSales);
  const banquet = num(data.banquet ?? data.cateringNet ?? data.banquetSales ?? data.eventSales);
  const total = num(data.total ?? data.netSales ?? (food + bar + banquet));
  return { food, bar, banquet, total, raw: data };
}
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function readLs(k) { try { return localStorage.getItem(k) || null; } catch { return null; } }
function posProxyUrl() {
  const url = readLs(STORAGE_PROXY_URL);
  if (!url) throw new Error("POS proxy URL is not configured. Set it in Settings → Integrations.");
  return url.replace(/\/$/, "");
}
function posHeaders() {
  const h = { "Content-Type": "application/json" };
  const auth = readLs(STORAGE_PROXY_AUTH);
  if (auth) h["X-HotelOps-Auth"] = auth;
  return h;
}

// ---------------- public API ----------------
export function listProviders() {
  return Object.values(adapters).map(a => ({ id: a.id, label: a.label, configured: a.isConfigured() }));
}

export function activeProvider() {
  const id = readLs(STORAGE_PROVIDER);
  return id && adapters[id] ? adapters[id] : null;
}

export function setActiveProvider(id) {
  if (!adapters[id]) throw new Error(`Unknown POS provider: ${id}`);
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_PROVIDER, id);
}

export function clearActiveProvider() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_PROVIDER);
}

export async function fetchDailySalesForDate(date) {
  const provider = activeProvider();
  if (!provider) return null;
  if (!provider.isConfigured()) return null;
  return provider.pullDailySales(date);
}

export function isConfigured() {
  return !!activeProvider() && activeProvider().isConfigured();
}

export function setupHint() {
  return {
    title: "POS not connected",
    body: "Auto-pull daily F&B sales from Toast, Square, Aloha, or Micros. Requires a POS proxy worker (see worker/pos-proxy.md) to keep API credentials server-side.",
    docsHref: "worker/pos-proxy.md",
  };
}
