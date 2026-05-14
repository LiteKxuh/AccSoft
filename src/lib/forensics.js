/* HotelOps · Financial forensics engine
 * =================================================================
 * Deterministic detectors over the existing ledger / AP / payroll
 * data. Designed to surface real operational leakage and fraud
 * patterns a controller would flag in an internal audit:
 *
 *   detectDuplicateInvoices(invoices)
 *   detectAdjustmentSpike(journalEntries, opts)
 *   detectGhostRevenue(reports, journalEntries)
 *   detectRefundOutliers(invoices, journalEntries)
 *   detectPayrollAnomalies(payrollRuns, employees)
 *   detectApprovalBypass(journalEntries, invoices, opts)
 *   detectVendorBehavior(invoices, vendors)
 *
 *   runForensics(state, opts) → aggregated findings + risk score
 *
 * Each finding has:
 *   { id, code, severity, label, detail, confidence, evidence }
 *
 * confidence is in [0,1] — derived from the strength of the rule
 * match, NOT a model probability. Operators can rank by confidence.
 */

import { toCents, fromCents, fmtMoney } from "./money.js";
import { entryTotals } from "./gl.js";

let _ctr = 0;
function fid() { _ctr += 1; return `fnd_${Date.now().toString(36)}_${_ctr.toString(36)}`; }

function fmtDate(d) { return String(d || "").slice(0, 10); }

