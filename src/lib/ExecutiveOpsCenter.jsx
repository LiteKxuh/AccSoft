/* HotelOps · Executive Operations Center
 * =================================================================
 * Dense, terminal-style command surface. Reads from:
 *   - hotelOperatingKernel (composite indices + pressure points)
 *   - operationalDigitalTwin (room inventory, HK load, cascade risks)
 *   - riskIntelligenceEngine (heatmap, timeline, top actions)
 *   - profitabilityEngine (GOP opportunities, leakage, productivity)
 *   - revenueAIEngine (opportunity ranking, OTA dependency)
 *
 * Layout philosophy: no oversized cards. Information density first.
 * Color used only for severity / status — never for decoration.
 */

import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, Building2, Cpu,
  DollarSign, Gauge, ShieldAlert, TrendingDown, TrendingUp, Users,
  Workflow, Zap,
} from "lucide-react";
import { buildOperationalGraph, buildPortfolioGraph, kernelOvernightDelta } from "./hotelOperatingKernel.js";
import { buildOperationalTwin } from "./operationalDigitalTwin.js";
import { runRiskIntelligence, runPortfolioRisk } from "./riskIntelligenceEngine.js";
import { runProfitability } from "./profitabilityEngine.js";
import { runRevenueAI } from "./revenueAIEngine.js";
import { evaluateAutonomous } from "./autonomousRules.js";

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(n, d = 0) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }
function fmtScore(n) { return Number.isFinite(n) ? `${Math.round(n)}` : "—"; }

