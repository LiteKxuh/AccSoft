/* HotelOps · Universal export utilities
 * =================================================================
 * exportCSV   — RFC-4180-ish CSV via Blob
 * exportExcel — multi-sheet .xlsx via SheetJS (xlsx)
 * exportPDF   — landscape PDF report via jsPDF + autoTable
 * exportPrint — opens a clean printable window with the table
 *
 * All four take the same row/column shape so callers can pick at runtime:
 *
 *   columns: [{ key, label, type?, width?, money?, pct?, align? }]
 *   rows:    [{ [key]: value, ... }]
 *
 * Optional metadata for PDF / Excel / Print:
 *   title, subtitle, propertyName, period, footer, summary[]
 */

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const today = () => new Date().toISOString().slice(0, 10);
const safeName = (s) => String(s || "export").replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "");

function formatValue(v, col) {
  if (v == null || v === "") return "";
  if (col?.money) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  if (col?.pct) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return `${(n * 100).toFixed(1)}%`;
  }
  if (col?.type === "date") {
    return String(v).slice(0, 10);
  }
  return String(v);
}

function rawValue(v) {
  if (v == null) return "";
  if (typeof v === "number" && !Number.isFinite(v)) return "";
  return v;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- CSV ---------- */

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCSV({ filename, columns, rows, includeBOM = true }) {
  const header = columns.map(c => csvEscape(c.label || c.key)).join(",");
  const body = rows.map(r => columns.map(c => csvEscape(rawValue(r[c.key]))).join(",")).join("\r\n");
  const csv = (includeBOM ? "﻿" : "") + header + "\r\n" + body + "\r\n";
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${safeName(filename)}_${today()}.csv`);
}

/* ---------- Excel (.xlsx) ---------- */

/** Single-sheet helper. Pass `sheets` to write multiple. */
export function exportExcel({ filename, columns, rows, sheets, sheetName = "Sheet1", title, subtitle }) {
  const wb = XLSX.utils.book_new();
  const sheetList = sheets || [{ name: sheetName, columns, rows, title, subtitle }];
  sheetList.forEach((s) => {
    const aoa = [];
    if (s.title) aoa.push([s.title]);
    if (s.subtitle) aoa.push([s.subtitle]);
    if (s.title || s.subtitle) aoa.push([]);
    aoa.push(s.columns.map(c => c.label || c.key));
    s.rows.forEach(r => {
      aoa.push(s.columns.map(c => {
        const v = r[c.key];
        if (c.money || c.pct) {
          const n = Number(v);
          return Number.isFinite(n) ? n : "";
        }
        return rawValue(v);
      }));
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // column widths
    ws["!cols"] = s.columns.map(c => ({ wch: c.width || Math.max(12, (c.label || c.key).length + 4) }));
    // number formats
    const headerRowIdx = (s.title ? 1 : 0) + (s.subtitle ? 1 : 0) + (s.title || s.subtitle ? 1 : 0);
    for (let i = 0; i < s.rows.length; i++) {
      s.columns.forEach((c, ci) => {
        const cellRef = XLSX.utils.encode_cell({ r: headerRowIdx + 1 + i, c: ci });
        const cell = ws[cellRef];
        if (!cell) return;
        if (c.money) cell.z = '"$"#,##0.00;[Red]-"$"#,##0.00';
        else if (c.pct) cell.z = "0.0%";
      });
    }
    XLSX.utils.book_append_sheet(wb, ws, (s.name || "Sheet").slice(0, 31));
  });
  XLSX.writeFile(wb, `${safeName(filename)}_${today()}.xlsx`);
}

/* ---------- PDF ---------- */

export function exportPDF({ filename, title, subtitle, propertyName, period, columns, rows, summary, footer, orientation = "landscape" }) {
  const doc = new jsPDF({ orientation, unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  let cursor = 36;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(180, 83, 9);
  doc.text("HOTELOPS", 40, cursor);
  doc.setTextColor(120, 113, 108);
  doc.setFont("helvetica", "normal");
  doc.text(today(), pageW - 40, cursor, { align: "right" });
  cursor += 14;
  doc.setFontSize(16);
  doc.setTextColor(28, 25, 23);
  doc.setFont("helvetica", "bold");
  doc.text(title || filename || "Report", 40, cursor);
  cursor += 6;
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 113, 108);
    cursor += 12;
    doc.text(subtitle, 40, cursor);
  }
  if (propertyName || period) {
    cursor += 12;
    doc.setFontSize(9);
    doc.setTextColor(87, 83, 78);
    const meta = [propertyName, period].filter(Boolean).join("  ·  ");
    doc.text(meta, 40, cursor);
  }
  cursor += 14;

  // Optional summary tiles
  if (Array.isArray(summary) && summary.length) {
    const tileW = (pageW - 80) / summary.length;
    summary.forEach((tile, i) => {
      const x = 40 + i * tileW;
      doc.setDrawColor(231, 229, 228);
      doc.setFillColor(250, 250, 249);
      doc.roundedRect(x, cursor, tileW - 8, 38, 4, 4, "FD");
      doc.setFontSize(7);
      doc.setTextColor(120, 113, 108);
      doc.text(String(tile.label || "").toUpperCase(), x + 8, cursor + 14);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(28, 25, 23);
      doc.text(String(tile.value || ""), x + 8, cursor + 30);
      doc.setFont("helvetica", "normal");
    });
    cursor += 50;
  }

  // Body table
  autoTable(doc, {
    startY: cursor,
    head: [columns.map(c => c.label || c.key)],
    body: rows.map(r => columns.map(c => formatValue(r[c.key], c))),
    styles: { font: "helvetica", fontSize: 8, cellPadding: 5, lineColor: [231, 229, 228], lineWidth: 0.4 },
    headStyles: { fillColor: [28, 25, 23], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: columns.reduce((acc, c, i) => {
      acc[i] = { halign: c.align || (c.money || c.pct || c.type === "number" ? "right" : "left") };
      if (c.width) acc[i].cellWidth = c.width;
      return acc;
    }, {}),
    margin: { left: 40, right: 40 },
    didDrawPage: (data) => {
      // footer
      const ph = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setTextColor(168, 162, 158);
      const pageStr = `Page ${doc.getCurrentPageInfo().pageNumber}`;
      if (footer) doc.text(footer, 40, ph - 20);
      doc.text(pageStr, pageW - 40, ph - 20, { align: "right" });
    },
  });

  doc.save(`${safeName(filename)}_${today()}.pdf`);
}

/* ---------- Print ---------- */

/**
 * Opens a popup window with a clean, printable HTML rendering of the table
 * and triggers print(). Falls back to in-place window.print() if the popup
 * is blocked.
 */
export function exportPrint({ title, subtitle, propertyName, period, columns, rows, summary, footer }) {
  const headHtml = columns.map(c => `<th class="${c.money || c.pct ? 'r' : ''}">${escapeHtml(c.label || c.key)}</th>`).join("");
  const bodyHtml = rows.map(r => `<tr>${columns.map(c => `<td class="${c.money || c.pct ? 'r tabular' : ''}">${escapeHtml(formatValue(r[c.key], c))}</td>`).join("")}</tr>`).join("");
  const summaryHtml = (summary || []).map(s => `<div class="tile"><div class="tile-l">${escapeHtml(s.label)}</div><div class="tile-v">${escapeHtml(s.value)}</div></div>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title || "Report")}</title>
