/* HotelOps · ExportMenu
 *
 * A dropdown button that lets the user export the current view as
 * PDF / Excel / CSV / Print.
 *
 * Usage:
 *   <ExportMenu
 *     filename="P&L"
 *     title="Profit & Loss"
 *     subtitle="Period 2026-05"
 *     propertyName="Sunrise Suites"
 *     period="May 2026"
 *     summary={[{ label: "MTD Revenue", value: "$284,500" }]}
 *     columns={[{ key: "account", label: "Account" }, { key: "mtd", label: "MTD", money: true }]}
 *     rows={[...]}
 *   />
 */

import { useEffect, useRef, useState } from "react";
import { Download, FileText, FileSpreadsheet, Printer, ChevronDown, FileJson } from "lucide-react";
import { exportData } from "./exporters.js";
import { useToast } from "./toast.jsx";

export function ExportMenu({
  filename,
  title,
  subtitle,
  propertyName,
  period,
  summary,
  footer,
  columns,
  rows,
  formats = ["pdf", "excel", "csv", "print"],
  size = "sm",
  variant = "secondary",
  align = "right",
  className = "",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const toast = (() => { try { return useToast(); } catch { return null; } })();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const sizeCls = size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs";
  const variantCls = variant === "primary"
    ? "bg-stone-900 text-white hover:bg-stone-800"
    : "bg-white text-stone-900 border border-stone-300 hover:bg-stone-50";

  const noData = !rows || rows.length === 0;
  const isDisabled = disabled || noData;

  const run = (format) => {
    setOpen(false);
    if (isDisabled) return;
    try {
      exportData(format, { filename, title, subtitle, propertyName, period, summary, footer, columns, rows });
      toast?.push?.(`Exported ${format.toUpperCase()}`, { tone: "success" });
    } catch (e) {
      console.error(e);
      toast?.push?.(`Export failed: ${e.message}`, { tone: "error" });
    }
  };

  const items = [
    formats.includes("pdf")   && { id: "pdf",   label: "PDF",        sub: "Print-ready report",   icon: FileText },
    formats.includes("excel") && { id: "excel", label: "Excel",      sub: ".xlsx workbook",       icon: FileSpreadsheet },
    formats.includes("csv")   && { id: "csv",   label: "CSV",        sub: "Plain text · all rows", icon: FileSpreadsheet },
    formats.includes("json")  && { id: "json",  label: "JSON",       sub: "Raw data dump",        icon: FileJson },
    formats.includes("print") && { id: "print", label: "Print",      sub: "Open print dialog",    icon: Printer },
  ].filter(Boolean);

  return (
    <div ref={ref} className={`relative inline-block no-print ${className}`} data-no-print>
      <button
        type="button"
        onClick={() => !isDisabled && setOpen(!open)}
        disabled={isDisabled}
        className={`${variantCls} ${sizeCls} font-medium rounded-md transition-colors inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed font-body`}
        title={noData ? "No data to export" : "Export this view"}
      >
        <Download size={size === "md" ? 14 : 12} />
        Export
        <ChevronDown size={size === "md" ? 14 : 12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute z-40 mt-1 w-64 bg-white border border-stone-200 rounded-lg shadow-xl overflow-hidden font-body ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="px-3 py-2 border-b border-stone-100 bg-stone-50">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold">Export · {rows?.length ?? 0} rows</div>
          </div>
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => run(it.id)}
              className="w-full text-left px-3 py-2.5 hover:bg-amber-50 flex items-start gap-3 border-b border-stone-100 last:border-b-0 transition-colors"
            >
              <it.icon size={16} className="mt-0.5 text-stone-700 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-stone-900">{it.label}</div>
                <div className="text-[11px] text-stone-500 truncate">{it.sub}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExportMenu;
