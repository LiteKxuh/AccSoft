/* HotelOps · Schedule export
 * =================================================================
 * Department auto-classification + grid-aware PDF / Excel / CSV /
 * Print of the weekly schedule.
 *
 * The generic exporters in exporters.js produce a flat list-shaped
 * table — schedules are 2D (employee × day). This module renders
 * the schedule as a per-department block with one row per employee
 * and 7 day columns, plus a weekly hours total per row and a
 * department subtotal.
 */

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/* ---------- Department classification ---------- */

const DEPT_RULES = [
  { dept: "Front Office",     keywords: ["front desk", "agent", "night audit", "concierge", "reservation", "bellman", "valet"] },
  { dept: "Housekeeping",     keywords: ["housekeep", "room attendant", "laundry", "linen", "turn", "houseman", "executive housekeep"] },
  { dept: "Engineering",      keywords: ["engineer", "maintenance", "tech", "groundskeeper", "facilit"] },
  { dept: "Food & Beverage",  keywords: ["server", "cook", "chef", "kitchen", "restaurant", "bar", "bartender", "barista", "banquet", "catering", "host", "f&b", "food"] },
  { dept: "Sales & Marketing",keywords: ["sales", "marketing", "revenue manager", "events"] },
  { dept: "Administrative",   keywords: ["general manager", " gm", "office", "controller", "accountant", "hr", "human resource", "admin", "manager"] },
  { dept: "Security",         keywords: ["security", "guard", "loss prevention"] },
  { dept: "Spa & Recreation", keywords: ["spa", "wellness", "massage", "therapist", "fitness", "pool"] },
];

/**
 * Map a free-text title or position to one of the standard hotel departments.
 * Falls back to "Other" if nothing matches.
 *
 * @param {string} text  Employee.title, shift.position, etc.
 * @returns {string} Department label
 */
export function classifyDepartment(text) {
  if (!text) return "Other";
  const t = String(text).toLowerCase();
  for (const rule of DEPT_RULES) {
    for (const kw of rule.keywords) {
      if (t.includes(kw)) return rule.dept;
    }
  }
  return "Other";
}

/**
 * Pick the best department label for an employee, preferring an explicit
 * `department` field if present, else inferring from title or shift position.
 */