<style>
  *{box-sizing:border-box}
  body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;margin:32px;background:white}
  .brand{font-size:10px;color:#b45309;font-weight:700;letter-spacing:.16em}
  h1{font-size:22px;margin:6px 0 4px;font-weight:700}
  h2{font-size:13px;margin:0 0 4px;color:#78716c;font-weight:400}
  .meta{font-size:11px;color:#57534e;margin-bottom:14px}
  .tiles{display:flex;gap:8px;margin:10px 0 14px}
  .tile{flex:1;border:1px solid #e7e5e4;border-radius:6px;padding:8px 10px;background:#fafaf9}
  .tile-l{font-size:9px;color:#78716c;text-transform:uppercase;letter-spacing:.08em}
  .tile-v{font-size:15px;font-weight:700;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  thead th{background:#1c1917;color:white;text-align:left;padding:7px 10px;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  tbody td{padding:6px 10px;border-bottom:1px solid #f1f0ee}
  tbody tr:nth-child(even) td{background:#fafaf9}
  .r{text-align:right}
  .tabular{font-variant-numeric:tabular-nums}
  .footer{margin-top:18px;font-size:10px;color:#a8a29e;display:flex;justify-content:space-between}
  @media print {
    body{margin:0.5in}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
    .no-print{display:none}
  }
</style></head><body>
  <div class="brand">HOTELOPS</div>
  <h1>${escapeHtml(title || "Report")}</h1>
  ${subtitle ? `<h2>${escapeHtml(subtitle)}</h2>` : ""}
  <div class="meta">${escapeHtml([propertyName, period].filter(Boolean).join(" · "))}</div>
  ${summaryHtml ? `<div class="tiles">${summaryHtml}</div>` : ""}
  <table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
  <div class="footer"><span>${escapeHtml(footer || "")}</span><span>Generated ${today()}</span></div>
  <script>window.addEventListener("load",()=>{setTimeout(()=>{window.print();},150);});</script>
</body></html>`;
  const w = window.open("", "_blank", "width=1100,height=820");
  if (!w) {
    // popup blocked — print current page (will be ugly but functional)
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

/* ---------- Convenience: dispatch by format ---------- */

export function exportData(format, opts) {
  switch (format) {
    case "csv":   return exportCSV(opts);
    case "excel": case "xlsx": return exportExcel(opts);
    case "pdf":   return exportPDF(opts);
    case "print": return exportPrint(opts);
    case "json":  {
      const json = JSON.stringify(opts.rows, null, 2);
      downloadBlob(new Blob([json], { type: "application/json" }), `${safeName(opts.filename)}_${today()}.json`);
      return;
    }
    default: throw new Error(`Unknown export format: ${format}`);
  }
}
