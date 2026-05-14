/* HotelOps · Workforce — pay periods + pay groups
 * =================================================================
 * Hotel companies typically run weekly or biweekly hourly payroll
 * and semimonthly or monthly salaried payroll, often on different
 * pay groups.
 *
 * Public API:
 *   makePayGroup({ id, name, frequency, anchorDate, payClass })
 *   periodFor(payGroup, asOf)                  → { start, end, payDate, isCurrent, isLocked }
 *   listPeriods(payGroup, { start, end })      → [periods] in window
 *   isLocked(period, lockedPeriods)            → boolean
 *   nextPayDate(payGroup, asOf)
 *
 * Frequencies: "weekly" | "biweekly" | "semimonthly" | "monthly"
 *
 * Anchor date convention:
 *   - weekly / biweekly: anchorDate = a known period START date
 *   - semimonthly: paid on the 15th and last day of month
 *   - monthly: paid on the last day of month
 */

export const FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"];

export function makePayGroup({ id, name, frequency, anchorDate, payClass = "hourly", payDelayDays = 5 } = {}) {
  if (!id) throw new Error("payGroup: id required");
  if (!FREQUENCIES.includes(frequency)) throw new Error(`payGroup: unknown frequency "${frequency}"`);
  if ((frequency === "weekly" || frequency === "biweekly") && !anchorDate) {
    throw new Error("payGroup: weekly / biweekly require anchorDate");
  }
  return {
    id, name: name || id, frequency,
    anchorDate, payClass, payDelayDays,
    createdAt: new Date().toISOString(),
  };
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.floor((new Date(a) - new Date(b)) / 86400000); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/** Returns { start, end, payDate, isCurrent } for the period containing asOf. */
export function periodFor(payGroup, asOf) {
  if (!payGroup) return null;
  const today = asOf ? new Date(asOf) : new Date();
  let start, end;
  if (payGroup.frequency === "weekly") {
    const anchor = new Date(payGroup.anchorDate);
    const diff = daysBetween(today, anchor);
    const periodIdx = Math.floor(diff / 7);
    start = addDays(anchor, periodIdx * 7);
    end = addDays(start, 6);
  } else if (payGroup.frequency === "biweekly") {
    const anchor = new Date(payGroup.anchorDate);
    const diff = daysBetween(today, anchor);
    const periodIdx = Math.floor(diff / 14);
    start = addDays(anchor, periodIdx * 14);
    end = addDays(start, 13);
  } else if (payGroup.frequency === "semimonthly") {
    const y = today.getUTCFullYear(), m = today.getUTCMonth();
    if (today.getUTCDate() <= 15) {
      start = new Date(Date.UTC(y, m, 1));
      end = new Date(Date.UTC(y, m, 15));
    } else {
      start = new Date(Date.UTC(y, m, 16));
      end = new Date(Date.UTC(y, m + 1, 0));
    }
  } else {
    // monthly
    const y = today.getUTCFullYear(), m = today.getUTCMonth();
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 0));
  }
  const payDate = addDays(end, payGroup.payDelayDays || 0);
  const isCurrent = today >= start && today <= end;
  return {
    payGroupId: payGroup.id,
    start: isoDate(start),
    end: isoDate(end),
    payDate: isoDate(payDate),
    isCurrent,
  };
}

export function listPeriods(payGroup, { start, end }) {
  if (!payGroup) return [];
  const out = [];
  let cursor = new Date(start);
  const stop = new Date(end);
  let safety = 0;
  while (cursor <= stop && safety < 500) {
    const period = periodFor(payGroup, isoDate(cursor));
    if (!period || out.some(p => p.start === period.start)) break;
    out.push(period);
    cursor = addDays(new Date(period.end), 1);
    safety += 1;
  }
  return out;
}

export function nextPayDate(payGroup, asOf) {
  const current = periodFor(payGroup, asOf);
  if (!current) return null;
  return current.payDate;
}

/** A "locked" period has already been paid out — no edits allowed. */
export function isLocked(period, lockedPeriods = []) {
  if (!period) return false;
  return lockedPeriods.some(lp =>
    lp.payGroupId === period.payGroupId && lp.start === period.start
  );
}

export function lockPeriod(state, period, user) {
  return {
    ...state,
    lockedPayPeriods: [
      ...(state.lockedPayPeriods || []),
      {
        payGroupId: period.payGroupId,
        start: period.start,
        end: period.end,
        lockedAt: new Date().toISOString(),
        lockedBy: user?.id || null,
      },
    ],
  };
}
