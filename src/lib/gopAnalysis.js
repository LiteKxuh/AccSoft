/* HotelOps · GOP analysis
 * =================================================================
 * GOP (Gross Operating Profit) variance against budget, broken down
 * by department and revenue driver. Mirrors how an asset manager
 * reads the books — "is the GOP miss a revenue problem or a cost
 * problem, and in which department?"
 *
 *   buildGopAnalysis({ pnl, budget }) -> structured analysis
 *
 * pnl  = output of buildDepartmentPnl()
 * budget = monthly budget object (see budget.js)
 */

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function pctOf(part, total) { return total > 0 ? part / total : null; }

export function buildGopAnalysis({ pnl, budget = null, priorYearPnl = null }) {
  if (!pnl) return { status: "missing-pnl" };
  const totals = pnl.totals;
  const actual = {
    revenue: totals.revenue.total,
    rooms: totals.revenue.rooms,
    fb: totals.revenue.fb,
    other: totals.revenue.other,
    deptlExpense: totals.departmentalExpense.total,
    deptlExpenseRooms: totals.departmentalExpense.rooms,
    deptlExpenseFb: totals.departmentalExpense.fb,
    undist: totals.undistributed.total,
    fixed: totals.fixed,
    gop: totals.gop,
    gopPct: totals.gopPct,
    noi: totals.noi,
    noiPct: totals.noiPct,
  };

  const variance = (a, b) => {
    if (b == null) return null;
    return { abs: a - b, pct: b !== 0 ? (a - b) / Math.abs(b) : null };
  };

  let budgetCmp = null;
  if (budget) {
    const budgetRev = safe(budget.rooms?.revenue) + safe(budget.fb?.restaurant) + safe(budget.fb?.bar) + safe(budget.fb?.banquet)
      + safe(budget.other?.parking) + safe(budget.other?.spa) + safe(budget.other?.telephone) + safe(budget.other?.misc);
    const budgetGopPct = safe(budget.expectedGopMargin) || 0.30;
    const budgetGop = budgetRev * budgetGopPct;
    budgetCmp = {
      revenue: variance(actual.revenue, budgetRev),
      gop: variance(actual.gop, budgetGop),
      gopMargin: variance(actual.gopPct, budgetGopPct),
    };
  }

  let pyCmp = null;
  if (priorYearPnl && priorYearPnl.totals) {
    pyCmp = {
      revenue: variance(actual.revenue, priorYearPnl.totals.revenue.total),
      gop: variance(actual.gop, priorYearPnl.totals.gop),
      gopMargin: variance(actual.gopPct, priorYearPnl.totals.gopPct),
    };
  }

  // Driver decomposition: how much of the GOP variance came from revenue vs cost?
  const driverDecomposition = budgetCmp ? buildDecomposition(actual, budgetCmp) : null;

  // Department deep-dive
  const deptl = [
    {
      department: "Rooms",
      revenue: actual.rooms,
      expense: actual.deptlExpenseRooms,
      profit: actual.rooms - actual.deptlExpenseRooms,
      margin: pctOf(actual.rooms - actual.deptlExpenseRooms, actual.rooms),
    },
    {
      department: "F&B",
      revenue: actual.fb,
      expense: actual.deptlExpenseFb,
      profit: actual.fb - actual.deptlExpenseFb,
      margin: pctOf(actual.fb - actual.deptlExpenseFb, actual.fb),
    },
    {
      department: "Other Operated",
      revenue: actual.other,
      expense: 0,
      profit: actual.other,
      margin: actual.other > 0 ? 1.0 : null,
    },
  ];

  return {
    status: "ok",
    actual,
    budget: budgetCmp,
    priorYear: pyCmp,
    driverDecomposition,
    departments: deptl,
    diagnostic: diagnoseGop(actual, budgetCmp, deptl),
  };
}

function buildDecomposition(actual, budgetCmp) {
  if (!budgetCmp?.revenue || !budgetCmp?.gop) return null;
  const revVar = budgetCmp.revenue.abs;
  const gopVar = budgetCmp.gop.abs;
  // GOP variance = revenue variance × budget GOP margin + flow-through variance
  // We treat the rest as cost-driver variance.
  // (Simple decomposition; not a full price/mix/volume analysis.)
  const revContribution = revVar * (1 - (actual.deptlExpense + actual.undist) / Math.max(1, actual.revenue));
  const costContribution = gopVar - revContribution;
  return {
    gopVariance: gopVar,
    fromRevenue: revContribution,
    fromCosts: costContribution,
    revenueShare: gopVar !== 0 ? revContribution / gopVar : null,
    costShare: gopVar !== 0 ? costContribution / gopVar : null,
  };
}

function diagnoseGop(actual, budgetCmp, departments) {
  const notes = [];
  if (budgetCmp && budgetCmp.gop && budgetCmp.gop.abs < 0) {
    notes.push("GOP is below budget.");
    if (budgetCmp.revenue && budgetCmp.revenue.abs < 0) {
      notes.push("Revenue shortfall is contributing.");
    }
    if (actual.gopPct < 0.20) {
      notes.push(`GOP margin ${(actual.gopPct * 100).toFixed(1)}% is below the typical 25-40% band — review department cost coding.`);
    }
  }
  const fbDept = departments.find(d => d.department === "F&B");
  if (fbDept && fbDept.revenue > 0 && fbDept.margin != null && fbDept.margin < 0.20) {
    notes.push(`F&B departmental margin ${(fbDept.margin * 100).toFixed(1)}% is below the 25-35% benchmark.`);
  }
  return notes;
}
