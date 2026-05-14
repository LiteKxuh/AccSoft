/* HotelOps · Workforce — payroll exporters
 * =================================================================
 * Converts a payroll batch into the CSV / API payloads each major
 * provider expects. Pure functions; no I/O.
 *
 *   exportForADP(batch, perEmployee, employees)   → { filename, content, format }
 *   exportForGusto(batch, perEmployee, employees) → { filename, content, format }
 *   exportForPaychex(...)
 *   exportForPaylocity(...)
 *   exportGenericCsv(...)
 *
 * Each exporter validates required fields and surfaces missing-data
 * issues before writing — better to fail loudly than ship a broken
 * file to a third-party processor.
 */

function csvCell(v) {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}
function csvLine(row) { return row.map(csvCell).join(","); }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function validateBatchForExport(batch, perEmployee) {
  const issues = [];
  if (!batch) return ["batch missing"];
  if (!batch.periodStart || !batch.periodEnd) issues.push("period dates missing");
  if (batch.status !== "approved" && batch.status !== "exported") {
    issues.push(`batch status is ${batch.status} — must be approved before export`);
  }
  for (const row of (perEmployee || [])) {
    if (!row.employeeId) issues.push(`row missing employeeId`);
    if (!Number.isFinite(row.gross) || row.gross < 0) issues.push(`${row.employeeName || row.employeeId}: invalid gross`);
    if (row.validation && !row.validation.ok) {
      issues.push(`${row.employeeName || row.employeeId}: ${row.validation.issues.join("; ")}`);
    }
  }
  return issues;
}

function dateTag(s) {
  return String(s || "").replace(/-/g, "").slice(0, 8);
}

/** ADP RUN — standard CSV format. */
export function exportForADP(batch, perEmployee, employees = []) {
  const issues = validateBatchForExport(batch, perEmployee);
  if (issues.length) return { issues, format: "adp" };
  const eById = new Map(employees.map(e => [e.id, e]));
  const header = [
    "Company Code", "Batch ID", "File #", "Pay Date",
    "REG Hours", "REG Earnings",
    "OT Hours", "OT Earnings",
    "DT Hours", "DT Earnings",
    "Holiday Hours", "Holiday Earnings",
    "PTO Hours", "PTO Earnings",
    "Bonus", "Tips", "Service Charge",
    "Gross",
  ];
  const lines = [csvLine(header)];
  for (const row of perEmployee) {
    const emp = eById.get(row.employeeId) || {};
    const find = (code) => row.lines.find(l => l.code === code);
    lines.push(csvLine([
      "HOTELOPS",
      batch.id,
      emp.fileNumber || row.employeeId,
      batch.periodEnd,
      find("REG")?.hours || 0, round2(find("REG")?.amount || 0),
      find("OT")?.hours || 0,  round2(find("OT")?.amount || 0),
      find("DT")?.hours || 0,  round2(find("DT")?.amount || 0),
      find("HOL")?.hours || 0, round2(find("HOL")?.amount || 0),
      find("PTO")?.hours || 0, round2(find("PTO")?.amount || 0),
      round2(find("BONUS")?.amount || 0),
      round2((find("TIPS")?.amount || 0) + (find("TIPS_CC")?.amount || 0)),
      round2(find("SVC")?.amount || 0),
      round2(row.gross),
    ]));
  }
  return {
    format: "adp",
    filename: `ADP_payroll_${dateTag(batch.periodStart)}_${dateTag(batch.periodEnd)}_${batch.id}.csv`,
    content: lines.join("\n") + "\n",
    issues: [],
  };
}

