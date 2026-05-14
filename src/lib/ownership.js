/* HotelOps · Ownership & entity hierarchy
 * =================================================================
 * Real hotel companies have several legal layers stacked on top of
 * each property:
 *
 *   ownerEntity (LLC, JV, fund) ─┐
 *                                ├── propertyOwnership (% interest)
 *   property ────────────────────┘
 *
 *   property ── managementAgreement ── managementCompany
 *
 *   property ── department/costCenter (cost rollup)
 *
 * Owner statements, management-fee accruals, and regional reporting
 * all flow off this hierarchy. Pure data — no UI, no I/O.
 *
 *   ownerEntity   { id, name, type: "owner"|"jv"|"fund"|"individual", contactEmail }
 *   mgmtCompany   { id, name, taxId, address, defaultFeeStructure }
 *   propertyOwnership { propertyId, ownerEntityId, sharePct, effectiveFrom, effectiveTo? }
 *   managementAgreement {
 *     id, propertyId, mgmtCompanyId, effectiveFrom, effectiveTo?,
 *     baseFeePct,            // % of total revenue
 *     incentiveFeePct,       // % of NOI above hurdle
 *     incentiveHurdlePct,    // hurdle return on owner equity (e.g. 0.08)
 *     incentiveHurdleAmount, // optional fixed hurdle in dollars
 *     reserveContributionPct,// % of revenue swept to FF&E reserve
 *   }
 *   costCenter { id, name, type: "rooms"|"fb"|"ag"|"fixed"|"capex", parentId? }
 */

import { toCents, fromCents, mulMoney } from "./money.js";

/* ---------- builders ---------- */

let _ctr = 0;
function nid(prefix) {
  _ctr += 1;
  return `${prefix}_${Date.now().toString(36)}_${_ctr.toString(36)}`;
}

export function makeOwnerEntity({ name, type = "owner", contactEmail = null, address = null, taxId = null }) {
  if (!name) throw new Error("ownerEntity requires a name");
  return { id: nid("oe"), name, type, contactEmail, address, taxId, createdAt: new Date().toISOString() };
}

export function makeMgmtCompany({ name, taxId = null, address = null, defaultFeeStructure = null }) {
  if (!name) throw new Error("mgmtCompany requires a name");
  return { id: nid("mc"), name, taxId, address, defaultFeeStructure, createdAt: new Date().toISOString() };
}

export function makeOwnership({ propertyId, ownerEntityId, sharePct, effectiveFrom = null, effectiveTo = null }) {
  if (!propertyId || !ownerEntityId) throw new Error("ownership requires propertyId + ownerEntityId");
  if (!(sharePct >= 0 && sharePct <= 1)) throw new Error(`ownership.sharePct must be in [0,1]: got ${sharePct}`);
  return {
    id: nid("po"),
    propertyId,
    ownerEntityId,
    sharePct,
    effectiveFrom: effectiveFrom || new Date().toISOString().slice(0, 10),
    effectiveTo,
    createdAt: new Date().toISOString(),
  };
}

export function makeManagementAgreement({
  propertyId, mgmtCompanyId,
  effectiveFrom = null, effectiveTo = null,
  baseFeePct = 0.03,
  incentiveFeePct = 0,
  incentiveHurdlePct = 0,
  incentiveHurdleAmount = 0,
  reserveContributionPct = 0.04,
}) {
  if (!propertyId || !mgmtCompanyId) throw new Error("managementAgreement requires propertyId + mgmtCompanyId");
  if (!(baseFeePct >= 0 && baseFeePct <= 0.20)) {
    throw new Error(`baseFeePct ${baseFeePct} is outside the realistic range [0, 20%]`);
  }
  if (!(reserveContributionPct >= 0 && reserveContributionPct <= 0.10)) {
    throw new Error(`reserveContributionPct ${reserveContributionPct} is outside the realistic range [0, 10%]`);
  }
  return {
    id: nid("ma"),
    propertyId,
    mgmtCompanyId,
    effectiveFrom: effectiveFrom || new Date().toISOString().slice(0, 10),
    effectiveTo,
    baseFeePct,
    incentiveFeePct,
    incentiveHurdlePct,
    incentiveHurdleAmount,
    reserveContributionPct,
    createdAt: new Date().toISOString(),
  };
}

export function makeCostCenter({ name, type = "ag", parentId = null }) {
  if (!name) throw new Error("costCenter requires a name");
  return { id: nid("cc"), name, type, parentId, createdAt: new Date().toISOString() };
}

