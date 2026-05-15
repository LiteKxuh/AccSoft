/* HotelOps · Canonical KPI Registry
 * =================================================================
 * Single source of truth for every operational + financial metric.
 * Modules that previously computed ADR / Occupancy / RevPAR / etc.
 * inline now resolve through this registry — duplicate math is the
 * #1 source of "the numbers don't match between panes" bugs in
 * legacy hospitality systems.
 *
 * Each KPI has:
 *   - id: stable short identifier
 *   - label: display label
 *   - unit: "currency" | "percent" | "rooms" | "hours" | "ratio"
 *   - kind: "primary" | "derived" | "ratio"
 *   - inputs: array of input field paths it reads
 *   - compute(input): pure function returning { value, ok, source?, notes? }
 *   - format(value): for display
 *   - guardrails: realism check { min, max, warnAbove?, warnBelow? }
 *
 * Public API:
 *   getKpi(id)
 *   registerKpi(def)
 *   computeKpi(id, inputs)
 *   listKpis(category?)
 *   validateInputs(id, inputs) → null | string
 */

const REGISTRY = new Map();

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function pctFmt(n, d = 1) { return Number.isFinite(n) ? `${(n * 100).toFixed(d)}%` : "—"; }
function moneyFmt(n) {
  const v = safe(n);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function moneyShort(n) {
  const v = safe(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return moneyFmt(v);
}

/* ============ Built-in KPIs ============ */

/** Occupancy = rooms sold / rooms available. Clamped to [0, 1.05] realism. */
registerKpi({
  id: "occupancy", label: "Occupancy",
  unit: "percent", kind: "primary",
  category: "operations",
  inputs: ["roomsSold", "roomsAvailable"],
  guardrails: { min: 0, max: 1.05, warnAbove: 1.0 },
  compute({ roomsSold, roomsAvailable }) {
    const sold = safe(roomsSold), avail = safe(roomsAvailable);
    if (avail <= 0) return { value: 0, ok: false, notes: "no rooms available" };
    const value = sold / avail;
    return { value, ok: value >= 0 && value <= 1.05, source: "kpi.occupancy" };
  },
  format: (v) => pctFmt(v),
});

/** ADR = room revenue / rooms sold. */
registerKpi({
  id: "adr", label: "ADR",
  unit: "currency", kind: "primary",
  category: "operations",
  inputs: ["roomRevenue", "roomsSold"],
  guardrails: { min: 0, max: 100_000, warnAbove: 5_000 },
  compute({ roomRevenue, roomsSold }) {
    const rev = safe(roomRevenue), sold = safe(roomsSold);
    if (sold <= 0) {
      if (rev > 0) return { value: 0, ok: false, notes: "rooms-sold = 0 with positive room revenue" };
      return { value: 0, ok: true, source: "kpi.adr" };
    }
    const value = rev / sold;
    return { value, ok: true, source: "kpi.adr" };
  },
  format: (v) => moneyFmt(v),
});

/** RevPAR = room revenue / rooms available  (== ADR × Occupancy). */
registerKpi({
  id: "revpar", label: "RevPAR",
  unit: "currency", kind: "derived",
  category: "operations",
  inputs: ["roomRevenue", "roomsAvailable"],
  guardrails: { min: 0, max: 100_000 },
  compute({ roomRevenue, roomsAvailable }) {
    const rev = safe(roomRevenue), avail = safe(roomsAvailable);
    if (avail <= 0) return { value: 0, ok: false, notes: "no rooms available" };
    return { value: rev / avail, ok: true, source: "kpi.revpar" };
  },
  format: (v) => moneyFmt(v),
});

/** RevPOR (revenue per occupied room) = total revenue / rooms sold. */
registerKpi({
  id: "revpor", label: "RevPOR",
  unit: "currency", kind: "ratio",
  category: "operations",
  inputs: ["totalRevenue", "roomsSold"],
  guardrails: { min: 0, max: 100_000 },
  compute({ totalRevenue, roomsSold }) {
    const rev = safe(totalRevenue), sold = safe(roomsSold);
    if (sold <= 0) return { value: 0, ok: false, notes: "no rooms sold" };
    return { value: rev / sold, ok: true };
  },
  format: (v) => moneyFmt(v),
});

/** CPOR (cost per occupied room) = total cost / rooms sold. */
registerKpi({
  id: "cpor", label: "CPOR",
  unit: "currency", kind: "ratio",
  category: "operations",
  inputs: ["totalCost", "roomsSold"],
  guardrails: { min: 0, max: 100_000 },
  compute({ totalCost, roomsSold }) {
    const cost = safe(totalCost), sold = safe(roomsSold);
    if (sold <= 0) return { value: 0, ok: false, notes: "no rooms sold" };
    return { value: cost / sold, ok: true };
  },
  format: (v) => moneyFmt(v),
});

/** Labor cost as % of revenue. */
registerKpi({
  id: "labor.pctRev", label: "Labor % of Revenue",
  unit: "percent", kind: "ratio",
  category: "labor",
  inputs: ["laborCost", "totalRevenue"],
  guardrails: { min: 0, max: 1.5, warnAbove: 0.40, warnBelow: 0.15 },
  compute({ laborCost, totalRevenue }) {
    const cost = safe(laborCost), rev = safe(totalRevenue);
    if (rev <= 0) return { value: 0, ok: false, notes: "no revenue" };
    return { value: cost / rev, ok: true };
  },
  format: (v) => pctFmt(v),
});

/** Labor cost per occupied room. */
registerKpi({
  id: "labor.cpor", label: "Labor CPOR",
  unit: "currency", kind: "ratio",
  category: "labor",
  inputs: ["laborCost", "roomsSold"],
  compute({ laborCost, roomsSold }) {
    const cost = safe(laborCost), sold = safe(roomsSold);
    if (sold <= 0) return { value: 0, ok: false, notes: "no rooms sold" };
    return { value: cost / sold, ok: true };
  },
  format: (v) => moneyFmt(v),
});

/** GOP margin = gross operating profit / total revenue. */
registerKpi({
  id: "gop.margin", label: "GOP Margin",
  unit: "percent", kind: "ratio",
  category: "financial",
  inputs: ["gop", "totalRevenue"],
  guardrails: { min: -0.5, max: 0.7, warnAbove: 0.55, warnBelow: 0.10 },
  compute({ gop, totalRevenue }) {
    const g = safe(gop), rev = safe(totalRevenue);
    if (rev <= 0) return { value: 0, ok: false, notes: "no revenue" };
    return { value: g / rev, ok: true };
  },
  format: (v) => pctFmt(v),
});

/** NOI margin = net operating income / total revenue. */
registerKpi({
  id: "noi.margin", label: "NOI Margin",
  unit: "percent", kind: "ratio",
  category: "financial",
  inputs: ["noi", "totalRevenue"],
  guardrails: { min: -0.5, max: 0.5, warnAbove: 0.40, warnBelow: 0.05 },
  compute({ noi, totalRevenue }) {
    const n = safe(noi), rev = safe(totalRevenue);
    if (rev <= 0) return { value: 0, ok: false, notes: "no revenue" };
    return { value: n / rev, ok: true };
  },
  format: (v) => pctFmt(v),
});

/** Flow-through = change in profit / change in revenue (YoY or vs budget). */
registerKpi({
  id: "flowthrough", label: "Flow-through",
  unit: "percent", kind: "ratio",
  category: "financial",
  inputs: ["profitDelta", "revenueDelta"],
  compute({ profitDelta, revenueDelta }) {
    const p = safe(profitDelta), r = safe(revenueDelta);
    if (r === 0) return { value: 0, ok: false, notes: "no revenue delta" };
    return { value: p / r, ok: true };
  },
  format: (v) => pctFmt(v),
});

/* ============ Public API ============ */

export function registerKpi(def) {
  if (!def?.id) throw new Error("registerKpi: id required");
  if (typeof def.compute !== "function") throw new Error("registerKpi: compute() required");
  if (typeof def.format !== "function") def.format = (v) => String(v);
  REGISTRY.set(def.id, def);
  return def;
}

export function getKpi(id) {
  return REGISTRY.get(id) || null;
}

export function listKpis(category = null) {
  const all = Array.from(REGISTRY.values());
  return category ? all.filter(k => k.category === category) : all;
}

/**
 * Compute a KPI with realism-clamped output. Returns the structured
 * result + a guardrail flag when the value is outside the realistic
 * band — surfaces to the UI as a "verify data" badge.
 */
export function computeKpi(id, inputs) {
  const def = REGISTRY.get(id);
  if (!def) return { value: null, ok: false, notes: `unknown KPI ${id}`, kpi: id };
  const result = def.compute(inputs || {});
  const value = result.value;
  const guard = def.guardrails || {};
  let guardFlag = null;
  if (Number.isFinite(value)) {
    if (guard.min != null && value < guard.min) guardFlag = "below-floor";
    else if (guard.max != null && value > guard.max) guardFlag = "above-ceiling";
    else if (guard.warnAbove != null && value > guard.warnAbove) guardFlag = "warn-high";
    else if (guard.warnBelow != null && value < guard.warnBelow) guardFlag = "warn-low";
  }
  return { ...result, kpi: id, label: def.label, unit: def.unit, formatted: def.format(value), guardFlag };
}

/** Compute every KPI a payload supports. */
export function computeAllForPayload(inputs) {
  const out = {};
  for (const k of REGISTRY.values()) {
    const hasInputs = (k.inputs || []).every(p => inputs[p] !== undefined);
    if (!hasInputs) continue;
    out[k.id] = computeKpi(k.id, inputs);
  }
  return out;
}

/** Validate that inputs satisfy a KPI's stated dependencies. */
export function validateInputs(id, inputs) {
  const def = REGISTRY.get(id);
  if (!def) return `unknown KPI ${id}`;
  for (const f of (def.inputs || [])) {
    if (inputs[f] === undefined || inputs[f] === null) return `missing input "${f}" for ${id}`;
  }
  return null;
}

/* Format helpers re-exported so callers stop reimplementing them. */
export { pctFmt, moneyFmt, moneyShort };
