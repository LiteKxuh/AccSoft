/* HotelOps · Multi-property portfolio
 * =================================================================
 * Roll up TB/BS/PL/cash-flow across properties. Pure functions — UI
 * passes in the property-filtered slices and gets a consolidated
 * summary back. Eliminations (intercompany) are out of scope here;
 * each property's books are independent.
 */

import { trialBalance, balanceSheet, cashFlow, buildLedger, DEFAULT_CHART } from "./gl.js";

/**
 * Consolidate across multiple properties. The caller passes the full state
 * (which contains journalEntries from all props) and an array of property IDs;
 * we filter the JEs per property and combine.
 *
 * Returns { perProperty: [...], consolidated: { tb, bs, pl, cashflow } }
 */
export function consolidate({ state, propertyIds, asOf, periodStart, periodEnd, chart = DEFAULT_CHART }) {
  const perProperty = propertyIds.map(pid => {
    const propJEs = (state.journalEntries || []).filter(j => j.propertyId === pid);
    const ledger = buildLedger(propJEs, chart);
    const tb = trialBalance(ledger, { asOf, chart });
    const bs = balanceSheet(ledger, { asOf, chart });
    const cf = cashFlow(ledger, { start: periodStart, end: periodEnd, chart });
    const property = state.properties.find(p => p.id === pid) || { id: pid, name: "Unknown" };
    return { property, tb, bs, cashflow: cf };
  });

  // Consolidate trial balance: sum balances by accountCode
  const consolidatedTB = mergeTrialBalances(perProperty.map(x => x.tb));
  const consolidatedBS = mergeBalanceSheets(perProperty.map(x => x.bs));
  const consolidatedCF = mergeCashFlows(perProperty.map(x => x.cashflow));

  return {
    perProperty,
    consolidated: {
      tb: consolidatedTB,
      bs: consolidatedBS,
      cashflow: consolidatedCF,
    },
  };
}

function mergeTrialBalances(tbs) {
  const acctMap = {};
  tbs.forEach(tb => {
    (tb.rows || []).forEach(row => {
      const k = row.accountCode;
      if (!acctMap[k]) acctMap[k] = { ...row, debit: 0, credit: 0, balance: 0 };
      acctMap[k].debit += row.debit || 0;
      acctMap[k].credit += row.credit || 0;
      acctMap[k].balance += row.balance || 0;
    });
  });
  const rows = Object.values(acctMap).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return {
    rows,
    totalDebits: rows.reduce((s, r) => s + (r.debit || 0), 0),
    totalCredits: rows.reduce((s, r) => s + (r.credit || 0), 0),
    balanced: Math.abs(rows.reduce((s, r) => s + (r.debit || 0) - (r.credit || 0), 0)) < 0.005,
  };
}

function mergeBalanceSheets(bss) {
  const merged = {
    assets: { current: [], nonCurrent: [], totalCurrent: 0, totalNonCurrent: 0, total: 0 },
    liabilities: { current: [], nonCurrent: [], totalCurrent: 0, totalNonCurrent: 0, total: 0 },
    equity: { items: [], total: 0 },
  };
  const sumGroup = (groupName, sub) => {
    const acc = {};
    bss.forEach(bs => {
      ((bs[groupName] && bs[groupName][sub]) || []).forEach(item => {
        const k = item.accountCode || item.code || item.name;
        if (!acc[k]) acc[k] = { ...item, balance: 0 };
        acc[k].balance += item.balance || 0;
      });
    });
    return Object.values(acc);
  };
  merged.assets.current = sumGroup("assets", "current");
  merged.assets.nonCurrent = sumGroup("assets", "nonCurrent");
  merged.liabilities.current = sumGroup("liabilities", "current");
  merged.liabilities.nonCurrent = sumGroup("liabilities", "nonCurrent");
  // Equity items
  const eqAcc = {};
  bss.forEach(bs => {
    ((bs.equity && bs.equity.items) || []).forEach(item => {
      const k = item.accountCode || item.code || item.name;
      if (!eqAcc[k]) eqAcc[k] = { ...item, balance: 0 };
      eqAcc[k].balance += item.balance || 0;
    });
  });
  merged.equity.items = Object.values(eqAcc);

  merged.assets.totalCurrent = sum(merged.assets.current.map(i => i.balance));
  merged.assets.totalNonCurrent = sum(merged.assets.nonCurrent.map(i => i.balance));
  merged.assets.total = merged.assets.totalCurrent + merged.assets.totalNonCurrent;
  merged.liabilities.totalCurrent = sum(merged.liabilities.current.map(i => i.balance));
  merged.liabilities.totalNonCurrent = sum(merged.liabilities.nonCurrent.map(i => i.balance));
  merged.liabilities.total = merged.liabilities.totalCurrent + merged.liabilities.totalNonCurrent;
  merged.equity.total = sum(merged.equity.items.map(i => i.balance));
  merged.totalLiabilitiesAndEquity = merged.liabilities.total + merged.equity.total;
  merged.balanced = Math.abs(merged.assets.total - merged.totalLiabilitiesAndEquity) < 0.5;
  return merged;
}

