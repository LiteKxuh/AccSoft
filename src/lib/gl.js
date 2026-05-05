/* HotelOps · General Ledger engine
 * =================================================================
 * True double-entry accounting on top of HotelOps' existing
 * report / invoice / payroll data.
 *
 * Public API:
 *   DEFAULT_CHART             — USALI-aligned chart of accounts
 *   buildLedger({ ... })      — produces a unified list of every posted
 *                                journal line (auto + manual)
 *   trialBalance(ledger, asOf, propertyId?) -> [{ account, debit, credit, balance }]
 *   balanceSheet(ledger, asOf, propertyId?) -> { assets, liabilities, equity }
 *   cashFlow(ledger, period, propertyId?)   -> { operating, investing, financing, net }
 *   accountActivity(ledger, accountId, range) -> [lines]
 *
 * Convention:
 *   Asset / Expense → debit increases  (normal balance: debit)
 *   Liability / Equity / Revenue → credit increases (normal balance: credit)
 */

/* ---------- Default Chart of Accounts ---------- */

export const DEFAULT_CHART = [
  // ========== ASSETS (1xxx) ==========
  { id: "1010", code: "1010", name: "Cash on Hand",                    type: "asset",     subtype: "current-asset", normal: "debit" },
  { id: "1020", code: "1020", name: "Operating Checking",              type: "asset",     subtype: "current-asset", normal: "debit", isBank: true },
  { id: "1030", code: "1030", name: "Payroll Checking",                type: "asset",     subtype: "current-asset", normal: "debit", isBank: true },
  { id: "1040", code: "1040", name: "Reserve / Money Market",          type: "asset",     subtype: "current-asset", normal: "debit", isBank: true },
  { id: "1100", code: "1100", name: "Accounts Receivable",             type: "asset",     subtype: "current-asset", normal: "debit", isAR: true },
  { id: "1110", code: "1110", name: "City Ledger (Direct Bill)",       type: "asset",     subtype: "current-asset", normal: "debit", isAR: true },
  { id: "1120", code: "1120", name: "Credit Card Receivable",          type: "asset",     subtype: "current-asset", normal: "debit" },
  { id: "1200", code: "1200", name: "Inventory · F&B",                 type: "asset",     subtype: "current-asset", normal: "debit" },
  { id: "1210", code: "1210", name: "Inventory · Operating Supplies",  type: "asset",     subtype: "current-asset", normal: "debit" },
  { id: "1300", code: "1300", name: "Prepaid Expenses",                type: "asset",     subtype: "current-asset", normal: "debit" },
  { id: "1500", code: "1500", name: "Land",                            type: "asset",     subtype: "fixed-asset",   normal: "debit" },
  { id: "1510", code: "1510", name: "Buildings",                       type: "asset",     subtype: "fixed-asset",   normal: "debit" },
  { id: "1520", code: "1520", name: "Furniture, Fixtures & Equipment", type: "asset",     subtype: "fixed-asset",   normal: "debit" },
  { id: "1590", code: "1590", name: "Accumulated Depreciation",        type: "asset",     subtype: "fixed-asset",   normal: "credit", contra: true },

  // ========== LIABILITIES (2xxx) ==========
  { id: "2010", code: "2010", name: "Accounts Payable",                type: "liability", subtype: "current-liability", normal: "credit", isAP: true },
  { id: "2020", code: "2020", name: "Accrued Wages",                   type: "liability", subtype: "current-liability", normal: "credit" },
  { id: "2030", code: "2030", name: "Payroll Tax Payable",             type: "liability", subtype: "current-liability", normal: "credit" },
  { id: "2210", code: "2210", name: "Occupancy Tax Payable",           type: "liability", subtype: "current-liability", normal: "credit" },
  { id: "2220", code: "2220", name: "Sales Tax Payable",               type: "liability", subtype: "current-liability", normal: "credit" },
  { id: "2230", code: "2230", name: "Tourism Tax Payable",             type: "liability", subtype: "current-liability", normal: "credit" },
  { id: "2400", code: "2400", name: "Advance Deposits / Unearned",     type: "liability", subtype: "current-liability", normal: "credit" },
  { id: "2500", code: "2500", name: "Long-Term Debt",                  type: "liability", subtype: "long-term-liability", normal: "credit" },

  // ========== EQUITY (3xxx) ==========
  { id: "3010", code: "3010", name: "Owner's Equity / Capital",        type: "equity",    subtype: "equity", normal: "credit" },
  { id: "3020", code: "3020", name: "Retained Earnings",               type: "equity",    subtype: "equity", normal: "credit" },
  { id: "3030", code: "3030", name: "Owner's Draws / Distributions",   type: "equity",    subtype: "equity", normal: "debit", contra: true },

  // ========== REVENUE (4xxx) ==========
  { id: "4110", code: "4110", name: "Transient Room Revenue",          type: "revenue",   subtype: "rooms",  normal: "credit", usaliPath: "revenue.rooms" },
  { id: "4120", code: "4120", name: "Group Room Revenue",              type: "revenue",   subtype: "rooms",  normal: "credit" },
  { id: "4210", code: "4210", name: "Restaurant Revenue",              type: "revenue",   subtype: "fb",     normal: "credit", usaliPath: "revenue.fb.restaurant" },
  { id: "4220", code: "4220", name: "Banquet Revenue",                 type: "revenue",   subtype: "fb",     normal: "credit", usaliPath: "revenue.fb.banquet" },
  { id: "4230", code: "4230", name: "Bar / Lounge Revenue",            type: "revenue",   subtype: "fb",     normal: "credit", usaliPath: "revenue.fb.bar" },
  { id: "4310", code: "4310", name: "Telephone Revenue",               type: "revenue",   subtype: "other",  normal: "credit", usaliPath: "revenue.other.telephone" },
  { id: "4320", code: "4320", name: "Parking Revenue",                 type: "revenue",   subtype: "other",  normal: "credit", usaliPath: "revenue.other.parking" },
  { id: "4330", code: "4330", name: "Spa / Wellness Revenue",          type: "revenue",   subtype: "other",  normal: "credit", usaliPath: "revenue.other.spa" },
  { id: "4340", code: "4340", name: "Misc / Sundry Revenue",           type: "revenue",   subtype: "other",  normal: "credit", usaliPath: "revenue.other.misc" },

  // ========== EXPENSES (5xxx-7xxx) ==========
  { id: "5010", code: "5010", name: "Wages & Salaries · Rooms",        type: "expense",   subtype: "rooms-expense",   normal: "debit" },
  { id: "5020", code: "5020", name: "Wages & Salaries · F&B",          type: "expense",   subtype: "fb-expense",      normal: "debit" },
  { id: "5030", code: "5030", name: "Wages & Salaries · A&G",          type: "expense",   subtype: "ag-expense",      normal: "debit" },
  { id: "5040", code: "5040", name: "Payroll Taxes Expense",           type: "expense",   subtype: "payroll-expense", normal: "debit" },
  { id: "5050", code: "5050", name: "Employee Benefits",               type: "expense",   subtype: "payroll-expense", normal: "debit" },
  { id: "5100", code: "5100", name: "Contractor / 1099 Payments",      type: "expense",   subtype: "ag-expense",      normal: "debit" },
  { id: "6010", code: "6010", name: "Cost of Food Sold",               type: "expense",   subtype: "fb-expense",      normal: "debit" },
  { id: "6020", code: "6020", name: "Cost of Beverage Sold",           type: "expense",   subtype: "fb-expense",      normal: "debit" },
  { id: "6100", code: "6100", name: "Operating Supplies",              type: "expense",   subtype: "rooms-expense",   normal: "debit" },
  { id: "6200", code: "6200", name: "Utilities",                       type: "expense",   subtype: "fixed-expense",   normal: "debit" },
  { id: "6210", code: "6210", name: "Repairs & Maintenance",           type: "expense",   subtype: "fixed-expense",   normal: "debit" },
  { id: "6220", code: "6220", name: "Insurance",                       type: "expense",   subtype: "fixed-expense",   normal: "debit" },
  { id: "6230", code: "6230", name: "Property Taxes",                  type: "expense",   subtype: "fixed-expense",   normal: "debit" },
  { id: "6300", code: "6300", name: "Marketing & Sales",               type: "expense",   subtype: "ag-expense",      normal: "debit" },
  { id: "6400", code: "6400", name: "Professional Fees",               type: "expense",   subtype: "ag-expense",      normal: "debit" },
  { id: "6500", code: "6500", name: "Office & Admin",                  type: "expense",   subtype: "ag-expense",      normal: "debit" },
  { id: "7010", code: "7010", name: "Depreciation Expense",            type: "expense",   subtype: "fixed-expense",   normal: "debit" },
  { id: "7020", code: "7020", name: "Interest Expense",                type: "expense",   subtype: "fixed-expense",   normal: "debit" },

  // ========== UNCATEGORIZED ==========
  { id: "9999", code: "9999", name: "Uncategorized",                   type: "expense",   subtype: "ag-expense",      normal: "debit" },
];

