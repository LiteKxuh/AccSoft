/* HotelOps · Management fee report
 * =================================================================
 * Monthly management fee accrual statement, GL-postable. Wraps
 * computeManagementFees() from ownership.js and shapes it for both
 * external presentation (owner-facing) and internal accrual posting
 * (a draft JE that books base/incentive/reserve to liabilities).
 */

import { buildDepartmentPnl } from "./departmentPnl.js";
import { managementAgreementAt, computeManagementFees } from "./ownership.js";
import { toCents, fromCents, mulMoney } from "./money.js";

export function buildManagementFeeReport({ ledger, state, propertyId, month, chart }) {
  if (!propertyId || !month) throw new Error("management fee report: propertyId + month required");
  const [yy, mm] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
  const pnl = buildDepartmentPnl({ ledger, start, end, propertyId, chart });
  const property = (state.properties || []).find(p => p.id === propertyId);
  const agreement = managementAgreementAt(state.managementAgreements || [], propertyId, end);
  const mgmtCo = (state.managementCompanies || []).find(c => c.id === agreement?.mgmtCompanyId);
  const equity = Number(property?.ownerEquity) || 0;
  const revenue = pnl.totals.revenue.total;
  const expensesExFees = pnl.totals.departmentalExpense.total + pnl.totals.undistributed.total + pnl.totals.fixed;
  const fees = computeManagementFees({ revenue, expenses: expensesExFees, equity, agreement });

  // Draft JE that, when posted, accrues the fees into A/P and the reserve into a liability.
  const draftJournal = agreement && fees.ownerNet !== 0 ? {
    id: `mgmtfee_${propertyId}_${month}`,
    date: end,
    propertyId,
    description: `Management fees accrual · ${month} · ${mgmtCo?.name || "Mgmt Co"}`,
    source: "auto-from-mgmt-fee",
    sourceId: `${propertyId}::${month}`,
    posted: false,
    lines: buildAccrualLines(fees),
  } : null;

  return {
    propertyId,
    propertyName: property?.name || propertyId,
    month,
    period: { start, end },
    mgmtCompany: mgmtCo ? { id: mgmtCo.id, name: mgmtCo.name } : null,
    agreement: agreement ? {
      baseFeePct: agreement.baseFeePct,
      incentiveFeePct: agreement.incentiveFeePct,
      incentiveHurdlePct: agreement.incentiveHurdlePct,
      reserveContributionPct: agreement.reserveContributionPct,
    } : null,
    revenue,
    expensesExFees,
    fees,
    draftJournal,
    breakdown: [
      { label: "Total operating revenue", amount: revenue },
      { label: `Base management fee (${agreement ? (agreement.baseFeePct * 100).toFixed(2) : "0.00"}% of revenue)`, amount: fees.baseFee },
      { label: `Incentive fee (above ${(agreement?.incentiveHurdlePct || 0) * 100}% hurdle)`, amount: fees.incentiveFee },
      { label: `FF&E reserve (${agreement ? (agreement.reserveContributionPct * 100).toFixed(2) : "0.00"}% of revenue)`, amount: fees.reserve },
      { label: "NOI before fees", amount: fees.noi },
      { label: "Distributable to owner", amount: fees.ownerNet },
    ],
  };
}

function buildAccrualLines(fees) {
  const lines = [];
  // Dr Management fee expense (use a generic A&G expense account if no dedicated code)
  if (fees.baseFee > 0) {
    lines.push({ accountCode: "6400", debit: fees.baseFee, credit: 0, memo: "Management fee — base" });
  }
  if (fees.incentiveFee > 0) {
    lines.push({ accountCode: "6400", debit: fees.incentiveFee, credit: 0, memo: "Management fee — incentive" });
  }
  // Cr A/P for the mgmt company
  const totalFee = fromCents(toCents(fees.baseFee) + toCents(fees.incentiveFee));
  if (totalFee > 0) {
    lines.push({ accountCode: "2010", debit: 0, credit: totalFee, memo: "A/P — Mgmt Co" });
  }
  // Dr Reserve expense / Cr Reserve liability (use 6400 / 2400 approximations)
  if (fees.reserve > 0) {
    lines.push({ accountCode: "6400", debit: fees.reserve, credit: 0, memo: "FF&E reserve contribution" });
    lines.push({ accountCode: "2400", debit: 0, credit: fees.reserve, memo: "FF&E reserve liability" });
  }
  return lines;
}