/** Gusto — CSV importable into a pay run. */
export function exportForGusto(batch, perEmployee, employees = []) {
  const issues = validateBatchForExport(batch, perEmployee);
  if (issues.length) return { issues, format: "gusto" };
  const eById = new Map(employees.map(e => [e.id, e]));
  const header = [
    "Employee ID", "First Name", "Last Name",
    "Regular Hours", "Overtime Hours", "Double Overtime Hours",
    "Holiday Hours", "PTO Hours", "Sick Hours",
    "Bonus", "Cash Tips", "Credit Card Tips", "Service Charge",
    "Gross Pay",
  ];
  const lines = [csvLine(header)];
  for (const row of perEmployee) {
    const emp = eById.get(row.employeeId) || {};
    const find = (code) => row.lines.find(l => l.code === code);
    const split = (emp.name || row.employeeName || "").split(" ");
    lines.push(csvLine([
      row.employeeId, split[0] || "", split.slice(1).join(" "),
      find("REG")?.hours || 0,
      find("OT")?.hours || 0,
      find("DT")?.hours || 0,
      find("HOL")?.hours || 0,
      find("PTO")?.hours || 0,
      find("SICK")?.hours || 0,
      round2(find("BONUS")?.amount || 0),
      round2(find("TIPS")?.amount || 0),
      round2(find("TIPS_CC")?.amount || 0),
      round2(find("SVC")?.amount || 0),
      round2(row.gross),
    ]));
  }
  return {
    format: "gusto",
    filename: `Gusto_payroll_${dateTag(batch.periodEnd)}_${batch.id}.csv`,
    content: lines.join("\n") + "\n",
    issues: [],
  };
}

/** Paychex — fixed-column CSV. */
export function exportForPaychex(batch, perEmployee, employees = []) {
  const issues = validateBatchForExport(batch, perEmployee);
  if (issues.length) return { issues, format: "paychex" };
  const eById = new Map(employees.map(e => [e.id, e]));
  const header = ["Employee Number", "Name", "Pay Period End", "Earn Code", "Hours", "Amount"];
  const lines = [csvLine(header)];
  for (const row of perEmployee) {
    const emp = eById.get(row.employeeId) || {};
    for (const l of row.lines) {
      lines.push(csvLine([
        emp.employeeNumber || row.employeeId,
        row.employeeName,
        batch.periodEnd,
        l.code,
        round2(l.hours || 0),
        round2(l.amount || 0),
      ]));
    }
  }
  return {
    format: "paychex",
    filename: `Paychex_${dateTag(batch.periodEnd)}_${batch.id}.csv`,
    content: lines.join("\n") + "\n",
    issues: [],
  };
}

/** Paylocity — generic earn code CSV. */
export function exportForPaylocity(batch, perEmployee, employees = []) {
  const issues = validateBatchForExport(batch, perEmployee);
  if (issues.length) return { issues, format: "paylocity" };
  const eById = new Map(employees.map(e => [e.id, e]));
  const header = ["Company", "Employee ID", "Pay Period", "Earn Code", "Hours", "Earnings"];
  const lines = [csvLine(header)];
  for (const row of perEmployee) {
    const emp = eById.get(row.employeeId) || {};
    for (const l of row.lines) {
      lines.push(csvLine([
        "HOTELOPS",
        emp.paylocityId || row.employeeId,
        `${batch.periodStart} to ${batch.periodEnd}`,
        l.code,
        round2(l.hours || 0),
        round2(l.amount || 0),
      ]));
    }
  }
  return {
    format: "paylocity",
    filename: `Paylocity_${dateTag(batch.periodEnd)}_${batch.id}.csv`,
    content: lines.join("\n") + "\n",
    issues: [],
  };
}

/** Generic full-fidelity CSV — one row per pay-code line. */
export function exportGenericCsv(batch, perEmployee) {
  const issues = validateBatchForExport(batch, perEmployee);
  if (issues.length) return { issues, format: "csv" };
  const header = ["Batch ID", "Employee ID", "Employee Name", "Pay Period Start", "Pay Period End", "Pay Code", "Hours", "Rate", "Amount"];
  const lines = [csvLine(header)];
  for (const row of perEmployee) {
    for (const l of row.lines) {
      lines.push(csvLine([
        batch.id, row.employeeId, row.employeeName,
        batch.periodStart, batch.periodEnd,
        l.code, round2(l.hours || 0), round2(l.rate || 0), round2(l.amount || 0),
      ]));
    }
  }
  return {
    format: "csv",
    filename: `Payroll_${dateTag(batch.periodEnd)}_${batch.id}.csv`,
    content: lines.join("\n") + "\n",
    issues: [],
  };
}

export const EXPORTERS = {
  adp: exportForADP,
  gusto: exportForGusto,
  paychex: exportForPaychex,
  paylocity: exportForPaylocity,
  csv: exportGenericCsv,
};

export function exportFor(format, ...args) {
  const fn = EXPORTERS[format];
  if (!fn) throw new Error(`exportFor: unknown format "${format}"`);
  return fn(...args);
}
