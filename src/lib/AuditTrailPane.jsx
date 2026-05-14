import { useMemo, useState } from "react";
import { ClipboardList, Filter, Search } from "lucide-react";
import { readEvents, clearLog } from "./auditLog.js";

function fmtDateTime(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

const ACTION_COLORS = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-sky-100 text-sky-700",
  delete: "bg-rose-100 text-rose-700",
  approve: "bg-emerald-100 text-emerald-700",
  void: "bg-rose-100 text-rose-700",
  post: "bg-amber-100 text-amber-700",
  default: "bg-stone-100 text-stone-700",
};

function actionChrome(action) {
  if (!action) return ACTION_COLORS.default;
  const key = action.split(".")[1] || action;
  return ACTION_COLORS[key] || ACTION_COLORS.default;
}

export function AuditTrailPane({ ctx, can }) {
  const { state, toast } = ctx;
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterCollection, setFilterCollection] = useState("");
  const [search, setSearch] = useState("");

  const allowed = !can || can("je.view-chain"); // reuse chain-view permission tier
  const events = useMemo(() => {
    if (!allowed) return [];
    return readEvents() || [];
  }, [state, allowed]);

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (filterUser && !(String(e.user || "").toLowerCase().includes(filterUser.toLowerCase()))) return false;
      if (filterAction && !(String(e.action || "").toLowerCase().includes(filterAction.toLowerCase()))) return false;
      if (filterCollection && !(String(e.collection || "").toLowerCase().includes(filterCollection.toLowerCase()))) return false;
      if (search) {
        const blob = JSON.stringify(e).toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    }).slice(0, 500);
  }, [events, filterUser, filterAction, filterCollection, search]);

  const distinct = useMemo(() => {
    const users = new Set(), actions = new Set(), collections = new Set();
    for (const e of events) {
      if (e.user) users.add(e.user);
      if (e.action) actions.add(e.action);
      if (e.collection) collections.add(e.collection);
    }
    return {
      users: Array.from(users),
      actions: Array.from(actions),
      collections: Array.from(collections),
    };
  }, [events]);

  if (!allowed) {
    return (
      <div className="p-8">
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-8 text-center">
          <ClipboardList size={28} className="mx-auto text-stone-400 mb-3" />
          <h3 className="font-display text-lg text-stone-900">Restricted</h3>
          <p className="text-sm text-stone-500 mt-1">Audit trail access requires a senior role.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">Audit Trail</span>
          </div>
          <h2 className="font-display text-3xl text-stone-900">{events.length} event{events.length === 1 ? "" : "s"} · showing {filtered.length}</h2>
          <p className="text-sm text-stone-500 mt-1">Append-only log of every state-changing action. Capped at 5,000 entries.</p>
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Filter size={12} /> Filters
          </div>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="px-2 py-1 text-xs border border-stone-300 rounded bg-white">
            <option value="">All users</option>
            {distinct.users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="px-2 py-1 text-xs border border-stone-300 rounded bg-white">
            <option value="">All actions</option>
            {distinct.actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterCollection} onChange={e => setFilterCollection(e.target.value)} className="px-2 py-1 text-xs border border-stone-300 rounded bg-white">
            <option value="">All collections</option>
            {distinct.collections.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="inline-flex items-center gap-1 px-2 py-1 border border-stone-300 rounded bg-white">
            <Search size={12} className="text-stone-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="text-xs bg-transparent border-0 focus:outline-none w-44" placeholder="Search payload…" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-44">When</th>
              <th className="text-left px-4 py-2 font-medium w-32">User</th>
              <th className="text-left px-4 py-2 font-medium w-32">Collection</th>
              <th className="text-left px-4 py-2 font-medium w-32">Action</th>
              <th className="text-left px-4 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-stone-400 text-xs">No events match the current filters.</td></tr>
            ) : (
              filtered.map((e, i) => (
                <tr key={i} className="hover:bg-stone-50">
                  <td className="px-4 py-1.5 text-stone-700 text-xs tabular">{fmtDateTime(e.ts)}</td>
                  <td className="px-4 py-1.5 text-stone-700 text-xs">{e.user || "—"}</td>
                  <td className="px-4 py-1.5 text-stone-600 text-xs font-mono">{e.collection || "—"}</td>
                  <td className="px-4 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${actionChrome(e.action)}`}>{e.action || "—"}</span>
                  </td>
                  <td className="px-4 py-1.5 text-stone-600 text-xs font-mono truncate max-w-md">{e.summary || JSON.stringify(e.diff || e.payload || {}).slice(0, 120)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