export function employeeDepartment(emp, theirShifts = []) {
  if (emp?.department) return emp.department;
  if (emp?.title) return classifyDepartment(emp.title);
  // fall back to most-used shift position
  if (theirShifts.length) {
    const counts = {};
    theirShifts.forEach(s => { counts[s.position] = (counts[s.position] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) return classifyDepartment(top[0]);
  }
  return "Other";
}

export const DEPARTMENT_ORDER = [
  "Front Office",
  "Housekeeping",
  "Food & Beverage",
  "Engineering",
  "Sales & Marketing",
  "Spa & Recreation",
  "Security",
  "Administrative",
  "Other",
];

/**
 * Group employees by department, returning ordered department buckets.
 * Each bucket: { department, employees: [...] }
 */
export function groupByDepartment(employees, schedule) {
  const buckets = {};
  employees.forEach((emp) => {
    const empShifts = (schedule || []).filter(s => s.employeeId === emp.id);
    const dept = employeeDepartment(emp, empShifts);
    (buckets[dept] = buckets[dept] || []).push(emp);
  });
  return DEPARTMENT_ORDER
    .filter(d => buckets[d])
    .concat(Object.keys(buckets).filter(d => !DEPARTMENT_ORDER.includes(d)))
    .map(d => ({ department: d, employees: buckets[d].sort((a, b) => (a.lastName || "").localeCompare(b.lastName || "")) }));
}

/* ---------- Shift formatters ---------- */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftHours(s) {
  if (!s?.startTime || !s?.endTime) return 0;
  const [sh, sm] = s.startTime.split(":").map(Number);
  const [eh, em] = s.endTime.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const hr = h % 12 || 12;
  const ampm = h >= 12 ? "p" : "a";
  return m ? `${hr}:${String(m).padStart(2, "0")}${ampm}` : `${hr}${ampm}`;
}

function shiftCellText(s, pto) {
  if (pto) return `PTO\n${pto.type || ""}`;
  if (!s) return "";
  const t = `${fmtTime(s.startTime)}-${fmtTime(s.endTime)}`;
  return s.position ? `${t}\n${s.position}` : t;
}

function dateIso(d) {
  return d.toISOString().slice(0, 10);
}

function buildScheduleGrid({ employees, schedule, ptoRequests, days }) {
  // returns groups: [{ department, rows: [{ employee, cells:[7], totalHours, byDayHours:[7] }] }]
  const groups = groupByDepartment(employees, schedule);
  return groups.map((g) => {
    const rows = g.employees.map((emp) => {
      const cells = days.map((d) => {
        const dStr = dateIso(d);
        const sc = (schedule || []).find(s => s.employeeId === emp.id && s.date === dStr);
        const pto = (ptoRequests || []).find(r =>
          r.employeeId === emp.id && r.status === "approved" && dStr >= r.startDate && dStr <= r.endDate
        );
        return { shift: sc, pto, hours: sc ? shiftHours(sc) : 0 };
      });
      return {
        employee: emp,
        cells,
        totalHours: cells.reduce((s, c) => s + c.hours, 0),
      };
    });
    const deptHours = rows.reduce((s, r) => s + r.totalHours, 0);
    return { department: g.department, rows, deptHours };
  });
}

/* ---------- PDF ---------- */

const today = () => new Date().toISOString().slice(0, 10);
const safeName = (s) => String(s || "schedule").replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "");

export function exportSchedulePDF({ employees, schedule, ptoRequests, days, propertyName, weekLabel, filename = "Schedule" }) {
  const groups = buildScheduleGrid({ employees, schedule, ptoRequests, days });
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(28, 25, 23);
  doc.rect(0, 0, pageW, 56, "F");
  doc.setTextColor(245, 158, 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("HOTELOPS", 32, 22);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text("Weekly Schedule", 32, 42);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text([propertyName, weekLabel].filter(Boolean).join("  ·  "), pageW - 32, 28, { align: "right" });
  doc.setFontSize(7);
  doc.setTextColor(168, 162, 158);
  doc.text(`Generated ${today()}`, pageW - 32, 42, { align: "right" });

  let cursorY = 76;

  const totalPropHours = groups.reduce((s, g) => s + g.deptHours, 0);

  // Summary strip — one tile per department
  if (groups.length) {
    const tileW = (pageW - 64) / Math.min(groups.length, 6);
    const visibleDepts = groups.slice(0, 6);
    visibleDepts.forEach((g, i) => {
      const x = 32 + i * tileW;
      doc.setDrawColor(231, 229, 228);
      doc.setFillColor(250, 250, 249);
      doc.roundedRect(x, cursorY, tileW - 6, 36, 4, 4, "FD");
      doc.setFontSize(7);
      doc.setTextColor(120, 113, 108);
      doc.text(g.department.toUpperCase(), x + 8, cursorY + 12);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(28, 25, 23);
      doc.text(`${g.deptHours.toFixed(1)}h · ${g.rows.length} ppl`, x + 8, cursorY + 28);
      doc.setFont("helvetica", "normal");
    });
    cursorY += 48;
  }

  // Per-department table
  groups.forEach((g) => {
    if (cursorY > 460) {
      doc.addPage();
      cursorY = 60;
    }
    // Department header
    doc.setFillColor(180, 83, 9);
    doc.rect(32, cursorY, pageW - 64, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(g.department, 40, cursorY + 14);
    doc.setFontSize(8);
    doc.text(`${g.rows.length} ${g.rows.length === 1 ? "person" : "people"} · ${g.deptHours.toFixed(1)} hrs`, pageW - 40, cursorY + 14, { align: "right" });
    cursorY += 22;

    const head = [["Employee", ...days.map(d => `${DAY_NAMES[d.getDay()]} ${d.getDate()}`), "Total"]];
    const body = g.rows.map((r) => {
      const cells = r.cells.map(c => shiftCellText(c.shift, c.pto));
      return [
        `${r.employee.firstName || ""} ${r.employee.lastName || ""}\n${r.employee.title || ""}`,
        ...cells,
        `${r.totalHours.toFixed(1)}h`,
      ];
    });
    // Department footer row
    const dayTotals = days.map((_, i) => g.rows.reduce((s, r) => s + (r.cells[i]?.hours || 0), 0));
    body.push(["Dept Total", ...dayTotals.map(h => h ? `${h.toFixed(1)}h` : ""), `${g.deptHours.toFixed(1)}h`]);

    autoTable(doc, {
      head,
      body,
      startY: cursorY,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 4, lineColor: [231, 229, 228], lineWidth: 0.4, valign: "middle" },
      headStyles: { fillColor: [41, 37, 36], textColor: 255, fontStyle: "bold", fontSize: 7 },
      alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: {
        0: { cellWidth: 110, halign: "left" },
        8: { cellWidth: 44, halign: "right", fontStyle: "bold" },
      },
      didParseCell: (data) => {
        // Department total row
        if (data.row.index === body.length - 1) {
          data.cell.styles.fillColor = [231, 229, 228];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = [28, 25, 23];
        }
        // PTO cells
        const text = (data.cell?.raw || "").toString();
        if (text.startsWith("PTO")) {
          data.cell.styles.fillColor = [243, 232, 255];
          data.cell.styles.textColor = [88, 28, 135];
        }
      },
      margin: { left: 32, right: 32 },
      didDrawPage: () => {
        const ph = doc.internal.pageSize.getHeight();
        doc.setFontSize(7);
        doc.setTextColor(168, 162, 158);
        doc.text(`HotelOps · ${propertyName || ""} · ${weekLabel || ""}`, 32, ph - 18);
        doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageW - 32, ph - 18, { align: "right" });
      },
    });
    cursorY = doc.lastAutoTable.finalY + 18;
  });

  // Property total at the very end
  if (groups.length > 1) {
    if (cursorY > 540) { doc.addPage(); cursorY = 60; }
    doc.setFillColor(28, 25, 23);
    doc.rect(32, cursorY, pageW - 64, 26, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PROPERTY TOTAL", 40, cursorY + 17);
    doc.text(`${totalPropHours.toFixed(1)} hours`, pageW - 40, cursorY + 17, { align: "right" });
  }

  doc.save(`${safeName(filename)}_${today()}.pdf`);
}

/* ---------- Excel ---------- */

export function exportScheduleExcel({ employees, schedule, ptoRequests, days, propertyName, weekLabel, filename = "Schedule" }) {
  const groups = buildScheduleGrid({ employees, schedule, ptoRequests, days });
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryAOA = [
    ["Weekly Schedule"],
    [propertyName || "", weekLabel || ""],
    [],
    ["Department", "People", "Total Hours"],
    ...groups.map(g => [g.department, g.rows.length, Number(g.deptHours.toFixed(2))]),
    ["Property Total", groups.reduce((s, g) => s + g.rows.length, 0), Number(groups.reduce((s, g) => s + g.deptHours, 0).toFixed(2))],
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryAOA);
  summary["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, summary, "Summary");

  // One sheet per department + a combined sheet
  const dayHeaders = days.map(d => `${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`);
  const writeGrid = (rows, sheetName) => {
    const aoa = [
      ["Department", "Employee", "Title", ...dayHeaders, "Total Hrs"],
      ...rows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }, ...dayHeaders.map(() => ({ wch: 14 })), { wch: 10 }];
    return ws;
  };

  // Combined "All Departments"
  const combined = [];
  groups.forEach((g) => {
    g.rows.forEach((r) => {
      combined.push([
        g.department,
        `${r.employee.firstName || ""} ${r.employee.lastName || ""}`.trim(),
        r.employee.title || "",
        ...r.cells.map(c => c.pto ? `PTO · ${c.pto.type || ""}` : c.shift ? `${c.shift.startTime}-${c.shift.endTime} ${c.shift.position || ""}` : ""),
        Number(r.totalHours.toFixed(2)),
      ]);
    });
  });
  XLSX.utils.book_append_sheet(wb, writeGrid(combined, "All"), "All");

  groups.forEach((g) => {
    const rows = g.rows.map((r) => [
      g.department,
      `${r.employee.firstName || ""} ${r.employee.lastName || ""}`.trim(),
      r.employee.title || "",
      ...r.cells.map(c => c.pto ? `PTO · ${c.pto.type || ""}` : c.shift ? `${c.shift.startTime}-${c.shift.endTime} ${c.shift.position || ""}` : ""),
      Number(r.totalHours.toFixed(2)),
    ]);
    XLSX.utils.book_append_sheet(wb, writeGrid(rows, g.department), g.department.slice(0, 31));
  });

  XLSX.writeFile(wb, `${safeName(filename)}_${today()}.xlsx`);
}

/* ---------- CSV ---------- */

export function exportScheduleCSV({ employees, schedule, ptoRequests, days, filename = "Schedule" }) {
  const groups = buildScheduleGrid({ employees, schedule, ptoRequests, days });
  const dayHeaders = days.map(d => `${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`);
  const lines = [["Department", "Employee", "Title", ...dayHeaders, "Total Hrs"].map(csvEscape).join(",")];
  groups.forEach((g) => {
    g.rows.forEach((r) => {
      const row = [
        g.department,
        `${r.employee.firstName || ""} ${r.employee.lastName || ""}`.trim(),
        r.employee.title || "",
        ...r.cells.map(c => c.pto ? `PTO ${c.pto.type || ""}` : c.shift ? `${c.shift.startTime}-${c.shift.endTime} ${c.shift.position || ""}` : ""),
        r.totalHours.toFixed(2),
      ];
      lines.push(row.map(csvEscape).join(","));
    });
  });
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(filename)}_${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* ---------- Print ---------- */

export function exportSchedulePrint({ employees, schedule, ptoRequests, days, propertyName, weekLabel }) {
  const groups = buildScheduleGrid({ employees, schedule, ptoRequests, days });
  const dayHeaders = days.map(d => `${DAY_NAMES[d.getDay()]}<br/><span class="dnum">${d.getMonth() + 1}/${d.getDate()}</span>`);

  const totalHours = groups.reduce((s, g) => s + g.deptHours, 0);

  const groupsHtml = groups.map(g => `
    <section class="dept">
      <h2>${escapeHtml(g.department)} <span class="meta">· ${g.rows.length} people · ${g.deptHours.toFixed(1)} hrs</span></h2>
      <table>
        <thead>
          <tr>
            <th class="emp">Employee</th>
            ${dayHeaders.map(h => `<th>${h}</th>`).join("")}
            <th class="r">Total</th>
          </tr>
        </thead>
        <tbody>
          ${g.rows.map(r => `
            <tr>
              <td class="emp">
                <div class="name">${escapeHtml(`${r.employee.firstName || ""} ${r.employee.lastName || ""}`.trim())}</div>
                <div class="title">${escapeHtml(r.employee.title || "")}</div>
              </td>
              ${r.cells.map(c => {
                if (c.pto) return `<td class="pto"><div class="t">PTO</div><div class="sub">${escapeHtml(c.pto.type || "")}</div></td>`;
                if (!c.shift) return `<td class="empty">·</td>`;
                return `<td class="shift"><div class="t tabular">${escapeHtml(`${fmtTime(c.shift.startTime)}–${fmtTime(c.shift.endTime)}`)}</div><div class="sub">${escapeHtml(c.shift.position || "")}</div></td>`;
              }).join("")}
              <td class="r tabular">${r.totalHours.toFixed(1)}h</td>
            </tr>
          `).join("")}
          <tr class="dept-total">
            <td class="emp">Department Total</td>
            ${days.map((_, i) => {
              const h = g.rows.reduce((s, r) => s + (r.cells[i]?.hours || 0), 0);
              return `<td class="r tabular">${h ? h.toFixed(1) + "h" : ""}</td>`;
            }).join("")}
            <td class="r tabular"><strong>${g.deptHours.toFixed(1)}h</strong></td>
          </tr>
        </tbody>
      </table>
    </section>
  `).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Schedule · ${escapeHtml(weekLabel || "")}</title>
<style>
  *{box-sizing:border-box}
  body{font:11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;margin:24px;background:white}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1c1917;padding-bottom:8px;margin-bottom:14px}
  .brand{font-size:9px;color:#b45309;font-weight:800;letter-spacing:.18em}
  h1{font-size:22px;margin:4px 0 0;font-weight:700}
  .meta{font-size:11px;color:#78716c;font-weight:400}
  .right{text-align:right;font-size:11px;color:#57534e}
  .right strong{display:block;font-size:14px;color:#1c1917}
  .dept{margin:0 0 18px;page-break-inside:avoid}
  .dept h2{margin:0 0 6px;font-size:13px;font-weight:700;background:#b45309;color:white;padding:5px 10px;border-radius:3px}
  .dept h2 .meta{color:#fbbf24;font-weight:400;font-size:10px;margin-left:6px}
  table{width:100%;border-collapse:collapse;border:1px solid #d6d3d1}
  thead th{background:#1c1917;color:white;text-align:center;padding:6px 4px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.04em;border-right:1px solid #44403c}
  thead th.emp{text-align:left;width:160px}
  thead th .dnum{display:block;font-weight:400;color:#fbbf24}
  tbody td{padding:6px 4px;text-align:center;border-bottom:1px solid #f1f0ee;border-right:1px solid #f1f0ee;vertical-align:middle}
  tbody td.emp{text-align:left;width:160px}
  tbody td.emp .name{font-weight:600;color:#1c1917}
  tbody td.emp .title{font-size:9px;color:#78716c}
  td.shift .t{font-weight:600}
  td.shift .sub{font-size:9px;color:#a8a29e;margin-top:2px}
  td.pto{background:#f5f3ff;color:#5b21b6}
  td.pto .t{font-weight:700}
  td.pto .sub{font-size:9px;color:#7c3aed}
  td.empty{color:#d6d3d1}
  td.r{text-align:right}
  .tabular{font-variant-numeric:tabular-nums}
  tr.dept-total td{background:#fafaf9;font-weight:600;color:#57534e;border-top:2px solid #d6d3d1}
  footer{margin-top:14px;font-size:9px;color:#a8a29e;display:flex;justify-content:space-between;border-top:1px solid #e7e5e4;padding-top:6px}
  @media print {
    body{margin:0.4in 0.3in}
    .dept{page-break-inside:avoid}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
    @page { size: landscape; margin: 0.4in 0.3in; }
  }
</style></head><body>
  <header>
    <div>
      <div class="brand">HOTELOPS</div>
      <h1>Weekly Schedule</h1>
      <div class="meta">${escapeHtml(propertyName || "")}${propertyName && weekLabel ? " · " : ""}${escapeHtml(weekLabel || "")}</div>
    </div>
    <div class="right">
      <span>Total weekly hours</span>
      <strong>${totalHours.toFixed(1)}h</strong>
    </div>
  </header>
  ${groupsHtml || `<p style="color:#78716c">No employees scheduled this week.</p>`}
  <footer>
    <span>Generated ${today()}</span>
    <span>HotelOps</span>
  </footer>
  <script>window.addEventListener("load",()=>{setTimeout(()=>{window.print();},150);});</script>
</body></html>`;

  const w = window.open("", "_blank", "width=1200,height=900");
  if (!w) {
    window.print();
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Dispatch ---------- */

export function exportSchedule(format, opts) {
  switch (format) {
    case "pdf":   return exportSchedulePDF(opts);
    case "excel": case "xlsx": return exportScheduleExcel(opts);
    case "csv":   return exportScheduleCSV(opts);
    case "print": return exportSchedulePrint(opts);
    default: throw new Error(`Unknown export format: ${format}`);
  }
}