export const TYPE_LABELS = {
  asset:     "Assets",
  liability: "Liabilities",
  equity:    "Equity",
  revenue:   "Revenue",
  expense:   "Expenses",
};

export const SUBTYPE_LABELS = {
  "current-asset":         "Current Assets",
  "fixed-asset":           "Property, Plant & Equipment",
  "current-liability":     "Current Liabilities",
  "long-term-liability":   "Long-Term Liabilities",
  "equity":                "Equity",
  "rooms":                 "Rooms Revenue",
  "fb":                    "Food & Beverage",
  "other":                 "Other Operating",
  "rooms-expense":         "Rooms Expense",
  "fb-expense":            "F&B Expense",
  "ag-expense":            "Administrative & General",
  "payroll-expense":       "Payroll Costs",
  "fixed-expense":         "Fixed Charges",
};

/* ---------- Account lookup helpers ---------- */

export function findAccount(chart, idOrCode) {
  if (!idOrCode) return null;
  return chart.find(a => a.id === idOrCode || a.code === String(idOrCode)) || null;
}

export function bankAccounts(chart) {
  return chart.filter(a => a.isBank);
}

export function arAccounts(chart) {
  return chart.filter(a => a.isAR);
}

export function apAccount(chart) {
  return chart.find(a => a.isAP) || findAccount(chart, "2010");
}

