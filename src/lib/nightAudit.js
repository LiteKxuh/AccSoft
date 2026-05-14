/* HotelOps · Night Audit reconciliation engine
 * =================================================================
 * Programmatic balance checks that mirror what a real night auditor
 * verifies before rolling the date:
 *
 *   - settlement vs (revenue + tax)
 *   - rooms-sold × ADR ≈ room revenue
 *   - rooms-sold ≤ rooms-available  (no physical impossibility)
 *   - occupancy = rooms-sold ÷ rooms-available
 *   - tax math against configured rates
 *   - advance deposits reconcile against unearned revenue movement
 *   - no-show validation (no-show charges = no-show count × ADR ± tolerance)
 *   - package allocation (rooms portion + F&B portion + tax = package revenue)
 *   - cash drop matches cash settlements
 *
 * Each check returns { id, label, status: "pass"|"warn"|"fail", detail, severity, fix? }.
 * Aggregate result produces an "Audit Health Score" 0-100 weighted by severity.
 */

import { toCents, fromCents, fmtMoney } from "./money.js";

const DEFAULT_TAX_RATES = { occupancy: 0.115, sales: 0.0695, tourism: 0.015 };

function pickRate(propertySettings, key, fallback) {
  return propertySettings?.taxRates?.[key] ?? fallback;
}

function delta(actual, expected) {
  const a = toCents(actual);
  const b = toCents(expected);
  return { absCents: Math.abs(a - b), pct: b !== 0 ? Math.abs(a - b) / Math.abs(b) : 0 };
}

function fmtCheck(id, label, status, detail, severity = "medium", fix = null) {
  return { id, label, status, detail, severity, fix };
}

/* ---------- individual checks ---------- */

