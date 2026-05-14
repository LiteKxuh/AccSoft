import { useEffect, useState } from "react";
import { AlertCircle, Sparkles, CheckCircle2, X } from "lucide-react";
import {
  isConfigured,
  buildBaseline,
  localAnomalies,
  nightAuditAnomalies,
  dailyRecap,
} from "./aiOps.js";

const SEV_STYLE = {
  high:   { dot: "bg-rose-500",    label: "Critical", text: "text-rose-700",    bg: "bg-rose-50/60",   border: "border-rose-200" },
  medium: { dot: "bg-amber-500",   label: "Warning",  text: "text-amber-700",   bg: "bg-amber-50/60",  border: "border-amber-200" },
  low:    { dot: "bg-sky-500",     label: "Notice",   text: "text-sky-700",     bg: "bg-sky-50/60",    border: "border-sky-200" },
};

/**
 * Compact daily-ops insights panel: local anomaly detection always runs; the
 * Claude narrative is fetched only when configured and only when the user asks
 * (the button kicks off a fetch). No traffic without a click + a configured proxy.
 */
export function AiInsightsCard({ report, reports, propertyName }) {
  const [findings, setFindings] = useState([]);
  const [narrative, setNarrative] = useState(null);
  const [recap, setRecap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const configured = isConfigured();

  // Run deterministic local checks immediately
  useEffect(() => {
    if (!report) { setFindings([]); return; }
    const baseline = buildBaseline(reports, report.propertyId, report.date);
    setFindings(localAnomalies(report, baseline));
    setNarrative(null);
    setRecap(null);
  }, [report, reports]);

  const runNarrative = async () => {
    if (!configured || !report) return;
    setBusy(true);
    setError(null);
    try {
      const baseline = buildBaseline(reports, report.propertyId, report.date);
      const [anomResp, recapResp] = await Promise.all([
        nightAuditAnomalies({ report, baseline, narrative: true }),
        dailyRecap({
          report,
          prior: reports.find(r => r.propertyId === report.propertyId && r.date < report.date) || null,
          mtd: null,
          baseline,
        }),
      ]);
      setNarrative(anomResp?.narrative || null);
      setRecap(recapResp);
    } catch (e) {
      setError(e?.message || "AI request failed");
    } finally {
      setBusy(false);
    }
  };

  if (!report) return null;

  return (
    <div className="rounded-xl border border-stone-200 bg-gradient-to-br from-stone-50 to-white overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-amber-700" />
          <h3 className="font-display text-lg text-stone-900">Ops Intelligence</h3>
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">AI</span>
        </div>
        <div className="flex items-center gap-2">
          {configured ? (
            <button
              type="button"
              onClick={runNarrative}
              disabled={busy}
              className="text-xs font-semibold text-amber-700 hover:text-amber-900 disabled:opacity-50"
            >
              {busy ? "Analyzing…" : narrative || recap ? "Refresh narrative" : "Generate narrative"}
            </button>
          ) : (
            <span className="text-xs text-stone-500">Local checks only · enable Anthropic proxy in Settings for narrative</span>
          )}
        </div>
      </div>

      {error && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">{error}</div>
      )}

      <div className="px-5 py-4 space-y-3">
        {findings.length === 0 ? (
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-stone-900">Night audit clean</div>
              <div className="text-xs text-stone-600 mt-0.5">No anomalies vs 7/30-day baselines or same-day-of-week.</div>
            </div>
          </div>
        ) : (
          findings.map((f, i) => {
            const s = SEV_STYLE[f.severity] || SEV_STYLE.low;
            return (
              <div key={i} className={`flex items-start gap-3 rounded-md border ${s.border} ${s.bg} p-2.5`}>
                <span className={`w-2 h-2 rounded-full ${s.dot} mt-1.5 flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-stone-900">{f.label}</div>
                  <div className="text-xs text-stone-600 mt-0.5">{f.detail}</div>
                </div>
                <span className={`text-[10px] uppercase tracking-wider font-bold ${s.text}`}>{s.label}</span>
              </div>
            );
          })
        )}

        {recap?.bullets && Array.isArray(recap.bullets) && recap.bullets.length > 0 && (
          <div className="border-t border-stone-200 pt-3 mt-2 space-y-2">
            <div className="text-[10px] uppercase tracking-wider font-bold text-stone-500">Daily Recap</div>
            {recap.summary && <div className="text-sm text-stone-700">{recap.summary}</div>}
            <ul className="space-y-1.5">
              {recap.bullets.map((b, i) => (
                <li key={i} className="text-sm text-stone-800">
                  <span className="font-semibold">{b.metric}</span>{" "}
                  <span className="tabular">{b.value}</span>
                  {b.vs && <span className="text-stone-500"> · {b.vs}</span>}
                  {b.callout && <span className="ml-1 text-amber-700">— {b.callout}</span>}
                </li>
              ))}
            </ul>
            {recap.tomorrowFocus && (
              <div className="text-xs text-stone-600 mt-2"><strong className="text-stone-800">Tomorrow:</strong> {recap.tomorrowFocus}</div>
            )}
          </div>
        )}

        {narrative?.summary && (
          <div className="border-t border-stone-200 pt-3 mt-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-bold text-stone-500">Auditor Take</div>
            <p className="text-sm text-stone-800">{narrative.summary}</p>
            {narrative.topAction && (
              <p className="text-xs text-stone-700"><strong className="text-stone-900">Top action:</strong> {narrative.topAction}</p>
            )}
            {Array.isArray(narrative.rootCauseHypotheses) && narrative.rootCauseHypotheses.length > 0 && (
              <ul className="list-disc list-inside text-xs text-stone-600 space-y-0.5 mt-1">
                {narrative.rootCauseHypotheses.slice(0, 3).map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
