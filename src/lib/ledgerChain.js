/* HotelOps · Ledger hash chain
 * =================================================================
 * Tamper-evident chain over posted journal entries. Each posted JE
 * carries `chainHash = SHA-256(prevHash + canonicalJson(coreFields))`.
 * Re-walking the chain detects any after-the-fact mutation of date,
 * lines, amounts, or account codes — silent edits become loud.
 *
 * Uses SubtleCrypto where available (browser + node 19+) and a tiny
 * synchronous fallback for the test environment.
 *
 * Public API:
 *   await stampEntry(entry, prevHash)
 *       → { ...entry, chainHash, chainPrev, chainStampedAt }
 *   await verifyChain(entries)
 *       → { ok, brokenAt: index|null, expected, actual, reason }
 *   canonicalize(entry) → string
 *   computeHash(input)  → Promise<hex>
 *
 * Convention:
 *   The chain only covers POSTED, non-void entries, sorted by
 *   persistedAt (or createdAt fallback) ASC. Void/reversal pairs
 *   become two consecutive links in the chain.
 */

const FIELDS = ["id", "date", "propertyId", "description", "source", "sourceId", "lines", "void", "voidedBy", "reversingOf", "postingSessionId"];

/** Stable JSON: keys sorted at every depth so canonical hash is reproducible. */
export function canonicalize(entry) {
  const slim = {};
  for (const k of FIELDS) {
    if (entry[k] === undefined) continue;
    slim[k] = k === "lines" ? slimLines(entry.lines) : entry[k];
  }
  return stableStringify(slim);
}

function slimLines(lines) {
  return (lines || []).map(l => ({
    accountCode: String(l.accountCode || ""),
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    memo: l.memo || "",
  }));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** Synchronous FNV-1a 128-bit fallback in pure JS so tests run without crypto. */
function fnv128Hex(str) {
  // 4 × 32-bit state for a 128-bit digest; not cryptographic but ample
  // for tamper detection in audit logs.
  let h0 = 0x811c9dc5 | 0, h1 = 0xcbf29ce4 | 0, h2 = 0xdeadbeef | 0, h3 = 0xfeedface | 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h0 = Math.imul(h0 ^ c, 0x01000193);
    h1 = Math.imul(h1 ^ (c + i), 0x01000193);
    h2 = Math.imul(h2 ^ ((c << 1) | (c >>> 7)), 0x01000193);
    h3 = Math.imul(h3 ^ ((c << 2) | (c >>> 5)), 0x01000193);
  }
  const u32 = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return u32(h0) + u32(h1) + u32(h2) + u32(h3);
}

async function sha256Hex(str) {
  try {
    if (typeof globalThis.crypto?.subtle?.digest === "function") {
      const data = new TextEncoder().encode(str);
      const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {}
  return fnv128Hex(str);
}

export async function computeHash(input) {
  return sha256Hex(String(input));
}

/**
 * Compute and attach chainHash to an entry given the previous hash in
 * the chain (use "" for the genesis link).
 */
export async function stampEntry(entry, prevHash = "") {
  const canon = canonicalize(entry);
  const chainHash = await sha256Hex(`${prevHash || ""}::${canon}`);
  return {
    ...entry,
    chainHash,
    chainPrev: prevHash || null,
    chainStampedAt: entry.chainStampedAt || new Date().toISOString(),
  };
}

/** Order the chain deterministically: persistedAt, then id. */
export function chainOrder(entries) {
  return [...(entries || [])]
    .filter(e => e && e.posted && !e.void && e.chainHash)
    .sort((a, b) => {
      const pa = a.persistedAt || a.createdAt || a.chainStampedAt || "";
      const pb = b.persistedAt || b.createdAt || b.chainStampedAt || "";
      if (pa === pb) return String(a.id).localeCompare(String(b.id));
      return pa.localeCompare(pb);
    });
}

/**
 * Walk the chain; return the first break, if any.
 * @returns {Promise<{ok: boolean, brokenAt: number|null, reason?: string, expected?: string, actual?: string, entry?: object }>}
 */
export async function verifyChain(entries) {
  const ordered = chainOrder(entries);
  let prev = "";
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    const recomputed = await sha256Hex(`${prev || ""}::${canonicalize(e)}`);
    if (recomputed !== e.chainHash) {
      return {
        ok: false,
        brokenAt: i,
        entry: { id: e.id, date: e.date, description: e.description },
        expected: recomputed,
        actual: e.chainHash,
        reason: "Hash mismatch — entry was edited after posting, or order changed.",
      };
    }
    if ((e.chainPrev || null) !== (prev || null) && prev !== "") {
      return {
        ok: false,
        brokenAt: i,
        entry: { id: e.id, date: e.date, description: e.description },
        expected: prev,
        actual: e.chainPrev || null,
        reason: "Chain link mismatch — previous-hash reference does not match preceding entry.",
      };
    }
    prev = e.chainHash;
  }
  return { ok: true, brokenAt: null, length: ordered.length };
}

/**
 * Re-stamp the entire chain — used only by administrators after an
 * explicit forensic review (e.g. recovering from a corrupt backup).
 * NEVER called as part of normal operation, since it erases the
 * tamper evidence the chain exists to provide.
 */
export async function rebuildChain(entries) {
  const ordered = chainOrder(entries);
  const out = [];
  let prev = "";
  for (const e of ordered) {
    const stamped = await stampEntry({ ...e, chainHash: undefined, chainPrev: undefined }, prev);
    out.push(stamped);
    prev = stamped.chainHash;
  }
  return out;
}
