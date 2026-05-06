/* HotelOps · Bank-feed adapters
 * =================================================================
 * Plaid + (future) Yodlee scaffolding. Inert until configured —
 * no network calls fire unless `getProvider()` returns a configured
 * adapter. The UI imports this module and renders a "Connect bank"
 * button; if no provider is wired, the button shows a setup hint
 * instead of throwing.
 *
 * To activate Plaid:
 *   1. Run the worker (worker/anthropic-proxy.js pattern) with these
 *      secrets: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|development|production)
 *   2. Set localStorage["hotelops:bankProxyUrl"] to the worker URL
 *   3. Connect from Settings → Bank Feeds → Connect
 *
 * The matching engine in match() is provider-agnostic — even with no
 * live feed, you can paste a CSV and it will match against ledger JEs.
 */

const STORAGE_LINKS = "hotelops:bankLinks";
const STORAGE_TXNS = "hotelops:bankTxns";

// ---------------- adapter registry ----------------
const ADAPTERS = {};

export function registerAdapter(name, adapter) {
  ADAPTERS[name] = adapter;
}

export function getProvider() {
  if (typeof window === "undefined") return null;
  const url = window.__HOTELOPS_BANK_PROXY__ || localStorage.getItem("hotelops:bankProxyUrl");
  if (!url) return null;
  // Plaid is the default adapter when a proxy URL is set.
  return ADAPTERS.plaid || null;
}

// ---------------- Plaid adapter ----------------
// Talks to a server-side worker (the same pattern as anthropic-proxy.js)
// that holds PLAID_CLIENT_ID / PLAID_SECRET. The browser never sees secrets.
const plaidAdapter = {
  name: "plaid",

  async createLinkToken({ userId }) {
    const url = bankProxyUrl();
    const res = await fetch(`${url}/plaid/link-token`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) throw new Error(`Plaid link-token ${res.status}`);
    return res.json(); // { link_token, expiration }
  },

  async exchangePublicToken({ publicToken, institution, accounts }) {
    const url = bankProxyUrl();
    const res = await fetch(`${url}/plaid/exchange`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ publicToken }),
    });
    if (!res.ok) throw new Error(`Plaid exchange ${res.status}`);
    const { itemId } = await res.json();
    const link = {
      id: `lnk_${itemId}`,
      provider: "plaid",
      itemId,
      institution: institution?.name || "Unknown bank",
      institutionId: institution?.institution_id || null,
      accounts: (accounts || []).map(a => ({
        id: a.id, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype,
      })),
      connectedAt: new Date().toISOString(),
      lastSync: null,
      status: "active",
    };
    persistLink(link);
    return link;
  },

  async syncTransactions(link, { since } = {}) {
    const url = bankProxyUrl();
    const res = await fetch(`${url}/plaid/transactions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ itemId: link.itemId, since }),
    });
    if (!res.ok) throw new Error(`Plaid transactions ${res.status}`);
    const { added, modified, removed, cursor } = await res.json();
    const normalized = (added || []).map(normalizeTxn);
    persistTxns(link.id, normalized);
    persistLink({ ...link, lastSync: new Date().toISOString(), cursor });
    return { added: normalized, modified: modified || [], removed: removed || [] };
  },

  async disconnect(link) {
    const url = bankProxyUrl();
    try {
      await fetch(`${url}/plaid/disconnect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ itemId: link.itemId }),
      });
    } catch {}
    removeLink(link.id);
    return true;
  },
};
registerAdapter("plaid", plaidAdapter);

// ---------------- shared helpers ----------------
function bankProxyUrl() {
  const url = (typeof window !== "undefined" && (window.__HOTELOPS_BANK_PROXY__ || localStorage.getItem("hotelops:bankProxyUrl"))) || "";
  if (!url) throw new Error("Bank proxy URL is not configured. Set hotelops:bankProxyUrl in Settings.");
  return url.replace(/\/$/, "");
}
function authHeaders() {
  const h = { "Content-Type": "application/json" };
  const auth = (typeof window !== "undefined" && localStorage.getItem("hotelops:bankProxyAuth")) || null;
  if (auth) h["X-HotelOps-Auth"] = auth;
  return h;
}
function persistLink(link) {
  if (typeof localStorage === "undefined") return;
  const all = listLinks();
  const idx = all.findIndex(l => l.id === link.id);
  if (idx >= 0) all[idx] = link; else all.push(link);
  localStorage.setItem(STORAGE_LINKS, JSON.stringify(all));
}
function removeLink(id) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_LINKS, JSON.stringify(listLinks().filter(l => l.id !== id)));
  localStorage.removeItem(`${STORAGE_TXNS}:${id}`);
}

export function listLinks() {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_LINKS) || "[]"); } catch { return []; }
}

