/* HotelOps · Owner statement generator
 * =================================================================
 * Produces a monthly Owner Statement combining:
 *   - departmental P&L (NOI)
 *   - management fee accruals (base + incentive)
 *   - reserve contributions (FF&E)
 *   - distributable cash to each owner per cap table
 *
 * No data is faked. If ownership / mgmt-agreement records are missing
 * for a date, the statement says so rather than imputing values.
 */

import { buildDepartmentPnl } from "./departmentPnl.js";
import {
  ownershipAt, managementAgreementAt, computeManagementFees, distributeToOwners,
  validateCapTable,
} from "./ownership.js";

export function buildOwnerStatement({
  ledger, state, propertyId, month, chart,
}) {
  if (!propertyId || !month) {
    throw new Error("ownerStatement: propertyId and month are required");
  }
  const start = `${month}-01`;
  const [yy, mm] = month.split("-").map(Number);
  const end = `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;

  const pnl = buildDepartmentPnl({ ledger, start, end, propertyId, chart });
  const revenue = pnl.totals.revenue.total;
  const expensesExFees = pnl.totals.departmentalExpense.total
    + pnl.totals.undistributed.total
    + pnl.totals.fixed;

  const agreement = managementAgreementAt(state.managementAgreements || [], propertyId, end);
  const property = (state.properties || []).find(p => p.id === propertyId);
  const equity = Number(property?.ownerEquity) || 0;
  const fees = computeManagementFees({
    revenue,
    expenses: expensesExFees,
    equity,
    agreement,
  });

  const ownershipValidation = validateCapTable(state.ownerships || [], propertyId, end);
  let distributions = [];
  let unallocated = 0;
  if (ownershipValidation.ok) {
    distributions = distributeToOwners({
      ownerNet: fees.ownerNet,
      ownerships: state.ownerships || [],
      propertyId,
      asOf: end,
      ownerEntities: state.ownerEntities || [],
    });
  } else {
    unallocated = fees.ownerNet;
  }

  return {
    propertyId,
    propertyName: property?.name || propertyId,
    month,
    period: { start, end },
    pnl: pnl.totals,
    pnlRealism: pnl.realism,
    fees,
    agreement: agreement ? {
      mgmtCompanyId: agreement.mgmtCompanyId,
      baseFeePct: agreement.baseFeePct,
      incentiveFeePct: agreement.incentiveFeePct,
      incentiveHurdlePct: agreement.incentiveHurdlePct,
      reserveContributionPct: agreement.reserveContributionPct,
    } : null,
    capTable: {
      ok: ownershipValidation.ok,
      total: ownershipValidation.totalShare,
      diff: ownershipValidation.diff,
      issue: ownershipValidation.ok
        ? null
        : `Ownership totals to ${(ownershipValidation.totalShare * 100).toFixed(2)}% (off by ${(ownershipValidation.diff * 100).toFixed(2)}%)`,
    },
    distributions,
    unallocated,
    generatedAt: new Date().toISOString(),
  };
}

/** Build statements for many properties at once, e.g. portfolio close. */
export function buildPortfolioOwnerStatements({ ledger, state, propertyIds, month, chart }) {
  return (propertyIds || []).map(pid => buildOwnerStatement({ ledger, state, propertyId: pid, month, chart }));
}
