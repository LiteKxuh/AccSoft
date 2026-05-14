/* HotelOps · money primitives
 * =================================================================
 * Integer cents internally to eliminate float drift. All ledger
 * postings, balance checks, and financial rollups should round-trip
 * through these helpers.
 *
 *   toCents(1.005)   -> 101 (half-away-from-zero)
 *   toCents("$1,234.56") -> 123456
 *   sumCents([1.10, 2.20, 3.30]) -> 660
 *   fromCents(123456) -> 1234.56
 *   addMoney(1.10, 2.20) -> 3.30   (no 3.3000000000000003)
 *   eqMoney(a, b)    -> within $0.005 (half-cent)
 *   fmtMoney(n)      -> "$1,234.56"
 */

export const MAX_CENTS = Number.MAX_SAFE_INTEGER; // 9.0e15 ≈ $90 trillion

export function toCents(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0;
    // EPSILON nudge defeats IEEE-754 traps like (1.005 * 100) === 100.49999999...
    const sign = v < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(v) * 100 + Number.EPSILON * 100);
  }
  if (typeof v === "string") {
    let s = v.replace(/[\s,$_]/g, "");
    // Accounting parens = negative: (50.00) -> -50.00
    const parenNeg = /^\(.*\)$/.test(s);
    if (parenNeg) s = "-" + s.slice(1, -1);
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return toCents(n);
  }
  return 0;
}

export function fromCents(c) {
  if (!Number.isFinite(c)) return 0;
  return Math.round(c) / 100;
}

export function sumCents(values) {
  let total = 0;
  for (const v of values || []) total += toCents(v);
  return total;
}

export function addMoney(...nums) {
  return fromCents(nums.reduce((s, n) => s + toCents(n), 0));
}

export function subMoney(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

/** Multiply a money amount by a unitless factor (rate, occupancy %, etc.) safely. */
export function mulMoney(amount, factor) {
  if (!Number.isFinite(factor)) return 0;
  return fromCents(Math.round(toCents(amount) * factor));
}

/** Equal within a half-cent. Use for balance assertions; floats won't bite. */
export function eqMoney(a, b) {
  return toCents(a) === toCents(b);
}

/** Allocate a total across n parts, distributing remainder cents to the first parts so the sum is exact. */
export function allocateCents(totalCents, n) {
  if (n <= 0) return [];
  const base = Math.trunc(totalCents / n);
  const rem = totalCents - base * n;
  const out = Array(n).fill(base);
  const sign = rem >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(rem); i++) out[i] += sign;
  return out;
}

export function fmtMoney(n) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function fmtMoneyShort(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return fmtMoney(v);
}

export function fmtPct(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtVar(v, digits = 1) {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${(Math.abs(v) * 100).toFixed(digits)}%`;
}

/** Operational realism guardrails — flag impossible values before they hit the books. */
export const REALISM_LIMITS = {
  maxAdr: 100_000,       // luxury cap; flag entries beyond this
  maxOccupancy: 1.05,    // accommodate sold-out + walk-in same-day
  minOccupancy: -0.01,
  maxLaborPctRev: 1.5,   // labor > 150% of revenue = clearly broken or seasonal closure
};

/** Returns { ok, warnings } — warnings are non-fatal but should appear in audit log. */
export function validateRevenueRealism({ roomsSold, roomsAvailable, roomRevenue, totalRevenue, laborCost }) {
  const warnings = [];
  if (roomsAvailable > 0 && roomsSold > roomsAvailable * REALISM_LIMITS.maxOccupancy) {
    warnings.push(`Occupancy ${(roomsSold / roomsAvailable * 100).toFixed(1)}% exceeds 105% cap — verify rooms-sold vs rooms-available.`);
  }
  if (roomsSold > 0 && roomRevenue > 0) {
    const adr = roomRevenue / roomsSold;
    if (adr > REALISM_LIMITS.maxAdr) {
      warnings.push(`ADR ${fmtMoney(adr)} is implausibly high — check rooms-sold count.`);
    }
    if (adr < 0) warnings.push(`Negative ADR — room revenue should not be negative without an offsetting credit memo.`);
  }
  if (laborCost && totalRevenue > 0 && laborCost / totalRevenue > REALISM_LIMITS.maxLaborPctRev) {
    warnings.push(`Labor ${fmtPct(laborCost / totalRevenue)} of revenue — verify shift entries; this exceeds the 150% realism cap.`);
  }
  return { ok: warnings.length === 0, warnings };
}
