/* HotelOps · AI Operations Layer
 * =================================================================
 * Hospitality-grounded Claude prompts for operational intelligence.
 * All callers go through callClaude() which honors the same proxy/key
 * wiring as auditParser/apAutomation. Outputs are structured JSON so
 * the UI can render them as KPI cards, not free-form prose.
 *
 * Capabilities:
 *   nightAuditAnomalies(report, baseline) — flag suspicious deltas
 *   varianceExplanation(actuals, budget)  — explain MTD/budget gaps
 *   laborWarnings(labor, forecast)        — overspend alerts with cause
 *   dailyRecap(report, prior, ytd)        — executive summary, 3 bullets
 *   revenueOpportunities(reports, comp)   — pricing/segment recommendations
 *
 * Falls back to deterministic local analysis when proxy/key is absent.
 */

const MODEL = "claude-sonnet-4-6";

function readLs(key) {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

export function isConfigured() {
  return !!(readLs("hotelops:proxyUrl") || readLs("hotelops:apiKey"));
}

/** Low-level call. Returns parsed JSON or null on failure. */
export async function callClaude({ system, user, maxTokens = 1500, model = MODEL }) {
  const proxyUrl = readLs("hotelops:proxyUrl");
  const proxyAuth = readLs("hotelops:proxyAuth");
  const apiKey = readLs("hotelops:apiKey");
  if (!proxyUrl && !apiKey) return null;

  const useProxy = !!proxyUrl;
  const endpoint = useProxy
    ? (proxyUrl.endsWith("/messages") ? proxyUrl : `${proxyUrl.replace(/\/$/, "")}/messages`)
    : "https://api.anthropic.com/v1/messages";
  const headers = { "Content-Type": "application/json" };
  if (useProxy) {
    if (proxyAuth) headers["X-HotelOps-Auth"] = proxyAuth;
  } else {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }

  const body = {
    model,
    max_tokens: maxTokens,
    system: system || "You are a senior hotel controller and revenue manager. Reply with strict JSON only, no prose, no markdown fences.",
    messages: [{ role: "user", content: user }],
  };

  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`AI proxy ${res.status}`);
  const data = await res.json();
  const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  const cleaned = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { return { _raw: txt }; }
}

/* =================================================================
   ANOMALY DETECTION — night-audit sanity check
   ================================================================= */

/** Compute baseline windows for a property. Returns null if insufficient history. */
export function buildBaseline(reports, propertyId, asOfDate) {
  const own = (reports || [])
    .filter(r => r.propertyId === propertyId && r.date < asOfDate)
    .sort((a, b) => a.date < b.date ? 1 : -1);
  if (own.length < 7) return null;
  const win = (n) => own.slice(0, n);
  const avg = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0) / Math.max(arr.length, 1);
  const asOf = new Date(asOfDate);
  const dow = asOf.getDay();
  const sameDow = own.filter(r => new Date(r.date).getDay() === dow).slice(0, 4);
  return {
    last7:   { rev: avg(win(7), "totalRevenue"),  occ: avg(win(7), "occupancy"),  adr: avg(win(7), "adr") },
    last30:  { rev: avg(win(30), "totalRevenue"), occ: avg(win(30), "occupancy"), adr: avg(win(30), "adr") },
    sameDow: sameDow.length
      ? { rev: avg(sameDow, "totalRevenue"), occ: avg(sameDow, "occupancy"), adr: avg(sameDow, "adr"), n: sameDow.length }
      : null,
  };
}