/* ---------- Journal validation ---------- */

export function isBalanced(entry) {
  if (!entry?.lines?.length) return false;
  const debit = entry.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = entry.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return Math.abs(debit - credit) < 0.005 && debit > 0;
}

export function entryTotals(entry) {
  const debit = (entry?.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = (entry?.lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
}

/* ---------- Auto-derive journals from existing data ---------- */

/**
 * Convert a posted flash report into a balanced journal entry.
 * Debits cash/cc/AR for the settlement; credits revenue accounts and tax liabilities.
 */
function reportToJournal(report) {
  const b = report.breakdown || {};
  const lines = [];

  // ----- DEBIT side: settlements (where the money landed) -----
  const cash = b.payments?.cash || 0;
  const cc = b.payments?.creditCard || 0;
  const ar = b.payments?.directBill || 0;
  const other = b.payments?.other || 0;
  // If no settlement detail, assume everything settled to cash
  const totalSettlement = cash + cc + ar + other;
  const totalRev = (b.revenue?.rooms || 0)
    + (b.revenue?.fb?.restaurant || 0) + (b.revenue?.fb?.bar || 0) + (b.revenue?.fb?.banquet || 0)
    + (b.revenue?.other?.parking || 0) + (b.revenue?.other?.spa || 0) + (b.revenue?.other?.telephone || 0) + (b.revenue?.other?.misc || 0);
  const totalTax = (b.taxes?.occupancy || 0) + (b.taxes?.sales || 0) + (b.taxes?.tourism || 0);
  const totalDr = totalRev + totalTax;
  if (totalSettlement > 0) {
    if (cash > 0)  lines.push({ accountCode: "1010", debit: cash,  credit: 0, memo: "Cash settlement" });
    if (cc > 0)    lines.push({ accountCode: "1120", debit: cc,    credit: 0, memo: "Credit card settlement" });
    if (ar > 0)    lines.push({ accountCode: "1110", debit: ar,    credit: 0, memo: "City ledger / direct bill" });
    if (other > 0) lines.push({ accountCode: "1010", debit: other, credit: 0, memo: "Other payment" });
    // If settlement < revenue+tax, plug the rest to AR
    const gap = totalDr - totalSettlement;
    if (gap > 0.005) lines.push({ accountCode: "1110", debit: gap, credit: 0, memo: "AR plug (settlement gap)" });
  } else if (totalDr > 0) {
    // No settlement detail — debit cash for the full revenue+tax
    lines.push({ accountCode: "1010", debit: totalDr, credit: 0, memo: "Daily takings (settlement detail unknown)" });
  }

  // ----- CREDIT side: revenue and tax liability -----
  const credits = [
    ["4110", b.revenue?.rooms || 0,          "Room revenue"],
    ["4210", b.revenue?.fb?.restaurant || 0, "Restaurant"],
    ["4220", b.revenue?.fb?.banquet || 0,    "Banquet"],
    ["4230", b.revenue?.fb?.bar || 0,        "Bar"],
    ["4310", b.revenue?.other?.telephone || 0, "Telephone"],
    ["4320", b.revenue?.other?.parking || 0,   "Parking"],
    ["4330", b.revenue?.other?.spa || 0,       "Spa"],
    ["4340", b.revenue?.other?.misc || 0,      "Misc"],
    ["2210", b.taxes?.occupancy || 0,          "Occupancy tax accrued"],
    ["2220", b.taxes?.sales || 0,              "Sales tax accrued"],
    ["2230", b.taxes?.tourism || 0,            "Tourism tax accrued"],
  ];
  credits.forEach(([code, amt, memo]) => {
    if (amt > 0.005) lines.push({ accountCode: code, debit: 0, credit: amt, memo });
  });

  return {
    id: `auto-rpt-${report.id}`,
    date: report.date,
    propertyId: report.propertyId,
    description: `Daily revenue posting · ${report.date}`,
    source: "auto-from-report",
    sourceId: report.id,
    posted: true,
    lines,
  };
}

/**
 * Convert a posted/paid invoice into a journal entry.
 * Open invoice: Dr expense, Cr A/P
 * Paid invoice: Dr A/P, Cr Cash
 */
function invoiceToJournals(invoice, vendor) {
  const out = [];
  const expenseAccount = vendor?.glAccount || "9999";
  // Bill received: Dr expense, Cr A/P
  if (invoice.amount > 0) {
    out.push({
      id: `auto-inv-${invoice.id}`,
      date: invoice.issuedDate,
      propertyId: invoice.propertyId,
      description: `Bill · ${vendor?.name || "Vendor"} · ${invoice.invoiceNumber || ""}`.trim(),
      source: "auto-from-invoice",
      sourceId: invoice.id,
      posted: true,
      lines: [
        { accountCode: expenseAccount, debit: invoice.amount, credit: 0, memo: `${vendor?.name || ""} ${invoice.invoiceNumber || ""}`.trim() },
        { accountCode: "2010",         debit: 0, credit: invoice.amount, memo: `A/P · ${vendor?.name || ""}` },
      ],
    });
  }
  // Payment: Dr A/P, Cr Cash
  if (invoice.status === "paid" && invoice.paidDate && invoice.amount > 0) {
    out.push({
      id: `auto-invpay-${invoice.id}`,
      date: invoice.paidDate,
      propertyId: invoice.propertyId,
      description: `Payment · ${vendor?.name || "Vendor"} · ${invoice.invoiceNumber || ""}`.trim(),
      source: "auto-from-invoice-payment",
      sourceId: invoice.id,
      posted: true,
      lines: [
        { accountCode: "2010", debit: invoice.amount, credit: 0, memo: `A/P clear · ${vendor?.name || ""}` },
        { accountCode: "1020", debit: 0, credit: invoice.amount, memo: `Bank payment · ${vendor?.name || ""}` },
      ],
    });
  }
  return out;
}

/**
 * Convert a posted payroll run into a journal entry.
 * Dr Wages expense, Dr Payroll Tax expense, Cr Cash, Cr Tax payable.
 */
function payrollRunToJournal(run) {
  const lines = [];
  const totalGross = (run.lines || []).reduce((s, l) => s + (l.gross || 0), 0);
  const totalFedWh = (run.lines || []).reduce((s, l) => s + (l.fedWithheld || 0), 0);
  const totalStateWh = (run.lines || []).reduce((s, l) => s + (l.stateWithheld || 0), 0);
  const totalSS = (run.lines || []).reduce((s, l) => s + (l.ssTax || 0), 0);
  const totalMed = (run.lines || []).reduce((s, l) => s + (l.medicareTax || 0), 0);
  const totalNet = (run.lines || []).reduce((s, l) => s + (l.net || (l.gross - (l.fedWithheld||0) - (l.stateWithheld||0) - (l.ssTax||0) - (l.medicareTax||0))), 0);
  if (totalGross <= 0.005) return null;

  // Dr Wages expense (gross)
  lines.push({ accountCode: "5030", debit: totalGross, credit: 0, memo: `Wages · ${run.periodStart} – ${run.periodEnd}` });
  // Dr Payroll tax employer-side (estimated SS+Med matches)
  const employerMatch = totalSS + totalMed;
  if (employerMatch > 0) {
    lines.push({ accountCode: "5040", debit: employerMatch, credit: 0, memo: "Employer payroll tax match" });
  }
  // Cr Cash for net pay
  if (totalNet > 0) lines.push({ accountCode: "1030", debit: 0, credit: totalNet, memo: "Net pay disbursed" });
  // Cr Tax payable for withholdings + employer match
  const taxPayable = totalFedWh + totalStateWh + totalSS + totalMed + employerMatch;
  if (taxPayable > 0) {
    lines.push({ accountCode: "2030", debit: 0, credit: taxPayable, memo: "Payroll tax accrued" });
  }
  return {
    id: `auto-payroll-${run.id}`,
    date: run.runDate || run.periodEnd,
    propertyId: run.propertyId,
    description: `Payroll run · ${run.periodStart} – ${run.periodEnd}`,
    source: "auto-from-payroll",
    sourceId: run.id,
    posted: true,
    lines,
  };
}

function contractorPaymentToJournal(p, contractor) {
  return {
    id: `auto-cp-${p.id}`,
    date: p.date,
    propertyId: p.propertyId,
    description: `Contractor payment · ${contractor?.name || ""}`,
    source: "auto-from-contractor",
    sourceId: p.id,
    posted: true,
    lines: [
      { accountCode: "5100", debit: p.amount, credit: 0, memo: `${contractor?.name || ""} ${p.memo || ""}`.trim() },
      { accountCode: "1020", debit: 0, credit: p.amount, memo: "Cash disbursed" },
    ],
  };
}

/**
 * Build the unified ledger: every journal entry, both auto-derived and
 * user-entered, in one list with normalized line shape.
 *
 * @param {object} state
 * @returns {Array} ledger entries with .lines containing {accountCode, debit, credit, memo}
 */
export function buildLedger(state) {
  const out = [];
  // Auto: reports → daily revenue posting
  (state.reports || []).forEach((r) => {
    const j = reportToJournal(r);
    if (j.lines.length) out.push(j);
  });
  // Auto: invoices (bill + payment legs)
  (state.invoices || []).forEach((inv) => {
    const v = (state.vendors || []).find(x => x.id === inv.vendorId);
    invoiceToJournals(inv, v).forEach(j => out.push(j));
  });
  // Auto: payroll runs
  (state.payrollRuns || []).forEach((run) => {
    const j = payrollRunToJournal(run);
    if (j) out.push(j);
  });
  // Auto: contractor payments
  (state.contractorPayments || []).forEach((p) => {
    const c = (state.contractors || []).find(x => x.id === p.contractorId);
    out.push(contractorPaymentToJournal(p, c));
  });
  // Manual: user-entered journal entries
  (state.journalEntries || []).forEach((j) => {
    if (j.void) return;
    out.push({ ...j, source: j.source || "manual" });
  });
  return out;
}

/* ---------- Trial balance ---------- */

/**
 * @param {Array} ledger      from buildLedger()
 * @param {string} asOf       YYYY-MM-DD; entries with date <= asOf are included
 * @param {string} [propertyId]  optional filter to one property
 * @param {Array} chart       chart of accounts to merge against
 */
export function trialBalance(ledger, asOf, propertyId, chart = DEFAULT_CHART) {
  const balances = new Map(); // accountCode -> { debit, credit }
  ledger.forEach((entry) => {
    if (!entry.posted) return;
    if (asOf && entry.date > asOf) return;
    if (propertyId && entry.propertyId && entry.propertyId !== propertyId) return;
    (entry.lines || []).forEach((l) => {
      const k = String(l.accountCode || l.accountId || "9999");
      const cur = balances.get(k) || { debit: 0, credit: 0 };
      cur.debit += Number(l.debit) || 0;
      cur.credit += Number(l.credit) || 0;
      balances.set(k, cur);
    });
  });
  const rows = chart.map((a) => {
    const cur = balances.get(a.code) || { debit: 0, credit: 0 };
    const net = cur.debit - cur.credit;
    // Display as natural balance
    const balance = a.normal === "debit" ? net : -net;
    return {
      account: a,
      debit: cur.debit,
      credit: cur.credit,
      balance,
      hasActivity: cur.debit > 0 || cur.credit > 0,
    };
  });
  const totalDr = rows.reduce((s, r) => s + r.debit, 0);
  const totalCr = rows.reduce((s, r) => s + r.credit, 0);
  return {
    rows,
    totals: { debit: totalDr, credit: totalCr, diff: totalDr - totalCr, balanced: Math.abs(totalDr - totalCr) < 0.01 },
  };
}

/* ---------- Balance sheet ---------- */

export function balanceSheet(ledger, asOf, propertyId, chart = DEFAULT_CHART) {
  const tb = trialBalance(ledger, asOf, propertyId, chart);

  const assetRows  = tb.rows.filter(r => r.account.type === "asset");
  const liabRows   = tb.rows.filter(r => r.account.type === "liability");
  const eqRows     = tb.rows.filter(r => r.account.type === "equity");
  const revRows    = tb.rows.filter(r => r.account.type === "revenue");
  const expRows    = tb.rows.filter(r => r.account.type === "expense");

  // Net income flows into retained earnings
  const totalRev = revRows.reduce((s, r) => s + r.balance, 0);
  const totalExp = expRows.reduce((s, r) => s + r.balance, 0);
  const netIncome = totalRev - totalExp;

  const totalAssets = assetRows.reduce((s, r) => s + r.balance, 0);
  const totalLiab = liabRows.reduce((s, r) => s + r.balance, 0);
  const totalEqExplicit = eqRows.reduce((s, r) => s + r.balance, 0);
  const totalEquity = totalEqExplicit + netIncome;

  return {
    asOf,
    propertyId,
    assets: {
      rows: assetRows,
      total: totalAssets,
      bySubtype: groupBySubtype(assetRows),
    },
    liabilities: {
      rows: liabRows,
      total: totalLiab,
      bySubtype: groupBySubtype(liabRows),
    },
    equity: {
      rows: eqRows,
      explicit: totalEqExplicit,
      currentEarnings: netIncome,
      total: totalEquity,
    },
    totals: {
      assets: totalAssets,
      liabilitiesAndEquity: totalLiab + totalEquity,
      diff: totalAssets - (totalLiab + totalEquity),
      balanced: Math.abs(totalAssets - (totalLiab + totalEquity)) < 0.5,
    },
  };
}

function groupBySubtype(rows) {
  const map = {};
  rows.forEach((r) => {
    const k = r.account.subtype || "other";
    if (!map[k]) map[k] = { subtype: k, label: SUBTYPE_LABELS[k] || k, rows: [], total: 0 };
    map[k].rows.push(r);
    map[k].total += r.balance;
  });
  return Object.values(map);
}

/* ---------- Cash flow (indirect method) ---------- */

/**
 * Indirect-method cash flow:
 *   Net Income
 *   + Non-cash adjustments (depreciation)
 *   ± Changes in working capital (AR, Inventory, Prepaid, AP, Accrued)
 *   = Operating cash flow
 *   ± Investing (PP&E changes)
 *   ± Financing (LTD changes, equity changes)
 *   = Net change in cash
 */
export function cashFlow(ledger, period, propertyId, chart = DEFAULT_CHART) {
  // period = { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
  const startBs = balanceSheet(ledger, prevDay(period.start), propertyId, chart);
  const endBs = balanceSheet(ledger, period.end, propertyId, chart);

  // Net income for the period (P&L for the window only)
  const periodPnL = computePeriodPnL(ledger, period.start, period.end, propertyId, chart);

  const balanceOf = (bs, code) => {
    const all = [...bs.assets.rows, ...bs.liabilities.rows, ...bs.equity.rows];
    return (all.find(r => r.account.code === code)?.balance) || 0;
  };
  const delta = (code) => balanceOf(endBs, code) - balanceOf(startBs, code);

  // Working capital changes
  const arChange = delta("1100") + delta("1110") + delta("1120");      // Increase in AR = use of cash
  const invChange = delta("1200") + delta("1210");                      // Increase in inventory = use of cash
  const prepaidChange = delta("1300");
  const apChange = delta("2010");                                       // Increase in AP = source of cash
  const accruedChange = delta("2020") + delta("2030") + delta("2210") + delta("2220") + delta("2230");
  const depreciation = balanceOf(endBs, "1590") - balanceOf(startBs, "1590"); // contra-asset growing = depr expense

  const operating = periodPnL.netIncome
    + depreciation
    - arChange - invChange - prepaidChange
    + apChange + accruedChange;

  // Investing — change in fixed assets (excluding accumulated depreciation, which is non-cash)
  const ppeChange = delta("1500") + delta("1510") + delta("1520");
  const investing = -ppeChange;  // increase in PP&E = use of cash

  // Financing — change in LTD + equity (ex-current earnings) + draws
  const ltdChange = delta("2500");
  const eqChange  = delta("3010") + delta("3020") + delta("3030");
  const financing = ltdChange + eqChange;

  // Cash positions
  const cashStart = balanceOf(startBs, "1010") + balanceOf(startBs, "1020") + balanceOf(startBs, "1030") + balanceOf(startBs, "1040");
  const cashEnd   = balanceOf(endBs,   "1010") + balanceOf(endBs,   "1020") + balanceOf(endBs,   "1030") + balanceOf(endBs,   "1040");

  return {
    period,
    netIncome: periodPnL.netIncome,
    operating: {
      netIncome: periodPnL.netIncome,
      depreciation,
      arChange: -arChange,
      invChange: -invChange,
      prepaidChange: -prepaidChange,
      apChange,
      accruedChange,
      total: operating,
    },
    investing: {
      ppe: -ppeChange,
      total: investing,
    },
    financing: {
      ltd: ltdChange,
      equity: eqChange,
      total: financing,
    },
    netChange: operating + investing + financing,
    cashStart,
    cashEnd,
    derivedCashEnd: cashStart + operating + investing + financing,
  };
}

function prevDay(d) {
  if (!d) return d;
  const dt = new Date(d);
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function computePeriodPnL(ledger, start, end, propertyId, chart) {
  let revenue = 0, expense = 0;
  ledger.forEach((entry) => {
    if (!entry.posted) return;
    if (start && entry.date < start) return;
    if (end && entry.date > end) return;
    if (propertyId && entry.propertyId && entry.propertyId !== propertyId) return;
    (entry.lines || []).forEach((l) => {
      const acct = chart.find(a => a.code === String(l.accountCode));
      if (!acct) return;
      if (acct.type === "revenue") revenue += (Number(l.credit) || 0) - (Number(l.debit) || 0);
      if (acct.type === "expense") expense += (Number(l.debit) || 0) - (Number(l.credit) || 0);
    });
  });
  return { revenue, expense, netIncome: revenue - expense };
}

/* ---------- Account activity (drill-down) ---------- */

export function accountActivity(ledger, accountCode, range, propertyId) {
  const out = [];
  ledger.forEach((entry) => {
    if (!entry.posted) return;
    if (range?.start && entry.date < range.start) return;
    if (range?.end && entry.date > range.end) return;
    if (propertyId && entry.propertyId && entry.propertyId !== propertyId) return;
    (entry.lines || []).forEach((l, i) => {
      if (String(l.accountCode) === String(accountCode)) {
        out.push({
          date: entry.date,
          entryId: entry.id,
          source: entry.source || "manual",
          description: entry.description,
          memo: l.memo,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          lineIdx: i,
        });
      }
    });
  });
  out.sort((a, b) => a.date.localeCompare(b.date));
  // Running balance
  let bal = 0;
  out.forEach((row) => {
    bal += row.debit - row.credit;
    row.runningBalance = bal;
  });
  return out;
}

/* ---------- Bank reconciliation ---------- */

/**
 * Match bank statement transactions against journal lines posting to the bank
 * account. Returns matched + outstanding lists.
 */
export function reconcile(ledger, bankAccountCode, statementTransactions, asOf) {
  // 1) Pull all journal lines for this bank account
  const ledgerLines = [];
  ledger.forEach((entry) => {
    if (!entry.posted) return;
    if (asOf && entry.date > asOf) return;
    (entry.lines || []).forEach((l, i) => {
      if (String(l.accountCode) !== String(bankAccountCode)) return;
      const amt = (Number(l.debit) || 0) - (Number(l.credit) || 0);
      if (amt === 0) return;
      ledgerLines.push({
        entryId: entry.id,
        lineIdx: i,
        date: entry.date,
        amount: amt,                // +deposit / -withdrawal from ledger perspective
        description: l.memo || entry.description,
        matched: false,
      });
    });
  });

  // 2) Prepare bank transactions (positive = deposit)
  const bankTxns = (statementTransactions || []).map((t, i) => ({
    ...t,
    bankIdx: i,
    matched: false,
    amount: Number(t.amount) || 0,
  }));

  // 3) Greedy match: same amount within 5 days
  bankTxns.forEach((b) => {
    const candidate = ledgerLines.find((l) => !l.matched && Math.abs(l.amount - b.amount) < 0.005 && Math.abs(daysBetween(l.date, b.date)) <= 5);
    if (candidate) {
      candidate.matched = true;
      b.matched = true;
      b.matchedTo = { entryId: candidate.entryId, lineIdx: candidate.lineIdx };
    }
  });

  const matchedPairs = bankTxns.filter(b => b.matched).map(b => ({
    bank: b,
    ledger: ledgerLines.find(l => l.entryId === b.matchedTo.entryId && l.lineIdx === b.matchedTo.lineIdx),
  }));
  const outstandingBank = bankTxns.filter(b => !b.matched);
  const outstandingLedger = ledgerLines.filter(l => !l.matched);

  const stmtBalance = bankTxns.reduce((s, t) => s + t.amount, 0);
  const ledgerBalance = ledgerLines.reduce((s, l) => s + l.amount, 0);

  return {
    matchedPairs,
    outstandingBank,
    outstandingLedger,
    stmtBalance,
    ledgerBalance,
    diff: stmtBalance - ledgerBalance,
  };
}

function daysBetween(a, b) {
  return (new Date(a) - new Date(b)) / (24 * 3600 * 1000);
}
