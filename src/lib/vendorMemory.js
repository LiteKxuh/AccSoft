/* HotelOps · Vendor memory
 * =================================================================
 * Learns "Sysco invoices always go to acct 5100" from past coding
 * decisions, then auto-suggests an account + department on new
 * invoices. Pure local, no network. Stored in localStorage so the
 * memory persists across reloads independent of the main app state.
 */

const KEY = "hotelops:vendorMemory";

/** @typedef {{accountCode: string, departmentId?: string, count: number, lastSeen: string}} Coding */

function load() {
  if (typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function save(map) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch {}
}

/**
 * Record that a vendor's invoice was coded a certain way.
 * Bumps confidence each time the same coding is reused.
 */
export function remember({ vendorId, accountCode, departmentId = null }) {
  if (!vendorId || !accountCode) return;
  const map = load();
  if (!map[vendorId]) map[vendorId] = { codings: {}, lastUpdate: null };
  const k = `${accountCode}::${departmentId || ""}`;
  if (!map[vendorId].codings[k]) {
    map[vendorId].codings[k] = { accountCode, departmentId, count: 0, lastSeen: null };
  }
  map[vendorId].codings[k].count += 1;
  map[vendorId].codings[k].lastSeen = new Date().toISOString();
  map[vendorId].lastUpdate = new Date().toISOString();
  save(map);
}

/**
 * Return the most-confident coding for a vendor, or null if no history.
 * Score blends frequency and recency.
 */
export function suggest(vendorId) {
  if (!vendorId) return null;
  const map = load();
  const v = map[vendorId];
  if (!v) return null;
  let best = null;
  let bestScore = 0;
  for (const k of Object.keys(v.codings || {})) {
    const c = v.codings[k];
    const ageDays = c.lastSeen ? (Date.now() - new Date(c.lastSeen).getTime()) / 86400000 : 365;
    const recency = Math.max(0, 1 - ageDays / 180);
    const score = c.count * 0.7 + recency * 0.3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return null;
  return {
    accountCode: best.accountCode,
    departmentId: best.departmentId,
    confidence: Math.min(1, bestScore / 5),
    reason: `Used ${best.count}× — last on ${(best.lastSeen || "").slice(0, 10)}`,
  };
}

/**
 * Heuristic fallback for vendors with no coding history. Uses keyword
 * matching against vendor name + USALI account hints.
 */
const KEYWORD_RULES = [
  { keywords: ["sysco", "us foods", "restaurant depot", "produce", "meat", "seafood"], code: "5100" }, // F&B Cost of Sales — Food
  { keywords: ["beverage", "wine", "liquor", "beer", "spirits"], code: "5110" },                       // F&B — Beverage
  { keywords: ["linen", "laundry", "uniform"], code: "6210" },                                          // Rooms — Operating Supplies
  { keywords: ["amenity", "amenities", "shampoo", "soap", "toiletry"], code: "6220" },
  { keywords: ["telephone", "phone", "att ", "verizon", "comcast", "spectrum"], code: "6500" },         // Telecom
  { keywords: ["pest", "exterminator", "termite"], code: "6710" },                                      // Repairs
  { keywords: ["plumbing", "hvac", "electrical", "elevator", "maintenance", "repair"], code: "6700" },
  { keywords: ["water", "sewer", "trash", "waste"], code: "6810" },                                     // Utilities
  { keywords: ["electric", "gas", "energy", "power"], code: "6800" },
  { keywords: ["insurance"], code: "6900" },
  { keywords: ["property tax", "tax assessor", "county tax"], code: "6910" },
  { keywords: ["legal", "attorney", "law firm"], code: "7100" },
  { keywords: ["accounting", "cpa", "audit", "tax prep"], code: "7110" },
  { keywords: ["advertising", "marketing", "google ads", "facebook ads"], code: "7200" },
  { keywords: ["software", "saas", "subscription"], code: "7300" },
  { keywords: ["bank", "merchant fee", "card processing"], code: "7400" },
];

export function suggestFromName(vendorName) {
  const n = String(vendorName || "").toLowerCase();
  if (!n) return null;
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some(k => n.includes(k))) {
      return { accountCode: rule.code, departmentId: null, confidence: 0.5, reason: `Keyword match: "${rule.keywords.find(k => n.includes(k))}"` };
    }
  }
  return null;
}

/**
 * Combined suggester — tries vendor memory first, falls back to name keyword rules.
 * Returns null if nothing applies.
 */
export function suggestForInvoice({ vendorId, vendorName }) {
  return suggest(vendorId) || suggestFromName(vendorName);
}

/** Wipe all vendor memory — used by Settings → Reset. */
export function clearAll() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
}

/** Export the raw map for diagnostics / backup. */
export function exportMemory() {
  return load();
}

/** Restore from a previously exported map. */
export function importMemory(map) {
  if (!map || typeof map !== "object") return false;
  save(map);
  return true;
}