function mergeCashFlows(cfs) {
  const merged = {
    operating: { net: 0, items: [] },
    investing: { net: 0, items: [] },
    financing: { net: 0, items: [] },
    netChange: 0,
    beginCash: 0,
    endCash: 0,
  };
  const collect = (section) => {
    const acc = {};
    cfs.forEach(cf => {
      ((cf[section] && cf[section].items) || []).forEach(it => {
        const k = it.label || it.name || it.code;
        if (!acc[k]) acc[k] = { ...it, amount: 0 };
        acc[k].amount += it.amount || 0;
      });
    });
    return Object.values(acc);
  };
  merged.operating.items = collect("operating");
  merged.investing.items = collect("investing");
  merged.financing.items = collect("financing");
  merged.operating.net = sum(merged.operating.items.map(i => i.amount));
  merged.investing.net = sum(merged.investing.items.map(i => i.amount));
  merged.financing.net = sum(merged.financing.items.map(i => i.amount));
  merged.netChange = merged.operating.net + merged.investing.net + merged.financing.net;
  merged.beginCash = sum(cfs.map(c => c.beginCash || 0));
  merged.endCash = sum(cfs.map(c => c.endCash || 0));
  return merged;
}

/** Cross-property KPIs for the dashboard tile. */
export function portfolioKPIs({ state, propertyIds, periodStart, periodEnd }) {
  const reports = (state.reports || []).filter(r => propertyIds.includes(r.propertyId));
  const inRange = (d) => {
    const dt = new Date(d);
    return dt >= new Date(periodStart) && dt <= new Date(periodEnd);
  };
  const filtered = reports.filter(r => inRange(r.date));

  let roomsSold = 0;
  let roomsAvail = 0;
  let revenue = 0;
  filtered.forEach(r => {
    roomsSold += Number(r.rooms?.sold || r.roomsSold || 0);
    roomsAvail += Number(r.rooms?.available || r.roomsAvailable || 0);
    const room = Number(r.revenue?.rooms || r.roomRevenue || 0);
    const fb = (r.revenue?.fb?.restaurant || 0) + (r.revenue?.fb?.bar || 0) + (r.revenue?.fb?.banquet || 0);
    const other = (r.revenue?.other?.parking || 0) + (r.revenue?.other?.spa || 0) + (r.revenue?.other?.misc || 0) + (r.revenue?.other?.telephone || 0);
    revenue += room + fb + other;
  });

  return {
    properties: propertyIds.length,
    roomsSold,
    roomsAvailable: roomsAvail,
    occupancy: roomsAvail ? roomsSold / roomsAvail : 0,
    revenue,
    adr: roomsSold ? revenue / roomsSold : 0,
    revpar: roomsAvail ? revenue / roomsAvail : 0,
    reportCount: filtered.length,
  };
}

function sum(arr) { return (arr || []).reduce((s, v) => s + (Number(v) || 0), 0); }
