/* HotelOps · ScheduleExportMenu
 *
 * Small dropdown that exports the weekly schedule via scheduleExport.js.
 * Mirrors the look of ExportMenu but knows about the schedule grid shape.
 */

import { useEffect, useRef, useState } from "react";
import { Download, FileText, FileSpreadsheet, Printer, ChevronDown } from "lucide-react";
import { exportSchedule } from "./scheduleExport.js";
import { useToast } from "./toast.jsx";

export function ScheduleExportMenu({ employees, schedule, ptoRequests, days, propertyName, weekLabel, filename = "Schedule" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const toast = (() => { try { return useToast(); } catch { return null; } })();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const noData = !employees || employees.length === 0;

  const run = (format) => {
    setOpen(false);
    if (noData) return;
    try {
      exportSchedule(format, { employees, schedule, ptoRequests, days, propertyName, weekLabel, filename });
      toast?.push?.(`Schedule exported · ${format.toUpperCase()}`, { tone: "success" });
    } catch (e) {
      console.error(e);
      toast?.push?.(`Export failed: ${e.message}`, { tone: "error" });
    }
  };

  const items = [
    { id: "pdf",   label: "PDF",   sub: "Department-grouped, print-ready", icon: FileText },
    { id: "excel", label: "Excel", sub: "Multi-sheet workbook (one per dept)", icon: FileSpreadsheet },
    { id: "csv",   label: "CSV",   sub: "All employees, flat", icon: FileSpreadsheet },
    { id: "print", label: "Print", sub: "Open print dialog", icon: Printer },
  ];

  return (
    <div ref={ref} className="relative inline-block no-print" data-no-print>
      <button
        type="button"
        onClick={() => !noData && setOpen(!open)}
        disabled={noData}
        className="px-3 py-1.5 text-xs font-medium rounded-md bg-white text-stone-900 border border-stone-300 hover:bg-stone-50 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed font-body"
        title={noData ? "No employees on this schedule" : "Export this schedule"}
      >
        <Download size={12} />
        Export
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-72 bg-white border border-stone-200 rounded-lg shadow-xl overflow-hidden font-body right-0">
          <div className="px-3 py-2 border-b border-stone-100 bg-stone-50">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold">Schedule export · grouped by department</div>
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

export default ScheduleExportMenu;
