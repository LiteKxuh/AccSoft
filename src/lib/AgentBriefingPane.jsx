import { useState, useMemo } from "react";
import { Sparkles, Bot, ChevronRight, AlertCircle, CheckCircle2, Play, Hash, Clock } from "lucide-react";
import { AGENTS, agentById, runAgent, isLlmAvailable } from "./agents/index.js";
import { can } from "./rbac.js";

function fmtDateTime(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

const VERDICT_STYLE = {
  "safe-to-roll": { bg: "bg-emerald-50/60", color: "text-emerald-700", ring: "ring-emerald-200" },
  "ok-to-pay":    { bg: "bg-emerald-50/60", color: "text-emerald-700", ring: "ring-emerald-200" },
  "needs-review": { bg: "bg-amber-50/60",   color: "text-amber-700",   ring: "ring-amber-200" },
  "partial-hold": { bg: "bg-amber-50/60",   color: "text-amber-700",   ring: "ring-amber-200" },
  "hold":         { bg: "bg-rose-50/60",    color: "text-rose-700",    ring: "ring-rose-200" },
};

export function AgentBriefingPane({ ctx, role, enrichReport }) {
  const { state, accessibleProperties, activeProperty, currentUser } = ctx;
  const asOf = new Date().toISOString().slice(0, 10);
  const [propertyId, setPropertyId] = useState(activeProperty || accessibleProperties[0]?.id);
  const [selected, setSelected] = useState(AGENTS[0].id);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const agent = useMemo(() => agentById(selected), [selected]);
  const llmAvailable = isLlmAvailable();

  const accessible = useMemo(() => {
    return AGENTS.filter(a => can(role, a.permissionAction));
  }, [role]);

  const handleRun = async () => {
    if (!agent) return;
    setBusy(true);
    try {
      const briefing = agent.buildBriefing({ state, propertyId, asOf, enrichReport });
      const r = await runAgent({ agent, briefing, ctx: { role, user: currentUser } });
      setResult(r);
    } catch (e) {
      setResult({ status: "error", error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 border-r border-stone-200 bg-stone-50 overflow-y-auto">
        <div className="px-4 py-4 border-b border-stone-200">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={14} className="text-amber-700" />
            <span className="text-xs uppercase tracking-[0.2em] text-amber-700 font-bold">AI Agents</span>
          </div>
          <div className="text-sm font-semibold text-stone-900">Operational specialists</div>
          {!llmAvailable && (
            <div className="mt-2 text-[10px] text-stone-500 leading-snug">
              Narrative LLM not configured. All agents still run with deterministic findings only.
            </div>
          )}
        </div>
        <div className="px-2 py-3">
          {AGENTS.map(a => {
            const allowed = accessible.find(x => x.id === a.id);
            const active = selected === a.id;
            return (
              <button
                key={a.id}
                onClick={() => allowed && setSelected(a.id)}
                disabled={!allowed}
                className={`w-full text-left px-3 py-2.5 rounded-md text-sm flex items-start gap-2 transition-colors mb-1 ${active ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : allowed ? "text-stone-700 hover:bg-stone-100" : "text-stone-400 cursor-not-allowed opacity-60"}`}
              >
                <Sparkles size={12} className={active ? "text-amber-700 mt-0.5" : "text-stone-400 mt-0.5"} />
                <span className="flex-1 min-w-0">
                  <div className="font-semibold">{a.label}</div>
                  <div className="text-[10px] text-stone-500 leading-snug mt-0.5">{a.description}</div>
                </span>
                {active && <ChevronRight size={12} className="text-amber-700 mt-1" />}
              </button>
            );
          })}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 border-b border-stone-200 bg-white sticky top-0 z-10">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="inline-flex items-center gap-2 mb-1">
                <span className="text-amber-700 text-xs uppercase tracking-[0.2em] font-bold">{agent?.label}</span>
                {!can(role, agent?.permissionAction || "") && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 uppercase tracking-wider">Restricted</span>
                )}
              </div>
              <h2 className="font-display text-2xl text-stone-900">{agent?.description}</h2>
              <p className="text-xs text-stone-500 mt-0.5">Requires <strong>{agent?.permissionAction}</strong> — your role: <strong>{role}</strong></p>
            </div>
            <div className="flex items-center gap-2">
              <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white">
                {accessibleProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={handleRun} disabled={busy || !can(role, agent?.permissionAction || "")} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-amber-700 hover:bg-amber-800 text-white disabled:bg-stone-300 disabled:cursor-not-allowed">
                <Play size={14} /> {busy ? "Running…" : "Run agent"}
              </button>
            </div>
          </div>
        </div>

        <div className="px-8 py-6">
          {!result ? (
            <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 p-12 text-center">
              <Bot size={28} className="mx-auto text-stone-400 mb-3" />
              <h3 className="font-display text-lg text-stone-900">Ready</h3>
              <p className="text-sm text-stone-500 mt-1">Hit "Run agent" to evaluate against the current state. Deterministic findings always run; LLM narrative if configured.</p>
            </div>
          ) : (
            <AgentResult result={result} />
          )}
        </div>
      </main>
    </div>
  );
}

function AgentResult({ result }) {
  if (result.status === "permission-denied") {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-6">
        <h3 className="font-display text-lg text-rose-700">Permission denied</h3>
        <p className="text-sm text-rose-900 mt-1">{result.reason}</p>
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-6">
        <h3 className="font-display text-lg text-rose-700">Error</h3>
        <p className="text-sm text-rose-900 mt-1">{result.error}</p>
      </div>
    );
  }

  const n = result.narrative || {};
  const verdictStyle = VERDICT_STYLE[n.verdict];

  return (
    <div className="space-y-5">
      {/* Status header */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${result.status === "ok" ? "bg-emerald-100 text-emerald-700" : result.status === "local" ? "bg-stone-100 text-stone-700" : "bg-amber-100 text-amber-700"}`}>
          {result.status === "ok" ? "AI-narrated" : result.status === "local" ? "Local only" : result.status}
        </span>
        <span className="text-xs text-stone-500 inline-flex items-center gap-1"><Clock size={11} />{fmtDateTime(result.runAt)}</span>
      </div>

      {/* Verdict banner */}
      {n.verdict && verdictStyle && (
        <div className={`rounded-xl border ring-1 ${verdictStyle.ring} ${verdictStyle.bg} p-4`}>
          <div className={`text-xs uppercase tracking-wider font-bold ${verdictStyle.color}`}>Verdict</div>
          <div className={`font-display text-xl ${verdictStyle.color} mt-0.5`}>{n.verdict}</div>
          {n.summary && <div className="text-sm text-stone-700 mt-2">{n.summary}</div>}
        </div>
      )}

      {/* Summary */}
      {!n.verdict && (n.summary || n.executiveSummary || n.headline) && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-2">Summary</div>
          <p className="text-sm text-stone-800">{n.summary || n.executiveSummary || n.headline}</p>
        </div>
      )}

      {/* Bullets (GM brief) */}
      {Array.isArray(n.bullets) && n.bullets.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3">Standup</div>
          <ul className="space-y-2">
            {n.bullets.map((b, i) => (
              <li key={i} className="text-sm text-stone-800 flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-700 mt-1.5 flex-shrink-0" />
                <div className="flex-1">
                  <strong className="text-stone-900">{b.topic}</strong>: {b.value}
                  {b.callout && <span className="ml-2 text-amber-700">— {b.callout}</span>}
                  {b.cite && <span className="ml-2 text-[10px] text-stone-400 font-mono">cite: {b.cite}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Top priorities / actions */}
      {Array.isArray(n.topPriorities) && n.topPriorities.length > 0 && (
        <SectionList title="Top priorities" items={n.topPriorities.map(p => ({ label: p }))} />
      )}
      {Array.isArray(n.opportunities) && n.opportunities.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3">Opportunities</div>
          <div className="space-y-3">
            {n.opportunities.map((o, i) => (
              <div key={i} className="border border-stone-200 rounded-md p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-stone-900">{o.title}</div>
                  <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${o.confidence === "high" ? "bg-emerald-100 text-emerald-700" : o.confidence === "medium" ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-600"}`}>{o.confidence}</span>
                </div>
                <p className="text-sm text-stone-700 mt-1">{o.rationale}</p>
                {o.estimatedLift && <div className="text-xs text-stone-500 mt-1">Est. lift: <strong className="text-stone-700">{o.estimatedLift}</strong></div>}
                {Array.isArray(o.actions) && o.actions.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {o.actions.map((a, j) => <li key={j} className="text-xs text-stone-700">→ {a}</li>)}
                  </ul>
                )}
                {o.cite && <div className="text-[10px] text-stone-400 font-mono mt-2">cite: {o.cite}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(n.recommendations) && n.recommendations.length > 0 && (
        <SectionList title="Recommendations" items={n.recommendations.map(r => ({ label: r.action, meta: `${r.owner || ""} · ${r.priority || ""}` }))} />
      )}
      {Array.isArray(n.actionPlan) && n.actionPlan.length > 0 && (
        <SectionList title="Action plan" items={n.actionPlan.map(r => ({ label: r.step, meta: `${r.owner || ""} · ${r.priority || ""}` }))} />
      )}
      {Array.isArray(n.actionItems) && n.actionItems.length > 0 && (
        <SectionList title="Action items" items={n.actionItems.map(r => ({ label: r.item, meta: `${r.owner || ""} · ${r.priority || ""}`, cite: r.cite }))} />
      )}
      {Array.isArray(n.rootCauses) && n.rootCauses.length > 0 && (
        <SectionList title="Root causes" items={n.rootCauses.map(r => ({ label: r.cause || r.hypothesis, meta: r.evidence, cite: r.cite }))} />
      )}
      {Array.isArray(n.topRisks) && n.topRisks.length > 0 && (
        <SectionList title="Top risks" items={n.topRisks.map(r => ({ label: r.label, meta: r.severity, cite: r.cite }))} />
      )}

      {/* Evidence */}
      {Array.isArray(n.evidence) && n.evidence.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3 flex items-center gap-1">
            <Hash size={11} /> Evidence cited
          </div>
          <ul className="space-y-1">
            {n.evidence.map((e, i) => (
              <li key={i} className="text-xs text-stone-700 font-mono">
                <span className="text-amber-700">{e.cite}</span>: <span className="text-stone-900">{e.fact}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deterministic always shown */}
      {result.deterministic && (
        <details className="rounded-xl border border-stone-200 bg-white">
          <summary className="px-4 py-3 cursor-pointer text-xs uppercase tracking-wider text-stone-500 font-bold flex items-center gap-2">
            <CheckCircle2 size={12} className="text-emerald-600" />
            Deterministic findings (always-on)
          </summary>
          <pre className="px-4 pb-3 text-[11px] text-stone-700 font-mono whitespace-pre-wrap break-all">{JSON.stringify(result.deterministic, null, 2)}</pre>
        </details>
      )}

      {result.error && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-700 mt-0.5" />
          <div className="text-xs text-amber-900">LLM call failed — falling back to local recap. Error: {result.error}</div>
        </div>
      )}
    </div>
  );
}

function SectionList({ title, items }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-stone-500 font-bold mb-3">{title}</div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-stone-800 flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-400 mt-1.5 flex-shrink-0" />
            <div className="flex-1">
              <div>{it.label}</div>
              {it.meta && <div className="text-[10px] uppercase tracking-wider text-stone-500 font-bold mt-0.5">{it.meta}</div>}
              {it.cite && <div className="text-[10px] text-stone-400 font-mono mt-0.5">cite: {it.cite}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