function persistTxns(linkId, txns) {
  if (typeof localStorage === "undefined") return;
  const key = `${STORAGE_TXNS}:${linkId}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  const seen = new Set(existing.map(t => t.id));
  const merged = [...existing, ...txns.filter(t => !seen.has(t.id))];
  localStorage.setItem(key, JSON.stringify(merged));
}

export function listTxns(linkId) {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(`${STORAGE_TXNS}:${linkId}`) || "[]"); } catch { return []; }
}

function normalizeTxn(t) {
  // Plaid returns positive amounts as outflows. We invert so a deposit is +,
  // a withdrawal is - (matches typical bank-rec conventions).
  return {
    id: t.transaction_id,
    accountId: t.account_id,
    date: (t.date || "").slice(0, 10),
    amount: -Number(t.amount), // flip: Plaid debit = positive expense; we want negative = outflow
    name: t.name || t.merchant_name || "(unknown)",
    merchant: t.merchant_name || null,
    category: t.personal_finance_category?.primary || (t.category && t.category[0]) || null,
    pending: !!t.pending,
    raw: t,
  };
}

// ---------------- universal CSV import ----------------
/** Parse a generic bank CSV into our transaction shape. Best-effort header matching. */
export function parseBankCSV(text) {
  if (!text) return [];
  const lines = String(text).replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCSV(lines[0]).map(h => h.toLowerCase().trim());
  const idx = (...names) => {
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const dateIdx = idx("date", "posted");
  const descIdx = idx("description", "memo", "name", "payee");
  const amtIdx = idx("amount", "debit", "credit");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSV(lines[i]);
    if (!cells.length) continue;
    const date = cells[dateIdx] || "";
    const name = cells[descIdx] || "";
    const amt = parseFloat(String(cells[amtIdx] || "0").replace(/[^0-9.\-]/g, ""));
    if (!date || !Number.isFinite(amt)) continue;
    out.push({
      id: `csv_${i}_${date}_${Math.abs(amt)}`,
      accountId: "csv-upload",
      date: normalizeDate(date),
      amount: amt,
      name: name.trim(),
      merchant: null,
      category: null,
      pending: false,
    });
  }
  return out;
}

function splitCSV(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeDate(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = (Number(y) >= 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return t.slice(0, 10);
}

// ---------------- matching engine ----------------
/**
 * Match bank transactions against journal entries / invoices / payroll.
 * Returns matches and unmatched on both sides. Pure function — no I/O.
 */
export function matchTransactions({ bankTxns, journalEntries = [], invoices = [], payrollRuns = [], windowDays = 4, tolerance = 0.5 }) {
  const matches = [];
  const usedJE = new Set();
  const usedInv = new Set();
  const usedPay = new Set();

  for (const t of bankTxns) {
    const tDate = new Date(t.date);
    let best = null;

    // Try invoices first (clearest match: vendor + amount)
    for (const inv of invoices) {
      if (usedInv.has(inv.id)) continue;
      if (inv.status !== "paid" || !inv.paidDate) continue;
      const dDays = Math.abs((new Date(inv.paidDate) - tDate) / 86400000);
      if (dDays > windowDays) continue;
      const tAmt = Math.abs(t.amount);
      const iAmt = Math.abs(inv.amount);
      if (Math.abs(tAmt - iAmt) > tolerance) continue;
      const score = 1.0 - (dDays / windowDays) * 0.3;
      if (!best || score > best.score) best = { type: "invoice", id: inv.id, score, ref: inv };
    }

    // Try payroll runs
    for (const run of payrollRuns) {
      if (usedPay.has(run.id)) continue;
      const runDate = run.payDate || run.runDate;
      if (!runDate) continue;
      const dDays = Math.abs((new Date(runDate) - tDate) / 86400000);
      if (dDays > windowDays) continue;
      const total = Number(run.netPay || run.total || 0);
      if (!total) continue;
      if (Math.abs(Math.abs(t.amount) - total) > tolerance) continue;
      const score = 0.95 - (dDays / windowDays) * 0.3;
      if (!best || score > best.score) best = { type: "payroll", id: run.id, score, ref: run };
    }

    // Fall back to journal entries
    for (const je of journalEntries) {
      if (usedJE.has(je.id)) continue;
      if (!je.posted || je.void) continue;
      const dDays = Math.abs((new Date(je.date) - tDate) / 86400000);
      if (dDays > windowDays) continue;
      const total = (je.lines || []).reduce((s, l) => s + Math.max(l.debit || 0, l.credit || 0), 0);
      if (!total) continue;
      if (Math.abs(Math.abs(t.amount) - total) > tolerance) continue;
      const score = 0.85 - (dDays / windowDays) * 0.3;
      if (!best || score > best.score) best = { type: "journal", id: je.id, score, ref: je };
    }

    if (best) {
      matches.push({ txn: t, ...best });
      if (best.type === "invoice") usedInv.add(best.id);
      else if (best.type === "payroll") usedPay.add(best.id);
      else usedJE.add(best.id);
    }
  }

  const matchedTxnIds = new Set(matches.map(m => m.txn.id));
  return {
    matches,
    unmatchedTxns: bankTxns.filter(t => !matchedTxnIds.has(t.id)),
    unmatchedInvoices: invoices.filter(i => i.status === "paid" && !usedInv.has(i.id)),
    unmatchedPayroll: payrollRuns.filter(p => !usedPay.has(p.id)),
  };
}

// ---------------- status helpers ----------------
export function isConfigured() {
  if (typeof window === "undefined") return false;
  return !!(window.__HOTELOPS_BANK_PROXY__ || localStorage.getItem("hotelops:bankProxyUrl"));
}

export function setupHint() {
  return {
    title: "Bank feed not yet connected",
    body: "HotelOps can import bank transactions automatically via Plaid (free during development). To enable, deploy the bank-feed worker (see worker/bankfeed-proxy.md) and paste its URL into Settings → Bank Feeds.",
    docsHref: "worker/bankfeed-proxy.md",
  };
}