const SEV_COLORS = {
  high:   { fg: "text-rose-600",    bg: "bg-rose-50",    border: "border-rose-200" },
  medium: { fg: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200" },
  low:    { fg: "text-sky-600",     bg: "bg-sky-50",     border: "border-sky-200" },
  info:   { fg: "text-stone-500",   bg: "bg-stone-50",   border: "border-stone-200" },
};

function indexColor(score, inverted = false) {
  // inverted = higher is better (hotel health). default = higher is worse.
  const good = inverted ? score >= 70 : score <= 30;
  const bad = inverted ? score < 40 : score >= 70;
  if (good) return "text-emerald-600";
  if (bad)  return "text-rose-600";
  return "text-amber-600";
}

export function ExecutiveOpsCenter({ ctx, enrichReport }) {
  const { state, accessibleProperties } = ctx;
  const asOf = new Date().toISOString().slice(0, 10);
  const propertyIds = useMemo(() => (accessibleProperties || []).map(p => p.id), [accessibleProperties]);
  const [selectedPropertyId, setSelectedPropertyId] = useState(propertyIds[0] || null);

  // Portfolio rollup
  const portfolio = useMemo(
    () => buildPortfolioGraph(state, { propertyIds, asOf, enrichReport }),
    [state, propertyIds.join(","), asOf, enrichReport]
  );

  const period = { start: asOf.slice(0, 7) + "-01", end: asOf };

  // Per-selected-property deep dive
  const selectedGraph = useMemo(
    () => selectedPropertyId ? buildOperationalGraph(state, { propertyId: selectedPropertyId, asOf, enrichReport }) : null,
    [state, selectedPropertyId, asOf, enrichReport]
  );
  const selectedTwin = useMemo(
    () => selectedPropertyId ? buildOperationalTwin(state, { propertyId: selectedPropertyId, asOf, enrichReport }) : null,
    [state, selectedPropertyId, asOf, enrichReport]
  );
  const overnight = useMemo(
    () => selectedPropertyId ? kernelOvernightDelta(state, { propertyId: selectedPropertyId, asOf, enrichReport }) : null,
    [state, selectedPropertyId, asOf, enrichReport]
  );
  const risk = useMemo(
    () => selectedPropertyId ? runRiskIntelligence(state, { propertyId: selectedPropertyId, period, asOf }) : null,
    [state, selectedPropertyId, asOf]
  );
  const portfolioRisk = useMemo(
    () => runPortfolioRisk(state, { propertyIds, period, asOf }),
    [state, propertyIds.join(","), asOf]
  );
  const profitability = useMemo(
    () => selectedPropertyId ? runProfitability({ state, propertyId: selectedPropertyId, period, laborCost: selectedGraph?.snap?.labor?.mtdCost || 0 }) : null,
    [state, selectedPropertyId, asOf, selectedGraph?.snap?.labor?.mtdCost]
  );
  const revenueAi = useMemo(
    () => selectedPropertyId ? runRevenueAI({ state, propertyId: selectedPropertyId, asOf, capacity: selectedGraph?.snap?.today?.roomsAvailable, enrichReport }) : null,
    [state, selectedPropertyId, asOf, enrichReport, selectedGraph?.snap?.today?.roomsAvailable]
  );
  const autonomousEvents = useMemo(
    () => selectedGraph ? evaluateAutonomous(selectedGraph, selectedTwin) : [],
    [selectedGraph, selectedTwin]
  );

  if (!propertyIds.length) {
    return (
      <div className="p-8 text-center text-stone-500">No accessible properties.</div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline justify-between flex-wrap gap-3 pb-3 border-b border-stone-200">
        <div>
          <div className="inline-flex items-center gap-2 mb-1">
            <span className="text-rose-700 text-[10px] uppercase tracking-[0.25em] font-bold">Executive Operations Center</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 uppercase tracking-wider">v1.20</span>
          </div>
          <h1 className="font-display text-2xl text-stone-900 leading-tight">
            {portfolio.coverage?.evaluated || 0} properties · {asOf}
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Indices computed by hotelOperatingKernel · risk via riskIntelligenceEngine · profitability via profitabilityEngine
          </p>
        </div>
        {portfolio.status === "ok" && (
          <div className="flex items-center gap-4">
            <IndexTile icon={Gauge} label="Health" value={fmtScore(portfolio.portfolio.hotelHealthIndex)} sub="/ 100" color={indexColor(portfolio.portfolio.hotelHealthIndex, true)} />
            <IndexTile icon={Users} label="Staff Stress" value={fmtScore(portfolio.portfolio.staffingStressIndex)} sub="/ 100" color={indexColor(portfolio.portfolio.staffingStressIndex)} />
            <IndexTile icon={ShieldAlert} label="Op Risk" value={fmtScore(portfolio.portfolio.operationalRiskScore)} sub="/ 100" color={indexColor(portfolio.portfolio.operationalRiskScore)} />
            <IndexTile icon={TrendingDown} label="Profit Pressure" value={fmtScore(portfolio.portfolio.profitabilityPressureScore)} sub="/ 100" color={indexColor(portfolio.portfolio.profitabilityPressureScore)} />
            <IndexTile icon={Activity} label="Guest Risk" value={fmtScore(portfolio.portfolio.guestRiskIndex)} sub="/ 100" color={indexColor(portfolio.portfolio.guestRiskIndex)} />
          </div>
        )}
      </div>

      {/* Portfolio ranking + risk surface */}
      <div className="grid grid-cols-12 gap-3">
        <SectionCard title="Property Ranking" subtitle="lowest health first" className="col-span-12 md:col-span-7">
          {portfolio.status === "ok" ? (
            <table className="w-full text-xs">
              <thead className="text-stone-500 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-2 py-1 font-medium">Property</th>
                  <th className="text-right px-2 py-1 font-medium">Health</th>
                  <th className="text-right px-2 py-1 font-medium">Staff Stress</th>
                  <th className="text-right px-2 py-1 font-medium">Op Risk</th>
                  <th className="text-right px-2 py-1 font-medium">Profit Pressure</th>
                  <th className="text-right px-2 py-1 font-medium">Guest Risk</th>
                  <th className="text-right px-2 py-1 font-medium">Pressure Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {[...portfolio.graphs].filter(g => g.status === "ok").sort((a, b) => a.indices.hotelHealthIndex - b.indices.hotelHealthIndex).map(g => {
                  const propName = state.properties?.find(p => p.id === g.propertyId)?.name || g.propertyId;
                  return (
                    <tr key={g.propertyId}
                        className={`cursor-pointer hover:bg-stone-50 ${selectedPropertyId === g.propertyId ? "bg-amber-50/50" : ""}`}
                        onClick={() => setSelectedPropertyId(g.propertyId)}>
                      <td className="px-2 py-1 font-medium text-stone-900">{propName}</td>
                      <td className={`px-2 py-1 text-right tabular font-semibold ${indexColor(g.indices.hotelHealthIndex, true)}`}>{g.indices.hotelHealthIndex}</td>
                      <td className={`px-2 py-1 text-right tabular ${indexColor(g.indices.staffingStressIndex)}`}>{g.indices.staffingStressIndex}</td>
                      <td className={`px-2 py-1 text-right tabular ${indexColor(g.indices.operationalRiskScore)}`}>{g.indices.operationalRiskScore}</td>
                      <td className={`px-2 py-1 text-right tabular ${indexColor(g.indices.profitabilityPressureScore)}`}>{g.indices.profitabilityPressureScore}</td>
                      <td className={`px-2 py-1 text-right tabular ${indexColor(g.indices.guestRiskIndex)}`}>{g.indices.guestRiskIndex}</td>
                      <td className="px-2 py-1 text-right tabular text-stone-700">{g.pressurePoints?.length || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty>No property data.</Empty>}
        </SectionCard>

        <SectionCard title="Risk Heatmap" subtitle={portfolioRisk.status === "ok" ? `score ${portfolioRisk.avgScore} avg` : ""} className="col-span-12 md:col-span-5">
          {portfolioRisk.status === "ok" ? (
            <RiskHeatmap perProperty={portfolioRisk.perProperty} onSelect={setSelectedPropertyId} selected={selectedPropertyId} state={state} />
          ) : <Empty>No risk data.</Empty>}
        </SectionCard>
      </div>

      {/* Property-deep-dive */}
      {selectedGraph?.status === "ok" && (
        <>
          <div className="flex items-baseline gap-2 pt-2 border-t border-stone-200">
            <span className="text-[10px] uppercase tracking-[0.25em] text-stone-500 font-bold">Selected</span>
            <h2 className="font-display text-lg text-stone-900">
              {state.properties?.find(p => p.id === selectedPropertyId)?.name || selectedPropertyId}
            </h2>
            <span className="text-xs text-stone-500">· {selectedGraph.tier} tier · health {selectedGraph.indices.hotelHealthIndex}/100</span>
          </div>

          <div className="grid grid-cols-12 gap-3">
            {/* Overnight delta */}
            <SectionCard title="What changed overnight" subtitle="vs yesterday's snapshot" className="col-span-12 md:col-span-4">
              {overnight?.status === "ok" ? (
                <OvernightPanel d={overnight} />
              ) : <Empty>Need two consecutive days of reports.</Empty>}
            </SectionCard>

            {/* Pressure points */}
            <SectionCard title="Pressure Points" subtitle={`${selectedGraph.pressurePoints?.length || 0} active`} className="col-span-12 md:col-span-4">
              <PressurePointsList items={selectedGraph.pressurePoints || []} />
            </SectionCard>

            {/* Autonomous actions */}
            <SectionCard title="Autonomous Action Queue" subtitle={`${autonomousEvents.length} rule(s) firing`} className="col-span-12 md:col-span-4">
              <AutonomousList events={autonomousEvents} />
            </SectionCard>
          </div>

          <div className="grid grid-cols-12 gap-3">
            {/* Operational twin */}
            <SectionCard title="Operational Twin" subtitle="real-time inventory & load" className="col-span-12 md:col-span-6">
              {selectedTwin?.status === "ok" ? (
                <TwinPanel twin={selectedTwin} />
              ) : <Empty>Twin unavailable.</Empty>}
            </SectionCard>

            {/* Risk timeline */}
            <SectionCard title="Risk Surface" subtitle={risk?.status === "ok" ? `band ${risk.riskBand} · score ${risk.riskScore}` : ""} className="col-span-12 md:col-span-6">
              {risk?.status === "ok" ? (
                <RiskPanel risk={risk} />
              ) : <Empty>No risk findings.</Empty>}
            </SectionCard>
          </div>

          <div className="grid grid-cols-12 gap-3">
            {/* Profitability opportunities */}
            <SectionCard title="Profitability Opportunities" subtitle={profitability?.gop?.status === "ok" ? `GOP ${(profitability.gop.gopPct * 100).toFixed(1)}% vs bench ${(profitability.gop.benchmarkGopPct * 100).toFixed(0)}%` : ""} className="col-span-12 md:col-span-6">
              {profitability?.opportunities?.opportunities?.length ? (
                <OpportunitiesList items={profitability.opportunities.opportunities} />
              ) : <Empty>No leaks detected.</Empty>}
            </SectionCard>

            {/* Revenue opportunities */}
            <SectionCard title="Revenue Opportunities" subtitle={revenueAi?.opportunities?.summary ? `${revenueAi.opportunities.summary.high} high · ${revenueAi.opportunities.summary.medium} med` : ""} className="col-span-12 md:col-span-6">
              {revenueAi?.opportunities?.opportunities?.length ? (
                <OpportunitiesList items={revenueAi.opportunities.opportunities} variant="revenue" />
              ) : <Empty>No revenue opportunities surfaced.</Empty>}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function SectionCard({ title, subtitle, children, className = "" }) {
  return (
    <div className={`rounded-lg border border-stone-200 bg-white overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-stone-100 bg-stone-50/50 flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-stone-700 font-bold">{title}</h3>
        {subtitle && <span className="text-[10px] text-stone-500">{subtitle}</span>}
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  );
}

function IndexTile({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">
        <Icon size={11} /> {label}
      </div>
      <div className={`font-display text-lg font-semibold tabular leading-none mt-0.5 ${color}`}>
        {value}<span className="text-[10px] text-stone-400 ml-0.5">{sub}</span>
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-[11px] text-stone-400 italic py-3 text-center">{children}</div>;
}

function OvernightPanel({ d }) {
  const dIdx = d.indexDelta || {};
  const rows = [
    { label: "Health", key: "hotelHealthIndex", inverted: true },
    { label: "Staffing", key: "staffingStressIndex" },
    { label: "Op Risk", key: "operationalRiskScore" },
    { label: "Profit", key: "profitabilityPressureScore" },
    { label: "Guest", key: "guestRiskIndex" },
  ];
  return (
    <div className="space-y-1.5">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-stone-100">
          {rows.map(r => {
            const delta = dIdx[r.key] || 0;
            const positive = r.inverted ? delta > 0 : delta < 0; // positive in "good" direction
            const Arrow = delta === 0 ? null : positive ? ArrowUp : ArrowDown;
            const color = delta === 0 ? "text-stone-400" : positive ? "text-emerald-600" : "text-rose-600";
            return (
              <tr key={r.key}>
                <td className="py-1 text-stone-700">{r.label}</td>
                <td className={`py-1 text-right tabular font-semibold ${color}`}>
                  {Arrow && <Arrow size={10} className="inline" />}{" "}
                  {delta > 0 ? "+" : ""}{delta}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(d.newPressurePoints?.length > 0 || d.resolvedPressurePoints?.length > 0) && (
        <div className="text-[10px] mt-2 space-y-0.5">
          {d.newPressurePoints?.length > 0 && (
            <div className="text-rose-600">+ {d.newPressurePoints.length} new pressure point(s)</div>
          )}
          {d.resolvedPressurePoints?.length > 0 && (
            <div className="text-emerald-600">- {d.resolvedPressurePoints.length} resolved</div>
          )}
        </div>
      )}
    </div>
  );
}

function PressurePointsList({ items }) {
  if (!items.length) return <Empty>No active pressure points.</Empty>;
  return (
    <ul className="space-y-1">
      {items.slice(0, 8).map((p, i) => {
        const c = SEV_COLORS[p.severity] || SEV_COLORS.info;
        return (
          <li key={i} className={`flex items-center gap-2 px-2 py-1 rounded border ${c.border} ${c.bg}`}>
            <AlertTriangle size={11} className={c.fg} />
            <span className="text-xs text-stone-800 flex-1">{p.label}</span>
            <span className={`text-[9px] uppercase font-bold ${c.fg}`}>{p.severity}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AutonomousList({ events }) {
  if (!events.length) return <Empty>System running clean.</Empty>;
  return (
    <ul className="space-y-1">
      {events.slice(0, 8).map((e, i) => {
        const c = SEV_COLORS[e.severity] || SEV_COLORS.info;
        return (
          <li key={i} className={`flex items-start gap-2 px-2 py-1 rounded border ${c.border} ${c.bg}`}>
            <Workflow size={11} className={`mt-0.5 ${c.fg}`} />
            <div className="flex-1">
              <div className="text-xs text-stone-800">{e.label}</div>
              <div className="text-[10px] text-stone-500">{e.ruleId} → {e.payload?.suggestedRecipient || "—"}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TwinPanel({ twin }) {
  const inv = twin.inventory;
  const hk = twin.housekeeping;
  const ad = twin.arrivalsDepartures;
  const mb = twin.maintenance;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Sellable" value={inv.sellable ?? "—"} />
        <MiniStat label="Occupied" value={inv.occupied ?? "—"} />
        <MiniStat label="OOO" value={inv.outOfOrder ?? 0} tone={(inv.outOfOrder ?? 0) > 0 ? "warn" : "neutral"} />
        <MiniStat label="Ready" value={inv.readyToSell ?? 0} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Arriving" value={ad.arriving} />
        <MiniStat label="Departing" value={ad.departing} />
        <MiniStat label="Stayover" value={ad.stayover} />
      </div>
      <div className="border-t border-stone-100 pt-2">
        <div className="flex justify-between text-[10px] uppercase text-stone-500 mb-1">
          <span>Housekeeping load</span>
          <span className={hk.status_ === "understaffed" ? "text-rose-600" : "text-stone-500"}>
            {hk.shiftsScheduled} / {hk.shiftsNeeded} shifts
          </span>
        </div>
        <div className="text-xs text-stone-700">
          {hk.roomsToClean} rooms to clean · gap {hk.gap > 0 ? `+${hk.gap}` : hk.gap}
        </div>
      </div>
      {mb.status === "ok" && (
        <div className="border-t border-stone-100 pt-2">
          <div className="text-[10px] uppercase text-stone-500 mb-1">Maintenance</div>
          <div className="text-xs text-stone-700">
            {mb.openTickets} open · {mb.byPriority.critical} critical · {mb.agedTickets} aged 7d+
          </div>
        </div>
      )}
      {twin.cascadeRisks?.length > 0 && (
        <div className="border-t border-stone-100 pt-2">
          <div className="text-[10px] uppercase text-rose-600 mb-1">Cascade risks</div>
          {twin.cascadeRisks.map((c, i) => (
            <div key={i} className="text-xs text-stone-800">
              <span className="font-semibold">{c.source}</span> → {c.impact?.map(x => x.downstream).join(" → ") || ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone = "neutral" }) {
  const c = tone === "warn" ? "text-rose-600" : "text-stone-900";
  return (
    <div className="rounded border border-stone-100 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className={`font-display text-base tabular font-semibold ${c}`}>{value}</div>
    </div>
  );
}

function RiskPanel({ risk }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1">
        {Object.entries(risk.byCategory || {}).map(([cat, info]) => (
          <div key={cat} className="rounded border border-stone-100 px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-stone-500">{cat}</div>
            <div className="text-sm tabular font-semibold text-stone-900">{info.count}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {(risk.topActions || []).slice(0, 5).map((a, i) => {
          const c = SEV_COLORS[a.severity] || SEV_COLORS.info;
          return (
            <div key={i} className={`px-2 py-1 rounded text-xs ${c.bg} ${c.border} border`}>
              <span className={`font-semibold ${c.fg}`}>{a.label}</span>
              <div className="text-[10px] text-stone-600 mt-0.5">{a.action}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OpportunitiesList({ items, variant = "profitability" }) {
  return (
    <ul className="space-y-1">
      {items.slice(0, 8).map((o, i) => {
        const c = SEV_COLORS[o.severity] || SEV_COLORS.info;
        const Icon = variant === "revenue" ? TrendingUp : DollarSign;
        return (
          <li key={i} className={`flex items-start gap-2 px-2 py-1 rounded border ${c.border} ${c.bg}`}>
            <Icon size={11} className={`mt-0.5 ${c.fg}`} />
            <div className="flex-1">
              <div className="text-xs text-stone-800">{o.label}</div>
              <div className="text-[10px] text-stone-500">{o.rationale}</div>
              {(o.dollarsAtRisk || o.expectedRevparLift) && (
                <div className="text-[10px] text-stone-600 mt-0.5">
                  {o.dollarsAtRisk ? `~${fmtMoney(o.dollarsAtRisk)} at risk` : ""}
                  {o.expectedRevparLift ? `~${fmtMoney(o.expectedRevparLift)} RevPAR lift` : ""}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RiskHeatmap({ perProperty, onSelect, selected, state }) {
  // Build a tile per property colored by risk band
  const bandColor = {
    clean:     "bg-emerald-100 text-emerald-700 border-emerald-200",
    low:       "bg-sky-100     text-sky-700     border-sky-200",
    elevated:  "bg-amber-100   text-amber-800   border-amber-200",
    high:      "bg-rose-100    text-rose-700    border-rose-200",
    critical:  "bg-rose-200    text-rose-800    border-rose-300",
  };
  return (
    <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
      {perProperty.map(p => {
        const name = state.properties?.find(prop => prop.id === p.propertyId)?.name || p.propertyId;
        const c = bandColor[p.riskBand] || bandColor.clean;
        const isSelected = selected === p.propertyId;
        return (
          <button key={p.propertyId} onClick={() => onSelect(p.propertyId)}
            className={`text-left px-2 py-1.5 rounded border text-xs font-medium ${c} ${isSelected ? "ring-2 ring-stone-900" : ""}`}>
            <div className="truncate">{name}</div>
            <div className="text-[9px] uppercase tracking-wider opacity-70">{p.riskBand} · {p.riskScore}</div>
          </button>
        );
      })}
    </div>
  );
}
