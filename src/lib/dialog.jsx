/* HotelOps · Dialog infrastructure
 * =================================================================
 * Promise-based, async-safe, queueable replacements for the native
 * `alert`, `confirm`, and `prompt` browser dialogs — which are
 * unsupported / unreliable inside Electron's renderer.
 *
 * API:
 *   <DialogProvider> mounted at the app root
 *   const { confirm, prompt: askPrompt, alert: notify } = useDialog()
 *
 *   await notify("File too large.")
 *   const ok = await confirm({ title, message, confirmLabel?, danger? })
 *   const value = await askPrompt({ title, message, initialValue?, placeholder? })
 *
 * Non-React modules import the global shims and call them directly:
 *   import { confirmDialog, promptDialog, alertDialog } from "./dialog.jsx"
 *   if (await confirmDialog({ title: "...", message: "..." })) { ... }
 *
 * All dialogs:
 *   - block the focused dialog (keyboard accessible)
 *   - serialize by queue (one visible at a time, no race conditions)
 *   - close on Esc (cancel) and Enter (confirm primary)
 *   - return a Promise that always resolves (never throws)
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

const DialogCtx = createContext(null);

// Globally-callable shims for non-React modules
let _confirmFn = null;
let _promptFn = null;
let _alertFn = null;

export function confirmDialog(opts) {
  if (_confirmFn) return _confirmFn(opts);
  // Fallback if provider not mounted yet (e.g., during boot before render)
  // — return false so destructive actions never silently proceed.
  return Promise.resolve(false);
}
export function promptDialog(opts) {
  if (_promptFn) return _promptFn(opts);
  return Promise.resolve(null);
}
export function alertDialog(opts) {
  if (_alertFn) return _alertFn(opts);
  return Promise.resolve();
}

export function useDialog() {
  const ctx = useContext(DialogCtx);
  if (!ctx) {
    // Hooks called outside provider — return safe no-ops so we don't crash.
    return {
      confirm: () => Promise.resolve(false),
      prompt: () => Promise.resolve(null),
      alert:  () => Promise.resolve(),
    };
  }
  return ctx;
}

export function DialogProvider({ children }) {
  const [queue, setQueue] = useState([]);  // [{ id, kind, props, resolve }]
  const seq = useRef(1);

  function enqueue(kind, props) {
    return new Promise((resolve) => {
      const id = seq.current++;
      setQueue((q) => [...q, { id, kind, props, resolve }]);
    });
  }
  function popHead(result) {
    setQueue((q) => {
      if (q.length === 0) return q;
      const [head, ...rest] = q;
      try { head.resolve(result); } catch { /* never crash */ }
      return rest;
    });
  }

  const api = {
    confirm: (props) => enqueue("confirm", props || {}),
    prompt:  (props) => enqueue("prompt",  props || {}),
    alert:   (props) => enqueue("alert",   typeof props === "string" ? { message: props } : (props || {})),
  };

  // Wire global shims
  useEffect(() => {
    _confirmFn = api.confirm;
    _promptFn  = api.prompt;
    _alertFn   = api.alert;
    return () => { _confirmFn = null; _promptFn = null; _alertFn = null; };
  // The `api` object is recreated each render but its contents are
  // stable in behavior — we only need to register once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const head = queue[0] || null;

  return (
    <DialogCtx.Provider value={api}>
      {children}
      {head && (
        <DialogShell key={head.id} kind={head.kind} {...head.props} onResolve={(result) => popHead(result)} />
      )}
    </DialogCtx.Provider>
  );
}

/* ---------- Shell ---------- */

function DialogShell({ kind, onResolve, title, message, confirmLabel, cancelLabel, danger, initialValue, placeholder, tone }) {
  const [value, setValue] = useState(initialValue || "");
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (kind === "prompt" && inputRef.current) inputRef.current.focus();
    else if (confirmRef.current) confirmRef.current.focus();
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter" && kind !== "prompt") {
        e.preventDefault();
        accept();
      } else if (e.key === "Enter" && kind === "prompt" && !e.shiftKey) {
        e.preventDefault();
        accept();
      } else if (e.key === "Tab") {
        // Trap focus inside the dialog
        const focusables = dialogRef.current?.querySelectorAll("button, input, textarea, select, [tabindex]:not([tabindex='-1'])");
        if (!focusables?.length) return;
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function cancel() {
    if (kind === "confirm") onResolve(false);
    else if (kind === "prompt") onResolve(null);
    else onResolve();
  }
  function accept() {
    if (kind === "confirm") onResolve(true);
    else if (kind === "prompt") onResolve(value);
    else onResolve();
  }

  const toneCfg = (() => {
    if (danger || tone === "danger") return { Icon: AlertTriangle, accent: "text-rose-600",   ring: "ring-rose-500",   btn: "bg-rose-600 hover:bg-rose-700",   border: "border-rose-200" };
    if (tone === "warn")              return { Icon: AlertCircle,   accent: "text-amber-600",  ring: "ring-amber-500",  btn: "bg-amber-600 hover:bg-amber-700", border: "border-amber-200" };
    return { Icon: Info, accent: "text-sky-600", ring: "ring-sky-500", btn: "bg-stone-900 hover:bg-stone-800", border: "border-stone-200" };
  })();
  const Icon = toneCfg.Icon;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4"
         role="dialog" aria-modal="true" aria-labelledby="dlg-title"
         onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
           style={{ animation: "dlg-fade 0.15s ease-out both" }} />
      <div ref={dialogRef}
           className={`relative bg-white rounded-xl shadow-2xl border ${toneCfg.border} w-full max-w-md p-5`}
           style={{ animation: "dlg-pop 0.2s cubic-bezier(0.16, 1, 0.3, 1) both" }}>
        <div className="flex items-start gap-3 mb-3">
          <Icon size={20} className={`${toneCfg.accent} flex-shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            {title && <h2 id="dlg-title" className="font-display text-lg text-stone-900 leading-tight">{title}</h2>}
            {message && (
              typeof message === "string"
                ? <div className="text-sm text-stone-600 mt-1 whitespace-pre-line">{message}</div>
                : <div className="text-sm text-stone-600 mt-1">{message}</div>
            )}
          </div>
        </div>
        {kind === "prompt" && (
          <div className="mb-3">
            <input ref={inputRef} type="text" value={value}
                   onChange={(e) => setValue(e.target.value)}
                   placeholder={placeholder || ""}
                   className={`w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 ${toneCfg.ring} focus:border-transparent`} />
          </div>
        )}
        <div className="flex items-center justify-end gap-2 mt-3">
          {kind !== "alert" && (
            <button onClick={cancel}
                    className="px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-md">
              {cancelLabel || "Cancel"}
            </button>
          )}
          <button ref={confirmRef} onClick={accept}
                  className={`px-3 py-1.5 text-sm font-medium text-white rounded-md ${toneCfg.btn}`}>
            {confirmLabel || (kind === "confirm" ? "Confirm" : kind === "prompt" ? "OK" : "Dismiss")}
          </button>
        </div>
        <style>{`
          @keyframes dlg-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes dlg-pop { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
        `}</style>
      </div>
    </div>
  );
}