/** Local-only anomaly check: returns deterministic findings without calling Claude. */
export function localAnomalies(report, baseline) {
  const findings = [];
  if (!report || !baseline) return findings;
  const flag = (severity, code, label, detail) =>
    findings.push({ severity, code, label, detail, source: "local" });

  const deviation = (actual, base) => base ? (actual - base) / base : 0;

  if (baseline.sameDow) {
    const devRev = deviation(report.totalRevenue, baseline.sameDow.rev);
    if (Math.abs(devRev) > 0.35) {
      flag(Math.abs(devRev) > 0.5 ? "high" : "medium", "revenue.dow",
        `Revenue ${devRev > 0 ? "+" : ""}${(devRev * 100).toFixed(0)}% vs same-day-of-week avg`,
        `Actual ${money(report.totalRevenue)} · ${baseline.sameDow.n}-week avg ${money(baseline.sameDow.rev)}`);
    }
  }

  const devOcc = deviation(report.occupancy, baseline.last7.occ);
  if (Math.abs(devOcc) > 0.2) {
    flag("medium", "occupancy.7d",
      `Occupancy ${(report.occupancy * 100).toFixed(1)}% vs 7-day avg ${(baseline.last7.occ * 100).toFixed(1)}%`,
      `${devOcc > 0 ? "Spike" : "Drop"} of ${Math.abs(devOcc * 100).toFixed(1)} pts.`);
  }

  const devAdr = deviation(report.adr, baseline.last30.adr);
  if (Math.abs(devAdr) > 0.15 && report.adr > 0) {
    flag("medium", "adr.30d",
      `ADR ${money(report.adr)} ${devAdr > 0 ? "above" : "below"} 30-day avg ${money(baseline.last30.adr)}`,
      `${devAdr > 0 ? "+" : "−"}${Math.abs(devAdr * 100).toFixed(1)}% from baseline.`);
  }

  // Settlement vs revenue gap
  const b = report.breakdown || {};
  const settle = (b.payments?.cash || 0) + (b.payments?.creditCard || 0) + (b.payments?.directBill || 0) + (b.payments?.other || 0);
  const revTax = (b.revenue?.rooms || 0)
    + Object.values(b.revenue?.fb || {}).reduce((s, n) => s + (Number(n) || 0), 0)
    + Object.values(b.revenue?.other || {}).reduce((s, n) => s + (Number(n) || 0), 0)
    + Object.values(b.taxes || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  if (settle > 0 && Math.abs(settle - revTax) > Math.max(50, revTax * 0.02)) {
    flag("high", "settlement.gap",
      "Settlement does not reconcile to revenue + tax",
      `Settled ${money(settle)} · Rev+Tax ${money(revTax)} · Gap ${money(settle - revTax)}`);
  }

  if (report.occupancy > 1.05) {
    flag("high", "occupancy.impossible",
      `Occupancy ${(report.occupancy * 100).toFixed(1)}% exceeds physical capacity`,
      "Rooms-sold appears greater than rooms-available — check rollover from prior night.");
  }

  return findings;
}

/** Combined: local findings + (optional) Claude enrichment for narrative. */
export async function nightAuditAnomalies({ report, baseline, narrative = false }) {
  const findings = localAnomalies(report, baseline);
  if (!narrative || !isConfigured()) return { findings, narrative: null };

  const user = `You're auditing a hotel's night audit. Given the deterministic findings below, write a 2-sentence operator-facing recap and rank the most actionable issue. Return JSON:
{ "summary": string, "topAction": string, "rootCauseHypotheses": [string] }

Report date: ${report.date}
Findings (already detected locally):
${JSON.stringify(findings, null, 2)}

Baseline (same-day-of-week, 7d, 30d):
${JSON.stringify(baseline, null, 2)}`;

  try {
    const r = await callClaude({ user, maxTokens: 600 });
    return { findings, narrative: r };
  } catch {
    return { findings, narrative: null };
  }
}

/* =================================================================
   VARIANCE EXPLANATION — budget vs actual
   ================================================================= */

export async function varianceExplanation({ propertyName, month, actuals, budget }) {
  if (!isConfigured()) return null;
  const user = `Hotel: ${propertyName}. Period: ${month}. Explain budget variance like a controller would in a flash meeting. Be specific to hospitality (occupancy, ADR, F&B mix, labor productivity, OTA commissions). Return JSON:
{
  "verdict": "favorable" | "unfavorable" | "mixed",
  "drivers": [{ "metric": string, "delta": number, "cause": string, "impact": string }],
  "actions": [string]
}

Actuals: ${JSON.stringify(actuals)}
Budget:  ${JSON.stringify(budget)}`;
  try { return await callClaude({ user, maxTokens: 1200 }); } catch { return null; }
}

/* =================================================================
   LABOR WARNINGS — overspend with cause attribution
   ================================================================= */

export function localLaborWarnings({ laborCost, revenue, scheduleHours, actualHours, targetPct = 0.30 }) {
  const out = [];
  if (revenue > 0) {
    const pct = laborCost / revenue;
    if (pct > targetPct * 1.10) {
      out.push({
        severity: pct > targetPct * 1.25 ? "high" : "medium",
        code: "labor.pct",
        label: `Labor ${(pct * 100).toFixed(1)}% of revenue · target ${(targetPct * 100).toFixed(0)}%`,
        detail: `Overspend ${dollars((pct - targetPct) * revenue)} this window.`,
      });
    }
  }
  if (scheduleHours > 0 && actualHours > scheduleHours * 1.10) {
    out.push({
      severity: "medium",
      code: "labor.schedule_drift",
      label: `Clocked hours ${actualHours.toFixed(0)} vs scheduled ${scheduleHours.toFixed(0)}`,
      detail: `${((actualHours - scheduleHours) / scheduleHours * 100).toFixed(0)}% drift — coach the schedule.`,
    });
  }
  return out;
}

export async function laborWarnings(input) {
  const findings = localLaborWarnings(input);
  if (!findings.length || !isConfigured()) return { findings, narrative: null };
  const user = `Hotel labor variance investigation. Given the local findings, suggest 2 root causes specific to hospitality operations (event compression, call-outs, OT misuse, banquet labor not split, etc.). JSON:
{ "rootCauses": [{ "cause": string, "evidence": string, "fix": string }] }

Findings: ${JSON.stringify(findings)}
Inputs: ${JSON.stringify(input)}`;
  try {
    const narrative = await callClaude({ user, maxTokens: 600 });
    return { findings, narrative };
  } catch {
    return { findings, narrative: null };
  }
}

/* =================================================================
   DAILY RECAP — exec summary for management
   ================================================================= */

export async function dailyRecap({ report, prior, mtd, baseline }) {
  if (!isConfigured()) {
    // Local fallback recap
    return {
      summary: localRecap(report, prior, mtd),
      bullets: localRecapBullets(report, prior, mtd, baseline),
      _local: true,
    };
  }
  const user = `Write a 3-bullet executive recap for today's hotel performance. Bullets must be specific, with numbers, and operationally useful (not generic). Return JSON:
{
  "summary": string,
  "bullets": [{ "metric": string, "value": string, "vs": string, "callout": string }],
  "tomorrowFocus": string
}

Today: ${JSON.stringify(report)}
Prior day: ${JSON.stringify(prior)}
MTD: ${JSON.stringify(mtd)}
Baseline (DoW/7d/30d): ${JSON.stringify(baseline)}`;
  try { return await callClaude({ user, maxTokens: 1000 }); } catch { return null; }
}

function localRecap(today, prior, mtd) {
  if (!today) return "No report posted for the period.";
  const rev = today.totalRevenue || 0;
  const yoy = prior?.totalRevenue ? `${rev >= prior.totalRevenue ? "+" : ""}${((rev - prior.totalRevenue) / prior.totalRevenue * 100).toFixed(1)}% vs prior day` : "";
  return `Revenue ${money(rev)} · Occupancy ${pct(today.occupancy)} · ADR ${money(today.adr)} ${yoy}.`;
}

function localRecapBullets(today, prior, mtd, baseline) {
  if (!today) return [];
  const out = [];
  if (today.totalRevenue != null) {
    out.push({
      metric: "Revenue", value: money(today.totalRevenue),
      vs: prior ? `${diffPct(today.totalRevenue, prior.totalRevenue)} vs prior day` : "",
      callout: baseline?.sameDow ? `${diffPct(today.totalRevenue, baseline.sameDow.rev)} vs same-day-of-week` : "",
    });
  }
  if (today.occupancy != null) {
    out.push({
      metric: "Occupancy", value: pct(today.occupancy),
      vs: baseline?.last7 ? `${pts(today.occupancy, baseline.last7.occ)} pts vs 7-day` : "",
      callout: today.occupancy > 0.95 ? "Sold out — verify walk-in policy" : "",
    });
  }
  if (today.adr != null) {
    out.push({
      metric: "ADR", value: money(today.adr),
      vs: baseline?.last30 ? `${diffPct(today.adr, baseline.last30.adr)} vs 30-day` : "",
      callout: "",
    });
  }
  return out;
}

/* =================================================================
   REVENUE OPPORTUNITIES — pricing / segment recommendations
   ================================================================= */

export async function revenueOpportunities({ propertyName, reports, compSet = null }) {
  if (!isConfigured()) return null;
  const user = `You're a revenue manager for ${propertyName}. Identify 3 concrete revenue opportunities from the data. Avoid generic advice; cite specific dates or segments. Realism: independent/economy hotels in tertiary markets should NOT be told to "raise ADR to $300"; match recommendations to the property's apparent ADR band. Return JSON:
{
  "opportunities": [{
    "title": string,
    "rationale": string,
    "estimatedLift": string,
    "confidence": "high"|"medium"|"low",
    "actions": [string]
  }]
}

Last 30 reports: ${JSON.stringify((reports || []).slice(-30))}
Comp set (if available): ${JSON.stringify(compSet)}`;
  try { return await callClaude({ user, maxTokens: 1500 }); } catch { return null; }
}

/* =================================================================
   helpers
   ================================================================= */

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function dollars(n) { return money(n); }
function pct(n) { return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—"; }
function diffPct(a, b) {
  if (!b) return "";
  const d = (a - b) / b;
  return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
}
function pts(a, b) {
  if (a == null || b == null) return "";
  const d = (a - b) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}