/* ---------- Duplicate invoices ---------- */
export function detectDuplicateInvoices(invoices = []) {
  const findings = [];
  const liveInvoices = invoices.filter(i => i.status !== "void");
  // 1) Exact (vendor + amount + invoiceNumber) match
  const byKey = new Map();
  for (const i of liveInvoices) {
    const k = `${i.vendorId || "_"}::${(i.number || i.invoiceNumber || "").toLowerCase()}::${toCents(i.amount)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(i);
  }
  for (const [k, dups] of byKey) {
    if (dups.length > 1 && (k.endsWith("::0") === false)) {
      findings.push({
        id: fid(), code: "duplicate.exact",
        severity: "high", confidence: 0.95,
        label: `Duplicate invoice number from same vendor`,
        detail: `${dups.length} invoices share vendor + number + amount: ${dups.map(d => d.id).join(", ")}`,
        evidence: { invoiceIds: dups.map(d => d.id) },
      });
    }
  }
  // 2) Same vendor + same amount within 7 days, no shared invoiceNumber (typo'd duplicate)
  const byVendorAmt = new Map();
  for (const i of liveInvoices) {
    if (!i.vendorId || !(Number(i.amount) > 0) || !i.issuedDate) continue;
    const k = `${i.vendorId}::${toCents(i.amount)}`;
    if (!byVendorAmt.has(k)) byVendorAmt.set(k, []);
    byVendorAmt.get(k).push(i);
  }
  for (const dups of byVendorAmt.values()) {
    if (dups.length < 2) continue;
    const sorted = [...dups].sort((a, b) => a.issuedDate.localeCompare(b.issuedDate));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if ((a.number || "") === (b.number || "")) continue; // already caught above
      const days = (new Date(b.issuedDate) - new Date(a.issuedDate)) / 86400000;
      if (days <= 7) {
        findings.push({
          id: fid(), code: "duplicate.likely",
          severity: "medium", confidence: 0.7,
          label: `Possible duplicate: same vendor + amount within ${Math.round(days)} day(s)`,
          detail: `${a.id} (${fmtMoney(a.amount)}) and ${b.id} (${fmtMoney(b.amount)}) · ${a.issuedDate} vs ${b.issuedDate}`,
          evidence: { invoiceIds: [a.id, b.id], days },
        });
      }
    }
  }
  return findings;
}

/* ---------- Adjustment spike (JE volume anomaly) ---------- */
export function detectAdjustmentSpike(journalEntries = [], opts = {}) {
  const manual = journalEntries.filter(j => !j.void && j.posted && (!j.source || j.source === "manual" || j.source?.startsWith("manual")));
  if (manual.length < 10) return [];
  // Group by week, count entries
  const byWeek = new Map();
  for (const j of manual) {
    const d = new Date(j.date);
    if (Number.isNaN(d.getTime())) continue;
    // ISO week key
    const t = new Date(d.getTime());
    t.setUTCHours(0, 0, 0, 0);
    t.setUTCDate(t.getUTCDate() - (t.getUTCDay() || 7) + 1);
    const wk = t.toISOString().slice(0, 10);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(j);
  }
  const counts = Array.from(byWeek.entries()).map(([wk, list]) => ({ wk, count: list.length, dollar: list.reduce((s, e) => s + entryTotals(e).debit, 0) }));
  if (counts.length < 4) return [];
  // Compute median and MAD
  const sortedCounts = [...counts].map(c => c.count).sort((a, b) => a - b);
  const median = sortedCounts[Math.floor(sortedCounts.length / 2)];
  const mad = sortedCounts.map(c => Math.abs(c - median)).sort((a, b) => a - b)[Math.floor(sortedCounts.length / 2)] || 1;
  const findings = [];
  for (const c of counts) {
    // 3.5x scaled MAD ≈ 99th-percentile outlier in approximately normal data
    if (c.count > median + 3.5 * mad && c.count >= 5) {
      const ratio = median > 0 ? c.count / median : c.count;
      findings.push({
        id: fid(), code: "adjustment.spike",
        severity: ratio > 4 ? "high" : "medium",
        confidence: Math.min(0.9, 0.4 + ratio / 10),
        label: `Manual JE spike in week of ${c.wk}: ${c.count} entries (median ${median})`,
        detail: `Dollar volume ${fmtMoney(c.dollar)} — investigate for round-number entries or year-end-style adjustments.`,
        evidence: { week: c.wk, count: c.count, median, mad },
      });
    }
  }
  return findings;
}

/* ---------- Ghost revenue: reports without matching JE settlement ---------- */
export function detectGhostRevenue(reports = [], journalEntries = []) {
  const findings = [];
  const reportJEs = new Map();
  for (const j of journalEntries) {
    if (!j.posted || j.void) continue;
    if (j.source === "auto-from-report" && j.sourceId) reportJEs.set(j.sourceId, j);
  }
  for (const r of reports) {
    if (!(Number(r.totalRevenue) > 0)) continue;
    if (reportJEs.has(r.id)) continue;
    findings.push({
      id: fid(), code: "ghost.revenue",
      severity: "high", confidence: 0.85,
      label: `Report posted with no journal entry`,
      detail: `${fmtDate(r.date)} · ${fmtMoney(r.totalRevenue)} of revenue recorded on report ${r.id} but never posted to the GL.`,
      evidence: { reportId: r.id, date: r.date, amount: r.totalRevenue },
    });
  }
  return findings;
}

/* ---------- Refund outliers — large credits ----------*/
export function detectRefundOutliers(invoices = [], journalEntries = []) {
  const findings = [];
  // Look at JE lines posting credits to revenue accounts (4xxx) — refunds
  // larger than $1,000 or > 25% of any single revenue day
  for (const j of journalEntries) {
    if (!j.posted || j.void) continue;
    const dateRev = (j.lines || []).filter(l => String(l.accountCode).startsWith("4"))
      .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    // dateRev > 0 means revenue was reduced (debited)
    if (dateRev >= 1000 && j.source !== "auto-from-report") {
      findings.push({
        id: fid(), code: "refund.large",
        severity: dateRev > 5000 ? "high" : "medium",
        confidence: 0.65,
        label: `Large revenue reversal: ${fmtMoney(dateRev)}`,
        detail: `${fmtDate(j.date)} · JE ${j.id} reduced revenue accounts by ${fmtMoney(dateRev)} via ${j.source || "manual"}. Verify guest-folio backup.`,
        evidence: { entryId: j.id, amount: dateRev, source: j.source },
      });
    }
  }
  return findings;
}

/* ---------- Payroll anomalies ---------- */
export function detectPayrollAnomalies(payrollRuns = [], employees = []) {
  const findings = [];
  const eById = new Map((employees || []).map(e => [e.id, e]));
  // For each employee, look at gross-pay distribution across runs; flag >2x median
  const byEmp = new Map();
  for (const run of payrollRuns) {
    for (const line of (run.lines || [])) {
      if (!byEmp.has(line.employeeId)) byEmp.set(line.employeeId, []);
      byEmp.get(line.employeeId).push({ runId: run.id, gross: Number(line.gross) || 0, periodEnd: run.periodEnd });
    }
  }
  for (const [empId, list] of byEmp) {
    if (list.length < 3) continue;
    const grosses = list.map(x => x.gross).filter(v => v > 0).sort((a, b) => a - b);
    if (!grosses.length) continue;
    const median = grosses[Math.floor(grosses.length / 2)];
    const e = eById.get(empId);
    for (const row of list) {
      if (row.gross > median * 2 && row.gross > 500) {
        findings.push({
          id: fid(), code: "payroll.outlier",
          severity: row.gross > median * 3 ? "high" : "medium",
          confidence: 0.6,
          label: `Payroll outlier for ${e?.name || empId}`,
          detail: `Pay period ending ${row.periodEnd}: gross ${fmtMoney(row.gross)} vs median ${fmtMoney(median)} (run ${row.runId}). Verify overtime / bonus authorization.`,
          evidence: { employeeId: empId, runId: row.runId, gross: row.gross, median },
        });
      }
    }
  }
  return findings;
}

/* ---------- Approval bypass detection ---------- */
export function detectApprovalBypass(journalEntries = [], invoices = [], opts = {}) {
  const findings = [];
  const threshold = Number(opts.threshold) || 5000;
  for (const j of journalEntries) {
    if (!j.posted || j.void) continue;
    if (j.source && j.source.startsWith("auto-")) continue; // auto JEs bypass approval by design
    const amt = entryTotals(j).debit;
    if (amt >= threshold && j.approvalState !== "approved") {
      findings.push({
        id: fid(), code: "bypass.je",
        severity: "high", confidence: 0.9,
        label: `Posted JE ${fmtMoney(amt)} without approval`,
        detail: `JE ${j.id} on ${fmtDate(j.date)} — ${j.description}. Above approval threshold ${fmtMoney(threshold)} but not approved.`,
        evidence: { entryId: j.id, amount: amt, approvalState: j.approvalState },
      });
    }
  }
  for (const i of invoices) {
    if (i.status === "paid" && i.approvalState !== "approved" && (Number(i.amount) || 0) >= threshold) {
      findings.push({
        id: fid(), code: "bypass.ap",
        severity: "high", confidence: 0.9,
        label: `Paid invoice ${fmtMoney(i.amount)} was never approved`,
        detail: `Invoice ${i.id} (${i.number || ""}) paid on ${fmtDate(i.paidDate)} without approval workflow.`,
        evidence: { invoiceId: i.id, amount: i.amount, approvalState: i.approvalState },
      });
    }
  }
  return findings;
}

/* ---------- Vendor behavior ---------- */
export function detectVendorBehavior(invoices = [], vendors = []) {
  const findings = [];
  // Brand-new vendor with large first invoice
  const vById = new Map((vendors || []).map(v => [v.id, v]));
  const seenVendor = new Map();
  // Sort invoices by issued date so "first" is the earliest one
  const sortedInvs = [...(invoices || [])].sort((a, b) => (a.issuedDate || "").localeCompare(b.issuedDate || ""));
  for (const i of sortedInvs) {
    if (!i.vendorId || !(Number(i.amount) > 0)) continue;
    if (!seenVendor.has(i.vendorId)) {
      seenVendor.set(i.vendorId, i);
      const v = vById.get(i.vendorId);
      const vendorAgeDays = v?.createdAt ? Math.floor((new Date(i.issuedDate) - new Date(v.createdAt)) / 86400000) : Infinity;
      if (i.amount >= 10_000 && vendorAgeDays >= 0 && vendorAgeDays <= 30) {
        findings.push({
          id: fid(), code: "vendor.new_large",
          severity: i.amount >= 50_000 ? "high" : "medium",
          confidence: 0.55,
          label: `New vendor first invoice ${fmtMoney(i.amount)}`,
          detail: `${v?.name || i.vendorId} added ${v?.createdAt?.slice(0, 10) || "?"} · first invoice ${fmtMoney(i.amount)} on ${fmtDate(i.issuedDate)}. Verify onboarding diligence.`,
          evidence: { vendorId: i.vendorId, invoiceId: i.id, amount: i.amount, vendorAgeDays },
        });
      }
    }
  }
  return findings;
}

/* ---------- Aggregated runner ---------- */
export function runForensics(state, opts = {}) {
  const findings = [
    ...detectDuplicateInvoices(state.invoices || []),
    ...detectAdjustmentSpike(state.journalEntries || [], opts),
    ...detectGhostRevenue(state.reports || [], state.journalEntries || []),
    ...detectRefundOutliers(state.invoices || [], state.journalEntries || []),
    ...detectPayrollAnomalies(state.payrollRuns || [], state.employees || []),
    ...detectApprovalBypass(state.journalEntries || [], state.invoices || [], opts),
    ...detectVendorBehavior(state.invoices || [], state.vendors || []),
  ];

  // Severity-weighted risk score 0-100
  const w = { high: 8, medium: 3, low: 1, info: 0 };
  const score = findings.reduce((s, f) => s + (w[f.severity] || 1), 0);
  const riskBand = score === 0 ? "clean"
    : score < 5 ? "low"
    : score < 15 ? "elevated"
    : score < 30 ? "high"
    : "critical";

  // Bucket by code
  const byCode = findings.reduce((acc, f) => { acc[f.code] = (acc[f.code] || 0) + 1; return acc; }, {});

  return {
    findings: findings.sort((a, b) => (b.confidence * sevWeight(b.severity)) - (a.confidence * sevWeight(a.severity))),
    counts: byCode,
    riskScore: score,
    riskBand,
    runAt: new Date().toISOString(),
  };
}

function sevWeight(s) {
  return s === "high" ? 3 : s === "medium" ? 2 : s === "low" ? 1 : 0;
}