/* ---------- queries ---------- */

function inRange(date, from, to) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** Active ownership rows for a property at a date. Must sum to ~1.0 to be valid. */
export function ownershipAt(ownerships, propertyId, asOf) {
  const date = asOf || new Date().toISOString().slice(0, 10);
  return (ownerships || []).filter(o =>
    o.propertyId === propertyId
    && inRange(date, o.effectiveFrom, o.effectiveTo)
  );
}

/** Validate the cap-table for a property sums to 100% (within $0.01-equivalent slack). */
export function validateCapTable(ownerships, propertyId, asOf) {
  const rows = ownershipAt(ownerships, propertyId, asOf);
  const total = rows.reduce((s, r) => s + (r.sharePct || 0), 0);
  return {
    ok: rows.length > 0 && Math.abs(total - 1) < 0.0005,
    totalShare: total,
    rowCount: rows.length,
    diff: total - 1,
  };
}

/** Active mgmt agreement for a property at a date. */
export function managementAgreementAt(agreements, propertyId, asOf) {
  const date = asOf || new Date().toISOString().slice(0, 10);
  return (agreements || []).find(a =>
    a.propertyId === propertyId
    && inRange(date, a.effectiveFrom, a.effectiveTo)
  ) || null;
}

/* ---------- fee math ---------- */

/**
 * Compute management fees + reserves + NOI for a property × period.
 *
 *   baseFee     = revenue × baseFeePct
 *   reserve     = revenue × reserveContributionPct
 *   incentive   = max(0, (noi - hurdle)) × incentiveFeePct
 *
 *   ownerNet    = noi - baseFee - reserve - incentiveFee
 *
 * @param {object} input
 * @param {number} input.revenue   total operating revenue for the period
 * @param {number} input.expenses  total operating expenses (excl. management fees)
 * @param {number} input.equity    owner equity invested (for hurdle %)
 * @param {object} input.agreement  management agreement
 */
export function computeManagementFees({ revenue, expenses, equity = 0, agreement }) {
  if (!agreement) {
    return {
      noi: revenue - expenses,
      baseFee: 0, incentiveFee: 0, reserve: 0,
      ownerNet: revenue - expenses,
      hurdle: 0,
      notes: ["No active management agreement"],
    };
  }
  const noiBeforeFees = revenue - expenses;
  const baseFee = mulMoney(revenue, agreement.baseFeePct || 0);
  const reserve = mulMoney(revenue, agreement.reserveContributionPct || 0);
  // Hurdle: max of % of equity and fixed dollar floor
  const hurdlePct = (agreement.incentiveHurdlePct || 0) * (equity || 0);
  const hurdle = Math.max(hurdlePct, agreement.incentiveHurdleAmount || 0);
  // Incentive accrues only on NOI above hurdle, after base fee but before reserve
  const noiAfterBase = noiBeforeFees - baseFee;
  const incentiveBase = Math.max(0, noiAfterBase - hurdle);
  const incentiveFee = mulMoney(incentiveBase, agreement.incentiveFeePct || 0);
  const ownerNet = noiBeforeFees - baseFee - incentiveFee - reserve;
  return {
    revenue,
    expenses,
    noi: noiBeforeFees,
    baseFee,
    incentiveFee,
    reserve,
    hurdle,
    ownerNet,
  };
}

/**
 * Split ownerNet across the cap-table.
 * Returns one row per active owner with their share of distributable cash.
 */
export function distributeToOwners({ ownerNet, ownerships, propertyId, asOf, ownerEntities = [] }) {
  const active = ownershipAt(ownerships, propertyId, asOf);
  const totalShare = active.reduce((s, r) => s + (r.sharePct || 0), 0) || 1;
  const totalCents = toCents(ownerNet);
  // Walk rows building distributions; last row absorbs any rounding remainder
  let remaining = totalCents;
  return active.map((row, i) => {
    let shareCents;
    if (i === active.length - 1) {
      shareCents = remaining;
    } else {
      shareCents = Math.round(totalCents * (row.sharePct / totalShare));
      remaining -= shareCents;
    }
    const entity = ownerEntities.find(e => e.id === row.ownerEntityId);
    return {
      ownerEntityId: row.ownerEntityId,
      ownerName: entity?.name || row.ownerEntityId,
      sharePct: row.sharePct,
      amount: fromCents(shareCents),
    };
  });
}
