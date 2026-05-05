/* HotelOps · ImportExcelDialog
 *
 * Modal that walks the user through:
 *   1. Pick a file (.xlsx / .xls / .csv)
 *   2. Pick which sheet to import (if multiple)
 *   3. Map columns to the target schema (auto-suggested, editable)
 *   4. Preview the first ~10 rows of mapped data
 *   5. Confirm → onImport(mappedRows)
 *
 * Usage:
 *   <ImportExcelDialog
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     title="Import Vendor Invoices"
 *     subtitle="Match your Excel/CSV columns to the invoice fields below."
 *     schema={INVOICE_SCHEMA}
 *     onImport={(rows) => { ... }}
 *   />
 */

import { useEffect, useMemo, useState } from "react";
import { X, Upload, FileSpreadsheet, Check, AlertCircle, ChevronRight } from "lucide-react";
import {
  readWorkbook,
  suggestMapping,
  applyMapping,
  guessHeaderRow,
} from "./excelImport.js";
import { useToast } from "./toast.jsx";

export function ImportExcelDialog({
  open,
  onClose,
  title = "Import from Excel",
  subtitle,
  schema,
  onImport,
  acceptedFormats = ".xlsx,.xls,.csv",
  helpText,
}) {
  const [step, setStep] = useState("pick");   // pick | map | preview
  const [file, setFile] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerIdx, setHeaderIdx] = useState(0);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toast = (() => { try { return useToast(); } catch { return null; } })();

  useEffect(() => {
    if (!open) {
      // reset on close
      setStep("pick"); setFile(null); setWorkbook(null); setSheetIdx(0); setHeaderIdx(0); setMapping({}); setError(null); setBusy(false);
    }
  }, [open]);

  const sheet = workbook?.sheets?.[sheetIdx];
  const aoa = sheet?.aoa || [];
  const headers = useMemo(() => {
    const row = aoa[headerIdx] || [];
    return row.map((h, i) => (h == null || h === "" ? `Column ${i + 1}` : String(h).trim()));
  }, [aoa, headerIdx]);
  const dataRows = useMemo(() => {
    return aoa.slice(headerIdx + 1).filter((r) => r && r.some((c) => c != null && c !== ""));
  }, [aoa, headerIdx]);

  const handleFile = async (f) => {
    if (!f) return;
    setError(null);
    setBusy(true);
    setFile(f);
    try {
      const wb = await readWorkbook(f);
      if (!wb.sheets.length) throw new Error("No sheets found in file");
      setWorkbook(wb);
      setSheetIdx(0);
      setHeaderIdx(wb.sheets[0].headerIdx);
      // auto-map using first sheet
      const { mapping: m } = suggestMapping(wb.sheets[0].headers, schema);
      setMapping(m);
      setStep("map");
    } catch (e) {
      console.error(e);
      setError(e.message || "Could not read this file.");
    } finally {
      setBusy(false);
    }
  };

  const onChangeSheet = (idx) => {
    setSheetIdx(idx);
    const sh = workbook.sheets[idx];
    setHeaderIdx(sh.headerIdx);
    const { mapping: m } = suggestMapping(sh.headers, schema);
    setMapping(m);
  };

  const onChangeHeaderRow = (idx) => {
    setHeaderIdx(idx);
    const row = aoa[idx] || [];
    const h = row.map((c, i) => (c == null || c === "" ? `Column ${i + 1}` : String(c).trim()));
    const { mapping: m } = suggestMapping(h, schema);
    setMapping(m);
  };

  const requiredOk = schema.filter(f => f.required).every(f => mapping[f.key] != null && mapping[f.key] >= 0);

  const previewRows = useMemo(() => {
    if (step !== "preview" && step !== "map") return [];
    return applyMapping(dataRows.slice(0, 10), mapping, schema);
  }, [dataRows, mapping, schema, step]);

  const confirm = () => {
    const mapped = applyMapping(dataRows, mapping, schema);
    onImport?.(mapped);
    toast?.push?.(`Imported ${mapped.length} row${mapped.length === 1 ? "" : "s"}`, { tone: "success" });
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900 bg-opacity-50 font-body" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-screen overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-amber-700 font-bold">Excel Import</div>
            <h3 className="font-display text-xl text-stone-900">{title}</h3>
            {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={20} /></button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-stone-200 bg-stone-50 text-xs">
          <Step n={1} label="Choose file" active={step === "pick"} done={step !== "pick"} />
          <ChevronRight size={12} className="text-stone-400" />
          <Step n={2} label="Map columns" active={step === "map"} done={step === "preview"} />
          <ChevronRight size={12} className="text-stone-400" />
          <Step n={3} label="Confirm" active={step === "preview"} done={false} />
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-md flex gap-2 text-sm text-rose-800">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === "pick" && (
            <div>
              {helpText && <p className="text-sm text-stone-600 mb-4">{helpText}</p>}
              <label
                className="block border-2 border-dashed border-stone-300 hover:border-amber-500 rounded-lg p-12 text-center cursor-pointer transition-colors"
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              >
                <FileSpreadsheet size={32} className="mx-auto text-stone-400 mb-3" />
                <div className="text-sm font-semibold text-stone-900 mb-1">Drop a file here or click to browse</div>
                <div className="text-xs text-stone-500">Supports .xlsx, .xls, .csv · {busy ? "reading..." : "max ~50MB"}</div>
                <input
                  type="file"
                  accept={acceptedFormats}
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </label>
              <div className="mt-4">
                <h4 className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-2">Expected columns</h4>
                <div className="flex flex-wrap gap-1.5">
                  {schema.map((f) => (
                    <span key={f.key} className={`inline-flex items-center px-2 py-1 rounded text-[11px] border ${f.required ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-stone-50 border-stone-200 text-stone-700"}`}>
                      {f.label}{f.required && <span className="ml-1 text-amber-700">*</span>}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-stone-500 mt-2">Columns marked <span className="text-amber-700">*</span> are required. We&apos;ll fuzzy-match your column names automatically — you can adjust before importing.</p>
              </div>
            </div>
          )}

          {step === "map" && workbook && (
            <div className="space-y-4">
              {/* Sheet + header row pickers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {workbook.sheets.length > 1 && (
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-wider text-stone-500 mb-1 font-bold">Sheet</span>
                    <select
                      value={sheetIdx}
                      onChange={(e) => onChangeSheet(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white"
                    >
                      {workbook.sheets.map((s, i) => <option key={i} value={i}>{s.name} ({s.dataRows.length} rows)</option>)}
                    </select>
                  </label>
                )}
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider text-stone-500 mb-1 font-bold">Header row</span>
                  <select
                    value={headerIdx}
                    onChange={(e) => onChangeHeaderRow(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white"
                  >
                    {aoa.slice(0, Math.min(8, aoa.length)).map((row, i) => (
                      <option key={i} value={i}>
                        Row {i + 1}: {row.slice(0, 5).map(c => String(c ?? "").slice(0, 20)).join(" · ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Mapping table */}
              <div>
                <h4 className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-2">Column mapping</h4>
                <div className="border border-stone-200 rounded-md divide-y divide-stone-100">
                  {schema.map((f) => (
                    <div key={f.key} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="w-1/3">
                        <div className="text-sm font-semibold text-stone-900">{f.label}{f.required && <span className="ml-1 text-amber-700">*</span>}</div>
                        <div className="text-[11px] text-stone-500">{f.type || "text"} · {f.key}</div>
                      </div>
                      <ChevronRight size={14} className="text-stone-400" />
                      <select
                        value={mapping[f.key] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                        className="flex-1 px-3 py-1.5 text-sm border border-stone-300 rounded-md bg-white"
                      >
                        <option value="">— skip —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                      {mapping[f.key] != null && mapping[f.key] >= 0 && (
                        <Check size={14} className="text-emerald-600 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {previewRows.length > 0 && (
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-2">Preview · first {previewRows.length} of {dataRows.length} rows</h4>
                  <div className="overflow-auto border border-stone-200 rounded-md max-h-64">
                    <table className="w-full text-xs">
                      <thead className="bg-stone-100 text-stone-600">
                        <tr>{schema.map((f) => <th key={f.key} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{f.label}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {previewRows.map((r, i) => (
                          <tr key={i} className="hover:bg-amber-50">
                            {schema.map((f) => (
                              <td key={f.key} className="px-3 py-1.5 whitespace-nowrap">
                                {r[f.key] === "" || r[f.key] == null ? <span className="text-stone-300">—</span> : String(r[f.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200 bg-stone-50">
          <div className="text-xs text-stone-500">
            {file && <span><FileSpreadsheet size={12} className="inline mr-1 -mt-0.5" />{file.name} · {dataRows.length} rows</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-md">Cancel</button>
            {step === "map" && (
              <button
                onClick={confirm}
                disabled={!requiredOk}
                className="px-4 py-2 text-sm font-medium bg-amber-700 text-white rounded-md hover:bg-amber-800 disabled:bg-stone-300 disabled:cursor-not-allowed"
              >
                Import {dataRows.length} row{dataRows.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label, active, done }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${active ? "text-amber-800" : done ? "text-emerald-700" : "text-stone-500"}`}>
      <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold ${active ? "bg-amber-700 text-white" : done ? "bg-emerald-600 text-white" : "bg-stone-300 text-white"}`}>
        {done ? <Check size={9} /> : n}
      </span>
      <span className="font-semibold">{label}</span>
    </div>
  );
}

export default ImportExcelDialog;
