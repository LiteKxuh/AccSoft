import { createContext, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

const ToastCtx = createContext({ push: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

// Globally-callable shim so non-React code (HotelOps.jsx without ctx) can fire toasts.
let _externalPush = null;
export function toast(msg, opts) {
  if (_externalPush) _externalPush(msg, opts);
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(1);

  const push = (message, opts = {}) => {
    const id = seq.current++;
    const t = {
      id,
      message,
      tone: opts.tone || "info",        // info | success | warn | error
      icon: opts.icon || null,
      action: opts.action || null,      // { label, onClick }
      duration: opts.duration ?? 4000,
    };
    setItems((s) => [...s, t]);
    if (t.duration > 0) {
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.duration);
    }
    return id;
  };
  _externalPush = push;

  const dismiss = (id) => setItems((s) => s.filter((x) => x.id !== id));

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {items.map((t) => (
          <ToastItem key={t.id} t={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ t, onClose }) {
  const tones = {
    info: { bg: "bg-stone-900", text: "text-white", accent: "text-sky-400", Icon: Info },
    success: { bg: "bg-stone-900", text: "text-white", accent: "text-emerald-400", Icon: CheckCircle2 },
    warn: { bg: "bg-amber-900", text: "text-amber-50", accent: "text-amber-300", Icon: AlertCircle },
    error: { bg: "bg-rose-900", text: "text-rose-50", accent: "text-rose-300", Icon: AlertCircle },
  };
  const cfg = tones[t.tone] || tones.info;
  const Icon = t.icon || cfg.Icon;
  return (
    <div
      className={`pointer-events-auto ${cfg.bg} ${cfg.text} rounded-lg shadow-2xl px-4 py-3 flex items-start gap-3 min-w-[280px]`}
      style={{ animation: "toast-slide 0.3s cubic-bezier(0.16, 1, 0.3, 1) both" }}
    >
      <Icon size={18} className={`${cfg.accent} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-snug">{t.message}</div>
        {t.action && (
          <button
            onClick={() => { t.action.onClick(); onClose(); }}
            className={`text-xs ${cfg.accent} font-semibold mt-1 hover:underline`}
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button onClick={onClose} className="text-stone-400 hover:text-white flex-shrink-0">
        <X size={14} />
      </button>
      <style>{`@keyframes toast-slide { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }`}</style>
    </div>
  );
}
