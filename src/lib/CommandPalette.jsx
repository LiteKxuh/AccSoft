import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Clock, Calendar, Users, DollarSign, BarChart3,
  Settings as SettingsIcon, Upload, FileText, Search, Building2, Hash,
} from "lucide-react";

// Simple cross-component pub/sub. HotelOps.jsx can subscribe and react to
// commands like "navigate:accounting" or "ingest:open" without needing
// the palette to know its internal state.
class CommandBus {
  constructor() {
    this._listeners = new Set();
    this._registry = new Map(); // id -> {label, hint, group, action, shortcut?}
  }
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  emit(cmd, payload) {
    this._listeners.forEach((fn) => fn(cmd, payload));
  }
  register(id, def) {
    this._registry.set(id, { id, ...def });
  }
  unregister(id) {
    this._registry.delete(id);
  }
  list() {
    return [...this._registry.values()];
  }
}

export const commandBus = new CommandBus();

// Built-in navigation commands — always present so the palette is useful
// from the very first render, even before HotelOps.jsx has registered its own.
const BUILTINS = [
  { id: "nav:dashboard",  label: "Go to Dashboard",   group: "Navigate",  icon: LayoutDashboard, hint: "G then D",  emit: ["navigate", "dashboard"] },
  { id: "nav:timeclock",  label: "Go to Time Clock",  group: "Navigate",  icon: Clock,           hint: "G then T",  emit: ["navigate", "timeclock"] },
  { id: "nav:schedule",   label: "Go to Schedule",    group: "Navigate",  icon: Calendar,        hint: "G then S",  emit: ["navigate", "schedule"] },
  { id: "nav:employees",  label: "Go to Employees",   group: "Navigate",  icon: Users,           hint: "G then E",  emit: ["navigate", "employees"] },
  { id: "nav:payroll",    label: "Go to Payroll",     group: "Navigate",  icon: DollarSign,      hint: "G then P",  emit: ["navigate", "payroll"] },
  { id: "nav:accounting", label: "Go to Accounting",  group: "Navigate",  icon: BarChart3,       hint: "G then A",  emit: ["navigate", "accounting"] },
  { id: "nav:settings",   label: "Go to Settings",    group: "Navigate",  icon: SettingsIcon,    hint: "G then ,",  emit: ["navigate", "settings"] },

  { id: "act:ingest",     label: "Ingest a Night Audit",     group: "Actions",  icon: Upload,    hint: "Cmd-I",     emit: ["ingest:open"] },
  { id: "act:flash",      label: "Open Today's Flash Report", group: "Actions", icon: FileText,  emit: ["flash:open"] },
  { id: "act:dark",       label: "Toggle Dark Mode",         group: "Actions",  icon: Hash,      hint: "Cmd-Shift-D", emit: ["theme:toggle"] },
  { id: "act:reset",      label: "Reset Demo Data",          group: "Actions",  icon: Building2, emit: ["data:reset"] },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [keySeq, setKeySeq] = useState(""); // for "g d" style shortcuts
  const inputRef = useRef(null);

  // open/close on ⌘K / Ctrl+K, "G then X" shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault(); setOpen((o) => !o); return;
      }
      if (open && e.key === "Escape") { setOpen(false); return; }
      if (meta && e.key.toLowerCase() === "i") {
        e.preventDefault(); commandBus.emit("ingest:open"); return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault(); commandBus.emit("theme:toggle"); return;
      }
      if (open) return; // don't trap two-key shortcuts while open
      // ignore inputs / textareas
      const tag = (e.target && e.target.tagName) || "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || e.target?.isContentEditable) return;
      // single-letter "g" then nav letter
      const k = e.key.toLowerCase();
      if (keySeq === "g") {
        const map = { d: "dashboard", t: "timeclock", s: "schedule", e: "employees", p: "payroll", a: "accounting", ",": "settings" };
        if (map[k]) { e.preventDefault(); commandBus.emit("navigate", map[k]); }
        setKeySeq(""); return;
      }
      if (k === "g") { setKeySeq("g"); setTimeout(() => setKeySeq(""), 1200); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, keySeq]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);
  useEffect(() => { if (!open) { setQuery(""); setActive(0); } }, [open]);

  // build full command list
  const all = [...BUILTINS, ...commandBus.list()];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter((c) => c.label.toLowerCase().includes(q) || (c.group || "").toLowerCase().includes(q))
    : all;
  const grouped = filtered.reduce((acc, c) => {
    const g = c.group || "Other";
    (acc[g] = acc[g] || []).push(c);
    return acc;
  }, {});

  const flat = filtered;
  const run = (c) => {
    setOpen(false);
    if (c.emit) commandBus.emit(...c.emit);
    if (c.action) c.action();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[15vh] px-4" onClick={() => setOpen(false)}
      style={{ background: "rgba(28,25,23,0.55)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden border border-stone-200" onClick={(e) => e.stopPropagation()}
        style={{ animation: "cp-pop 0.18s cubic-bezier(0.16, 1, 0.3, 1) both" }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
          <Search size={16} className="text-stone-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); flat[active] && run(flat[active]); }
            }}
            placeholder="Type a command, page, or action…"
            className="flex-1 outline-none text-base bg-transparent text-stone-900 placeholder-stone-400"
          />
          <kbd className="text-[10px] uppercase tracking-wider text-stone-400 px-1.5 py-0.5 rounded border border-stone-200 bg-stone-50">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-stone-400">No matching commands.</div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-stone-400 font-semibold">{group}</div>
                {items.map((c) => {
                  const idx = flat.indexOf(c);
                  const isActive = idx === active;
                  const Icon = c.icon || Hash;
                  return (
                    <button key={c.id}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(c)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left ${isActive ? "bg-amber-50 text-stone-900" : "text-stone-700 hover:bg-stone-50"}`}>
                      <Icon size={14} className={isActive ? "text-amber-700" : "text-stone-400"} />
                      <span className="flex-1 text-sm">{c.label}</span>
                      {c.hint && <kbd className="text-[10px] text-stone-400 font-mono">{c.hint}</kbd>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-stone-100 text-[11px] text-stone-400 flex items-center justify-between">
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span>HotelOps · ⌘K</span>
        </div>
        <style>{`@keyframes cp-pop { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
      </div>
    </div>
  );
}
