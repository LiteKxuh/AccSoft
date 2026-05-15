import { useMemo, useState } from "react";
import { Users, Clock, FileSpreadsheet, ShieldAlert, AlertTriangle, CheckCircle2, Play, Download, ChevronRight } from "lucide-react";
import { buildExceptionQueue, detectMissedPunches } from "./workforce/timeAttendance.js";
import { runPayrollForensics } from "./workforce/payrollForensics.js";
import { buildBatch, approveBatch, reopenBatch, postBatchToLedger } from "./workforce/payrollBatch.js";
import { makePayGroup, periodFor, listPeriods } from "./workforce/payPeriods.js";
import { exportFor, EXPORTERS } from "./workforce/payrollExporter.js";
import { normalizeEmployee } from "./workforce/employeeProfile.js";

const TABS = [
  { id: "time",      label: "Time & Attendance", icon: Clock },
  { id: "batches",   label: "Payroll Batches",   icon: FileSpreadsheet },
  { id: "forensics", label: "Payroll Forensics", icon: ShieldAlert },
];

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtDateTime(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

const SEV = {
  high:   { chip: "bg-rose-100 text-rose-700" },
  medium: { chip: "bg-amber-100 text-amber-700" },
  low:    { chip: "bg-sky-100 text-sky-700" },
  info:   { chip: "bg-stone-100 text-stone-600" },
};

export function WorkforcePane({ ctx }) {
  const { state, currentUser, toast, update } = ctx;
  const [tab, setTab] = useState("time");

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 border-r border-stone-200 bg-stone-50 overflow-y-auto">
        <div className="px-4 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-amber-700" />
            <span className="text-xs uppercase tracking-[0.2em] text-amber-700 font-bold">Workforce</span>
          </div>
          <div className="text-sm font-semibold text-stone-900">Labor & payroll</div>
        </div>
        <div className="px-2 py-3">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id} onClick={() => setTab(t.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 mb-1 ${active ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "text-stone-700 hover:bg-stone-100"}`}
              >
                <Icon size={13} className={active ? "text-amber-700" : "text-stone-500"} />
                <span className="flex-1">{t.label}</span>
                {active && <ChevronRight size={12} className="text-amber-700" />}
              </button>
            );
          })}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {tab === "time" && <TimeAttendanceSection ctx={ctx} />}
        {tab === "batches" && <PayrollBatchesSection ctx={ctx} />}
        {tab === "forensics" && <PayrollForensicsSection ctx={ctx} />}
      </main>
    </div>
  );
}

/* ------------------ Time & Attendance ------------------ */
function TimeAttendanceSection({ ctx }) {
  const { state } = ctx;
  const queue = useMemo(() => buildExceptionQueue(state.shifts || []), [state.shifts]);

  return (
    <div className="p-8 space-y-5">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-amber-700 font-bold mb-1">Time & Attendance</div>
        <h2 className="font-display text-2xl text-stone-900">{queue.length} exception{queue.length === 1 ? "" : "s"} need review</h2>
        <p className="text-sm text-stone-500 mt-1">Missed clock-outs, implausible durations, meal-break violations.</p>
      </div>
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        {queue.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 size={28} className="mx-auto text-emerald-400 mb-3" />
            <h3 className="font-display text-lg text-stone-900">Time & attendance clean</h3>
            <p className="text-sm text-stone-500 mt-1">No exceptions in the queue.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-32">Date</th>
                <th className="text-left px-4 py-2 font-medium w-24">Severity</th>
                <th className="text-left px-4 py-2 font-medium">Employee</th>
                <th className="text-left px-4 py-2 font-medium">Issue</th>
                <th className="text-left px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {queue.map((q, i) => {
                const s = SEV[q.severity] || SEV.info;
                return (
                  <tr key={i} className="hover:bg-stone-50">
                    <td className="px-4 py-1.5 tabular text-stone-700 text-xs">{q.date}</td>
                    <td className="px-4 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${s.chip}`}>{q.severity}</span>
                    </td>
                    <td className="px-4 py-1.5 text-stone-700">{q.employeeId}</td>
                    <td className="px-4 py-1.5 text-stone-900 font-medium">{q.issue}</td>
                    <td className="px-4 py-1.5 text-stone-600 text-xs">{q.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------ Payroll Batches ------------------ */
function PayrollBatchesSection({ ctx }) {
  const { state, currentUser, toast, update } = ctx;
  const [creating, setCreating] = useState(false);
  const [activeBatch, setActiveBatch] = useState(null);

  const payGroups = state.payGroups || [
    makePayGroup({ id: "weekly", name: "Hourly Weekly", frequency: "weekly", anchorDate: "2026-01-05", payClass: "hourly" }),
  ];

  const createBatch = (payGroup) => {
    setCreating(true);
    try {
      const period = periodFor(payGroup, new Date().toISOString().slice(0, 10));
      const { batch, perEmployee, totals } = buildBatch({
        state, payGroup,
        periodStart: period.start, periodEnd: period.end,
        otRule: state.settings?.otRule || "FLSA",
      });
      const stored = { ...batch, perEmployee, totals };
      update({ payrollBatches: [...(state.payrollBatches || []), stored] });
      toast?.push?.(`Batch ${batch.id} drafted · ${perEmployee.length} employee(s) · ${fmtMoney(totals.gross)} gross`, { tone: "success" });
      setActiveBatch(stored);
    } catch (e) {
      toast?.push?.(`Could not build batch: ${e.message}`, { tone: "error" });
    } finally {
      setCreating(false);
    }
  };

  const handleApprove = (batchId) => {
    try {
      update(approveBatch(state, batchId, currentUser));
      toast?.push?.("Batch approved", { tone: "success" });
    } catch (e) {
      toast?.push?.(e.message, { tone: "error" });
    }
  };

  const handleReopen = (batchId) => {
    try {
      update(reopenBatch(state, batchId, currentUser));
      toast?.push?.("Batch reopened", { tone: "warn" });
    } catch (e) {
      toast?.push?.(e.message, { tone: "error" });
    }
  };

  const handleExport = (batch, format) => {
    const employees = (state.employees || []).map(normalizeEmployee);
    const result = exportFor(format, batch, batch.perEmployee, employees);
    if (result.issues && result.issues.length) {
      toast?.push?.(`Export blocked: ${result.issues[0]}`, { tone: "error" });
      return;
    }
    // Download via blob
    if (typeof window !== "undefined") {
      const blob = new Blob([result.content], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = result.filename; a.click();
      URL.revokeObjectURL(url);
    }
    toast?.push?.(`Exported as ${format.toUpperCase()}`, { tone: "success" });
    // Mark batch as exported
    const next = (state.payrollBatches || []).map(b =>
      b.id === batch.id ? { ...b, status: "exported", exportedAt: new Date().toISOString(), exportedBy: currentUser?.id, exportFormat: format } : b
    );
    update({ payrollBatches: next });
  };

  const handlePost = (batch) => {
    try {
      const r = postBatchToLedger(state, { batch, perEmployee: batch.perEmployee, user: currentUser });
      update({
        journalEntries: [...(state.journalEntries || []), ...r.journalEntries],
        ...r.patch,
      });
      toast?.push?.(`Batch posted to GL · JE ${r.journalEntries[0].id}`, { tone: "success" });
    } catch (e) {
      toast?.push?.(e.message, { tone: "error" });
    }
  };

  return (
    <div className="p-8 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-amber-700 font-bold mb-1">Payroll Batches</div>
          <h2 className="font-display text-2xl text-stone-900">{(state.payrollBatches || []).length} batch(es)</h2>
          <p className="text-sm text-stone-500 mt-1">Draft → approved → exported → posted to GL.</p>
        </div>
        <div className="flex gap-2">
          {payGroups.map(g => (
            <button key={g.id} onClick={() => createBatch(g)} disabled={creating} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-md bg-amber-700 hover:bg-amber-800 text-white disabled:bg-stone-300">
              <Play size={13} /> Draft {g.name}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        {(state.payrollBatches || []).length === 0 ? (
          <div className="px-5 py-12 text-center text-stone-500 text-sm">No batches yet. Click "Draft" above to build one from current shifts.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Batch</th>
                <th className="text-left px-4 py-2 font-medium">Period</th>
                <th className="text-right px-4 py-2 font-medium">Gross</th>
                <th className="text-right px-4 py-2 font-medium">Employees</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium w-96">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(state.payrollBatches || []).slice().reverse().map(b => {
                const statusStyle = b.status === "posted" ? "bg-emerald-100 text-emerald-700"
                  : b.status === "exported" ? "bg-sky-100 text-sky-700"
                  : b.status === "approved" ? "bg-amber-100 text-amber-700"
                  : "bg-stone-100 text-stone-600";
                return (
                  <tr key={b.id} className="hover:bg-stone-50">
                    <td className="px-4 py-1.5 text-stone-700 text-xs font-mono">{b.id}</td>
                    <td className="px-4 py-1.5 tabular text-xs">{b.periodStart} – {b.periodEnd}</td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold">{fmtMoney(b.totals?.gross || 0)}</td>
                    <td className="px-4 py-1.5 text-right tabular">{(b.perEmployee || []).length}</td>
                    <td className="px-4 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${statusStyle}`}>{b.status}</span>
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <div className="inline-flex gap-1 flex-wrap justify-end">
                        {b.status === "draft" && (
                          <button onClick={() => handleApprove(b.id)} className="px-2 py-1 text-[10px] uppercase font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded">Approve</button>
                        )}
                        {b.status === "approved" && (
                          <>
                            {Object.keys(EXPORTERS).map(fmt => (
                              <button key={fmt} onClick={() => handleExport(b, fmt)} className="px-2 py-1 text-[10px] uppercase font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded inline-flex items-center gap-1">
                                <Download size={9} /> {fmt}
                              </button>
                            ))}
                            <button onClick={() => handlePost(b)} className="px-2 py-1 text-[10px] uppercase font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded">Post GL</button>
                          </>
                        )}
                        {(b.status === "approved" || b.status === "draft") && (
                          <button onClick={() => handleReopen(b.id)} className="px-2 py-1 text-[10px] uppercase font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded">Reopen</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ------------------ Payroll Forensics ------------------ */
function PayrollForensicsSection({ ctx }) {
  const { state } = ctx;
  const result = useMemo(() => runPayrollForensics(state), [state.shifts, state.employees, state.payrollRuns, state.payrollAdjustments]);

  const bandStyle = ({
    clean:    "text-emerald-700 bg-emerald-50",
    low:      "text-sky-700 bg-sky-50",
    elevated: "text-amber-700 bg-amber-50",
    high:     "text-rose-700 bg-rose-50",
    critical: "text-rose-900 bg-rose-100",
  })[result.riskBand] || "text-stone-700 bg-stone-50";

  return (
    <div className="p-8 space-y-5">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-amber-700 font-bold mb-1">Payroll Forensics</div>
        <h2 className="font-display text-2xl text-stone-900">Risk band: <span className={`inline-block px-2 py-0.5 rounded text-base font-semibold ${bandStyle}`}>{result.riskBand}</span> · score {result.riskScore}</h2>
        <p className="text-sm text-stone-500 mt-1">Buddy punching, ghost employees, duplicate punches, suspicious OT, approval bypass.</p>
      </div>

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        {result.findings.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 size={28} className="mx-auto text-emerald-400 mb-3" />
            <h3 className="font-display text-lg text-stone-900">No findings</h3>
            <p className="text-sm text-stone-500 mt-1">All detectors returned green.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-24">Severity</th>
                <th className="text-left px-4 py-2 font-medium w-44">Detector</th>
                <th className="text-left px-4 py-2 font-medium">Finding</th>
                <th className="text-right px-4 py-2 font-medium w-24">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {result.findings.map(f => {
                const s = SEV[f.severity] || SEV.info;
                return (
                  <tr key={f.id} className="hover:bg-stone-50 align-top">
                    <td className="px-4 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${s.chip}`}>{f.severity}</span>
                    </td>
                    <td className="px-4 py-2 text-stone-600 text-xs font-mono">{f.code}</td>
                    <td className="px-4 py-2">
                      <div className="text-stone-900 font-medium">{f.label}</div>
                      <div className="text-xs text-stone-600 mt-0.5">{f.detail}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular text-stone-700 font-semibold">{Math.round(f.confidence * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
