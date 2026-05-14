import { useMemo } from "react";
import { ShieldCheck, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { runNightAudit } from "./nightAudit.js";

const STATUS_CHROME = {
  pass:  { ring: "ring-emerald-200", bg: "bg-emerald-50/50",  text: "text-emerald-700", icon: ShieldCheck,    label: "Clean" },
  warn:  { ring: "ring-amber-200",   bg: "bg-amber-50/50",    text: "text-amber-700",   icon: AlertTriangle,  label: "Review" },
  fail:  { ring: "ring-rose-200",    bg: "bg-rose-50/50",     text: "text-rose-700",    icon: AlertCircle,    label: "Hold" },
};

const CHECK_STATUS = {
  pass: { dot: "bg-emerald-500", text: "text-emerald-700" },
  warn: { dot: "bg-amber-500",   text: "text-amber-700" },
  fail: { dot: "bg-rose-500",    text: "text-rose-700" },
};

export function NightAuditHealthCard({ report, propertySettings = null, dense = false }) {
  const audit = useMemo(() => runNightAudit(report, propertySettings), [report, propertySettings]);
  if (!audit) return null;
  const chrome = STATUS_CHROME[audit.status] || STATUS_CHROME.warn;
  const Icon = chrome.icon;

  return (
    <div className={`rounded-xl border border-stone-200 ${chrome.bg} overflow-hidden ring-1 ${chrome.ring}`}>
      <div className="px-5 py-3 border-b border-stone-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Icon size={18} className={chrome.text} />
          <div>
            <h3 className="font-display text-lg text-stone-900">Night Audit Health</h3>
            <p className="text-xs text-stone-600 mt-0.5">{audit.summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`text-3xl font-display font-semibold tabular ${chrome.text}`}>{audit.score}</div>
            <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold">Audit score</div>
          </div>
          <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded ${chrome.text} bg-white/60`}>{chrome.label}</span>
        </div>
      </div>
      <div className={`px-5 py-3 ${dense ? "space-y-1.5" : "space-y-2"}`}>
        {audit.checks.map((c, i) => {
          const cs = CHECK_STATUS[c.status] || CHECK_STATUS.warn;
          return (
            <div key={i} className="flex items-start gap-3">
              <span className={`w-2 h-2 rounded-full ${cs.dot} mt-1.5 flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-stone-900 font-medium">{c.label}</div>
                <div className="text-xs text-stone-600 mt-0.5">{c.detail}</div>
                {c.fix && c.status !== "pass" && (
                  <div className="text-xs text-stone-500 mt-0.5 italic">→ {c.fix}</div>
                )}
              </div>
              <span className={`text-[10px] uppercase tracking-wider font-bold ${cs.text}`}>
                {c.status === "pass" ? "OK" : c.status === "warn" ? "Warn" : "Fail"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