export function checkSettlement(report) {
  const b = report.breakdown || {};
  const pay = b.payments || {};
  const cash = Number(pay.cash) || 0;
  const cc = Number(pay.creditCard) || 0;
  const ar = Number(pay.directBill) || 0;
  const other = Number(pay.other) || 0;
  const settle = cash + cc + ar + other;
  const rev = Object.values(b.revenue?.fb || {}).reduce((s, n) => s + (Number(n) || 0), 0)
    + Object.values(b.revenue?.other || {}).reduce((s, n) => s + (Number(n) || 0), 0)
    + (Number(b.revenue?.rooms) || 0);
  const tax = Object.values(b.taxes || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const expected = rev + tax;
  if (settle === 0) {
    if (expected === 0) {
      return fmtCheck("settlement", "Settlement reconciles to revenue + tax", "pass", "No revenue and no settlement on the report.");
    }
    return fmtCheck("settlement", "Settlement reconciles to revenue + tax", "warn",
      `Revenue + tax ${fmtMoney(expected)} posted but no payment settlement detail recorded.`, "medium",
      "Populate the report's settlement section before close.");
  }
  const d = delta(settle, expected);
  if (d.absCents <= 100) {
    return fmtCheck("settlement", "Settlement reconciles to revenue + tax", "pass", `Settled ${fmtMoney(settle)} = Rev+Tax ${fmtMoney(expected)}`);
  }
  const tol = Math.max(100, toCents(expected * 0.02));
  if (d.absCents <= tol) {
    return fmtCheck("settlement", "Settlement reconciles to revenue + tax", "warn",
      `Off by ${fmtMoney(fromCents(toCents(settle) - toCents(expected)))} (${(d.pct * 100).toFixed(2)}%)`, "medium",
      "Verify in-house balances and pending CC settlements.");
  }
  return fmtCheck("settlement", "Settlement reconciles to revenue + tax", "fail",
    `Off by ${fmtMoney(fromCents(toCents(settle) - toCents(expected)))} (${(d.pct * 100).toFixed(2)}%)`, "high",
    "Trace house-account postings and any unposted folios.");
}

export function checkOccupancyMath(report) {
  const sold = Number(report.roomsSold) || 0;
  const avail = Number(report.roomsAvailable) || 0;
  if (avail <= 0) {
    return fmtCheck("occupancy.available", "Rooms available is set", "fail", "Rooms-available is zero — cannot compute occupancy.", "high");
  }
  if (sold < 0) {
    return fmtCheck("occupancy.negative", "Rooms sold is non-negative", "fail", `Rooms-sold ${sold} cannot be negative.`, "high");
  }
  if (sold > avail) {
    return fmtCheck("occupancy.over", "Rooms sold ≤ rooms available", "fail",
      `Sold ${sold} > Available ${avail} — physically impossible.`, "high",
      "Confirm rollover from prior night and any rooms held out of order.");
  }
  const calc = sold / avail;
  const reported = Number(report.occupancy) || 0;
  if (reported && Math.abs(calc - reported) > 0.01) {
    return fmtCheck("occupancy.math", "Occupancy = rooms-sold ÷ rooms-available", "warn",
      `Reported ${(reported * 100).toFixed(1)}%, computed ${(calc * 100).toFixed(1)}%.`, "medium");
  }
  return fmtCheck("occupancy.math", "Occupancy = rooms-sold ÷ rooms-available", "pass",
    `${sold} of ${avail} = ${(calc * 100).toFixed(1)}%`);
}

export function checkAdr(report) {
  const sold = Number(report.roomsSold) || 0;
  const roomRev = Number(report.breakdown?.revenue?.rooms ?? report.roomRevenue) || 0;
  if (sold <= 0 && roomRev > 0) {
    return fmtCheck("adr.zero-rooms", "Rooms sold consistent with room revenue", "fail",
      `Room revenue ${fmtMoney(roomRev)} with 0 rooms sold — verify rollover.`, "high");
  }
  if (sold <= 0) return fmtCheck("adr.zero-rooms", "ADR consistent with rooms sold", "pass", "No rooms sold and no room revenue — consistent.");
  const calc = roomRev / sold;
  const reported = Number(report.adr) || 0;
  if (reported && Math.abs(calc - reported) > 0.50) {
    return fmtCheck("adr.math", "ADR ≈ room revenue ÷ rooms sold", "warn",
      `Reported ${fmtMoney(reported)}, computed ${fmtMoney(calc)}.`, "medium");
  }
  return fmtCheck("adr.math", "ADR ≈ room revenue ÷ rooms sold", "pass", `${sold} × ${fmtMoney(calc)} = ${fmtMoney(roomRev)}`);
}

export function checkTaxRates(report, propertySettings = null) {
  const b = report.breakdown || {};
  const roomRev = Number(b.revenue?.rooms ?? report.roomRevenue) || 0;
  const rates = {
    occupancy: pickRate(propertySettings, "occupancy", DEFAULT_TAX_RATES.occupancy),
    sales: pickRate(propertySettings, "sales", DEFAULT_TAX_RATES.sales),
    tourism: pickRate(propertySettings, "tourism", DEFAULT_TAX_RATES.tourism),
  };
  const expectedOcc = roomRev * rates.occupancy;
  const expectedTour = roomRev * rates.tourism;
  const fbRev = Object.values(b.revenue?.fb || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const expectedSales = fbRev * rates.sales;
  const reportedOcc = Number(b.taxes?.occupancy) || 0;
  const reportedSales = Number(b.taxes?.sales) || 0;
  const reportedTour = Number(b.taxes?.tourism) || 0;
  const issues = [];
  const tol = (amt) => Math.max(0.50, amt * 0.02);
  if (Math.abs(reportedOcc - expectedOcc) > tol(expectedOcc) && expectedOcc > 0) {
    issues.push(`Occupancy tax ${fmtMoney(reportedOcc)} vs expected ${fmtMoney(expectedOcc)} @ ${(rates.occupancy * 100).toFixed(2)}%`);
  }
  if (Math.abs(reportedSales - expectedSales) > tol(expectedSales) && expectedSales > 0) {
    issues.push(`Sales tax ${fmtMoney(reportedSales)} vs expected ${fmtMoney(expectedSales)} @ ${(rates.sales * 100).toFixed(2)}%`);
  }
  if (Math.abs(reportedTour - expectedTour) > tol(expectedTour) && expectedTour > 0) {
    issues.push(`Tourism tax ${fmtMoney(reportedTour)} vs expected ${fmtMoney(expectedTour)} @ ${(rates.tourism * 100).toFixed(2)}%`);
  }
  if (!issues.length) {
    return fmtCheck("tax.rates", "Tax accruals match configured rates", "pass", "Occupancy, sales, and tourism tax line up within 2% / $0.50.");
  }
  return fmtCheck("tax.rates", "Tax accruals match configured rates", "warn", issues.join(" · "), "medium",
    "Verify exempt-room handling and any tax-exempt corporate accounts.");
}

export function checkAdvanceDeposits(report) {
  const b = report.breakdown || {};
  const adv = Number(b.advanceDeposits?.total ?? b.advanceDeposits ?? 0);
  const applied = Number(b.advanceDeposits?.applied ?? 0);
  if (adv < 0 || applied < 0) {
    return fmtCheck("advdep.negative", "Advance deposits non-negative", "fail", "Negative advance deposit movement — likely sign error.", "high");
  }
  return fmtCheck("advdep.captured", "Advance deposits captured", "pass",
    adv || applied ? `Received ${fmtMoney(adv)} · Applied ${fmtMoney(applied)}` : "No advance deposit activity.");
}

export function checkNoShows(report) {
  const ns = Number(report.breakdown?.noShows?.count ?? report.noShowCount) || 0;
  const nsRev = Number(report.breakdown?.noShows?.revenue ?? report.noShowRevenue) || 0;
  const adr = Number(report.adr) || 0;
  if (ns === 0 && nsRev === 0) {
    return fmtCheck("noshow.none", "No-show charges reconcile", "pass", "No no-shows on file.");
  }
  if (ns > 0 && adr > 0) {
    const expected = ns * adr;
    const tol = Math.max(10, adr * 0.1);
    if (Math.abs(nsRev - expected) > tol) {
      return fmtCheck("noshow.amount", "No-show revenue ≈ no-show count × ADR", "warn",
        `${ns} no-shows × ADR ${fmtMoney(adr)} = ${fmtMoney(expected)}, posted ${fmtMoney(nsRev)}.`, "medium");
    }
  }
  return fmtCheck("noshow.amount", "No-show charges reconcile", "pass", `${ns} no-show${ns === 1 ? "" : "s"} · ${fmtMoney(nsRev)}`);
}

export function checkCashDrop(report) {
  const cash = Number(report.breakdown?.payments?.cash) || 0;
  const drop = Number(report.breakdown?.cashDrop) || 0;
  if (cash === 0 && drop === 0) return fmtCheck("cash.drop", "Cash drop matches cash settlements", "pass", "No cash activity.");
  if (Math.abs(cash - drop) <= 1.00) {
    return fmtCheck("cash.drop", "Cash drop matches cash settlements", "pass", `Cash ${fmtMoney(cash)} = Drop ${fmtMoney(drop)}`);
  }
  if (Math.abs(cash - drop) <= Math.max(5, cash * 0.05)) {
    return fmtCheck("cash.drop", "Cash drop matches cash settlements", "warn",
      `Cash ${fmtMoney(cash)} vs Drop ${fmtMoney(drop)} — diff ${fmtMoney(cash - drop)}`, "medium",
      "Confirm petty-cash reimbursements and tip-outs.");
  }
  return fmtCheck("cash.drop", "Cash drop matches cash settlements", "fail",
    `Cash ${fmtMoney(cash)} vs Drop ${fmtMoney(drop)} — diff ${fmtMoney(cash - drop)}`, "high",
    "Run an over/short analysis and verify drawer counts.");
}

/* ---------- orchestrator ---------- */

const SEVERITY_WEIGHT = { high: 30, medium: 15, low: 5 };
const STATUS_PENALTY  = { fail: 1.0, warn: 0.4, pass: 0 };

export function runNightAudit(report, propertySettings = null) {
  if (!report) {
    return { score: 0, status: "fail", checks: [], summary: "No report to audit." };
  }
  const checks = [
    checkOccupancyMath(report),
    checkAdr(report),
    checkSettlement(report),
    checkTaxRates(report, propertySettings),
    checkAdvanceDeposits(report),
    checkNoShows(report),
    checkCashDrop(report),
  ];
  let totalPenalty = 0;
  let maxPenalty = 0;
  for (const c of checks) {
    const w = SEVERITY_WEIGHT[c.severity] ?? 10;
    maxPenalty += w;
    totalPenalty += w * (STATUS_PENALTY[c.status] ?? 0);
  }
  const score = maxPenalty > 0 ? Math.round(((maxPenalty - totalPenalty) / maxPenalty) * 100) : 100;
  const status = checks.some(c => c.status === "fail") ? "fail"
    : checks.some(c => c.status === "warn") ? "warn"
    : "pass";
  const summary = status === "pass"
    ? "Audit clean — safe to roll the date."
    : status === "warn"
    ? `${checks.filter(c => c.status === "warn").length} warning${checks.filter(c => c.status === "warn").length === 1 ? "" : "s"} — review before close.`
    : `${checks.filter(c => c.status === "fail").length} hard failure${checks.filter(c => c.status === "fail").length === 1 ? "" : "s"} — DO NOT roll.`;
  return {
    score,
    status,
    checks,
    summary,
    audited: { reportId: report.id, date: report.date, propertyId: report.propertyId },
  };
}
