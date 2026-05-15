import { useState, useMemo } from "react";
import { CheckCircle2, X, ShieldCheck, Receipt, ClipboardList } from "lucide-react";
import { inboxFor, approveJE, rejectJE, approveInvoice } from "./approvalInbox.js";
import { promptDialog } from "./dialog.jsx";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function fmtDate(s) { return s ? String(s).slice(0, 10) : ""; }

export function ApprovalInboxPane({ ctx, role, onUpdate }) {
  const { state, currentUser, toast } = ctx;
  const [showRejected, setShowRejected] = useState(false);
  const inbox = useMemo(() => inboxFor(state, role), [state, role]);

  const handleApproveJE = (id) => {
    const r = approveJE(state, id, currentUser, role);
    if (!r.ok) { toast?.push?.(r.reason, { tone: "error" }); return; }
    onUpdate(r.update);
    toast?.push?.("Journal entry approved", { tone: "success" });
  };

  const handleRejectJE = async (id) => {
    const reason = await promptDialog({ title: "Reject journal entry", message: "Reason for rejecting?", placeholder: "Optional reason" });
    if (reason === null) return; // user cancelled
    const r = rejectJE(state, id, currentUser, role, reason || "Rejected");
    if (!r.ok) { toast?.push?.(r.reason, { tone: "error" }); return; }
    onUpdate(r.update);
    toast?.push?.("Journal entry rejected", { tone: "warn" });
  };

  const handleApproveInvoice = (id) => {
    const r = approveInvoice(state, id, currentUser, role);
    if (!r.ok) { toast?.push?.(r.reason, { tone: "error" }); return; }
    onUpdate(r.update);
    toast?.push?.("Invoice approved", { tone: "success" });
  };

  return (
    <div className="p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Approval Inbox</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{inbox.total} pending</h2>
          <p className="text-sm text-stone-500 mt-1">
            Your role ({role}) can approve up to{" "}
            <strong className="text-stone-900">
              {inbox.roleLimit === Infinity ? "no limit" : fmtMoney(inbox.roleLimit)}
            </strong>.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
          <ClipboardList size={16} className="text-amber-700" />
          <h3 className="font-display text-lg text-stone-900">Journal Entries · {inbox.journalEntries.length}</h3>
        </div>
        {inbox.journalEntries.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-500">All clear. No JEs waiting on you.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Description</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-left px-4 py-2 font-medium w-40">Source</th>
                <th className="text-right px-4 py-2 font-medium w-44">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {inbox.journalEntries.map(e => {
                const amount = (e.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
                return (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className="px-4 py-1.5 tabular">{fmtDate(e.date)}</td>
                    <td className="px-4 py-1.5 text-stone-900">{e.description}</td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold">{fmtMoney(amount)}</td>
                    <td className="px-4 py-1.5 text-stone-600 text-xs">{e.source || "manual"}</td>
                    <td className="px-4 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => handleApproveJE(e.id)} className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded inline-flex items-center gap-1">
                          <CheckCircle2 size={12} /> Approve
                        </button>
                        <button onClick={() => handleRejectJE(e.id)} className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded inline-flex items-center gap-1">
                          <X size={12} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50 flex items-center gap-2">
          <Receipt size={16} className="text-amber-700" />
          <h3 className="font-display text-lg text-stone-900">Invoices · {inbox.invoices.length}</h3>
        </div>
        {inbox.invoices.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-500">No invoices waiting on you.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Issued</th>
                <th className="text-left px-4 py-2 font-medium">Vendor</th>
                <th className="text-left px-4 py-2 font-medium">Number</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-right px-4 py-2 font-medium w-36">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {inbox.invoices.map(i => {
                const vendor = (state.vendors || []).find(v => v.id === i.vendorId);
                return (
                  <tr key={i.id} className="hover:bg-stone-50">
                    <td className="px-4 py-1.5 tabular">{fmtDate(i.issuedDate)}</td>
                    <td className="px-4 py-1.5 text-stone-900">{vendor?.name || "—"}</td>
                    <td className="px-4 py-1.5 text-stone-600 text-xs font-mono">{i.number || i.invoiceNumber || "—"}</td>
                    <td className="px-4 py-1.5 text-right tabular font-semibold">{fmtMoney(i.amount)}</td>
                    <td className="px-4 py-1.5 text-right">
                      <button onClick={() => handleApproveInvoice(i.id)} className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded inline-flex items-center gap-1">
                        <ShieldCheck size={12} /> Approve
                      </button>
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
