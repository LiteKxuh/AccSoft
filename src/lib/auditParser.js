/* HotelOps · Adaptive Audit Parser
 * =================================================================
 * Inspired by Innflow / M3 — but format-agnostic.
 *
 * Goal: hand it ANY night-audit / final flash / daily report in plain text
 * (pasted from a PMS, copy/pasted email, OCR'd PDF, etc.) and get a
 * normalized HotelOps report back — without needing the LLM at all.
 *
 * It works by:
 *   1. Tokenizing lines into (label, number) pairs.
 *   2. Fuzzy-matching labels against a synonym dictionary (USALI-aligned).
 *   3. Pattern-aware extraction of dates, room counts, percentages.
 *   4. Cross-validation (revenue components must sum to total, etc.).
 *   5. Heuristic property matching by name/keyword.
 *   6. Locally-generated insights (no API needed).
 *
 * If a Claude API key is configured, callExtractionAPI() can layer on top —
 * but the parser stands alone and is the primary engine.
 */

// ---------- helpers ----------
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stripCurrency = (s) =>
  String(s).replace(/[$£€,]/g, "").replace(/\s+/g, "").trim();

/** Parse a number from arbitrary string. Handles "$1,234.56", "(123.00)" (negative), "12.5%". */
export function parseNum(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // parens denote negative
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  // strip percent
  const isPct = /%$/.test(s);
  s = stripCurrency(s).replace(/%/g, "");
  if (!s || s === "-" || s === "—") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (neg ? -n : n) * (isPct ? 0.01 : 1);
}

/** Extract YYYY-MM-DD from any common date format. */
export function parseDate(text) {
  if (!text) return null;
  const t = String(text);
  // ISO YYYY-MM-DD or YYYY/MM/DD
  let m = t.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // US M/D/YYYY or M-D-YY
  m = t.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = (Number(y) >= 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // "March 14, 2026" or "Mar 14 2026" or "14 March 2026"
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    january: "01", february: "02", march: "03", april: "04", june: "06",
    july: "07", august: "08", september: "09", october: "10",
    november: "11", december: "12",
  };
  m = t.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})?/i);
  if (m && months[m[1].toLowerCase()]) {
    const yr = m[3] || new Date().getFullYear();
    return `${yr}-${months[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  }
  m = t.match(/(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})?/i);
  if (m && months[m[2].toLowerCase()]) {
    const yr = m[3] || new Date().getFullYear();
    return `${yr}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// ---------- field synonyms (label → canonical path) ----------
// Each entry is keyword[s] that should match the field.
const FIELD_MAP = [
  // ROOMS
  { path: "rooms.available", keys: ["rooms available", "available rooms", "total rooms", "inventory", "rooms inv"] },
  { path: "rooms.outOfOrder", keys: ["out of order", "ooo", "out-of-order", "rooms ooo"] },
  { path: "rooms.sold", keys: ["rooms sold", "rooms occupied", "occupied rooms", "sold rooms", "rooms rented", "occupancy rooms", "rms sold"] },
  { path: "rooms.comp", keys: ["comp rooms", "complimentary", "comps", "house use"] },
  { path: "rooms.transient", keys: ["transient", "trans rooms", "transient rooms"] },
  { path: "rooms.group", keys: ["group rooms", "group", "block rooms"] },
  { path: "rooms.walkIns", keys: ["walk-ins", "walk ins", "walkins", "walk in"] },
  { path: "rooms.noShows", keys: ["no-shows", "no shows", "noshows"] },

  // REVENUE — rooms
  { path: "revenue.rooms", keys: ["room revenue", "rooms revenue", "room rev", "lodging revenue", "transient room revenue", "guest rooms revenue"] },

  // F&B
  { path: "revenue.fb.restaurant", keys: ["restaurant", "café", "cafe", "food revenue", "dining", "breakfast revenue", "kitchen", "f&b food"] },
  { path: "revenue.fb.bar", keys: ["bar", "lounge", "beverage", "liquor", "cocktail", "wine"] },
  { path: "revenue.fb.banquet", keys: ["banquet", "catering", "events", "meeting room", "audio visual", "av charges"] },

  // OTHER
  { path: "revenue.other.parking", keys: ["parking", "valet", "garage"] },
  { path: "revenue.other.spa", keys: ["spa", "wellness", "salon", "massage"] },
  { path: "revenue.other.telephone", keys: ["telephone", "phone", "long distance"] },
  { path: "revenue.other.misc", keys: ["misc", "miscellaneous", "sundry", "gift shop", "retail", "merchandise", "pet fee", "resort fee", "internet", "wifi", "vending"] },

  // TAX
  { path: "taxes.occupancy", keys: ["occupancy tax", "occ tax", "lodging tax", "transient occupancy"] },
  { path: "taxes.sales", keys: ["sales tax", "state tax", "state sales"] },
  { path: "taxes.tourism", keys: ["tourism tax", "tourism", "convention tax", "city tax", "destination fee"] },

  // PAYMENT / SETTLEMENT
  { path: "payments.cash", keys: ["cash", "cash payment", "cash receipts"] },
  { path: "payments.creditCard", keys: ["credit card", "credit cards", "cc", "card", "visa", "mastercard", "amex"] },
  { path: "payments.directBill", keys: ["direct bill", "city ledger", "dir bill", "ar", "accounts receivable"] },
  { path: "payments.other", keys: ["other payments", "check", "cheque", "gift card"] },

  // ADJUSTMENTS
  { path: "adjustments.comps", keys: ["comps", "complimentary"] },
  { path: "adjustments.rebates", keys: ["rebates", "rebate"] },
  { path: "adjustments.allowances", keys: ["allowances", "allowance", "discounts", "adjustments"] },

  // GUESTS
  { path: "guests.totalGuests", keys: ["guests in house", "guest count", "total guests", "pax"] },
  { path: "guests.newCheckIns", keys: ["check-ins", "check ins", "checkins", "arrivals"] },
  { path: "guests.checkOuts", keys: ["check-outs", "check outs", "checkouts", "departures"] },
  { path: "guests.stayovers", keys: ["stayovers", "stay overs", "stay-overs"] },

  // KPIs (we'll catch but typically derive)
  { path: "_kpi.adr", keys: ["adr", "avg daily rate", "average daily rate", "avg rate"] },
  { path: "_kpi.revpar", keys: ["revpar", "rev par", "revenue per available room"] },
  { path: "_kpi.occupancy", keys: ["occupancy", "occ%", "occ %", "occupancy pct", "occupancy percent"] },

  // SEGMENT / CHANNEL — high-value mix data hotel CFOs ask for
  { path: "segments.transient.rooms", keys: ["transient rooms", "trans rooms", "transient nights"] },
  { path: "segments.transient.revenue", keys: ["transient revenue", "transient room revenue", "trans rev"] },
  { path: "segments.group.rooms", keys: ["group rooms", "group nights", "block rooms"] },
  { path: "segments.group.revenue", keys: ["group revenue", "group room revenue"] },
  { path: "segments.contract.rooms", keys: ["contract rooms", "crew rooms", "permanent rooms"] },
  { path: "segments.contract.revenue", keys: ["contract revenue"] },

  { path: "channels.direct.rooms", keys: ["direct rooms", "brand.com rooms", "direct bookings", "website bookings"] },
  { path: "channels.direct.revenue", keys: ["direct revenue", "brand.com revenue"] },
  { path: "channels.gds.rooms", keys: ["gds rooms", "gds nights"] },
  { path: "channels.gds.revenue", keys: ["gds revenue"] },
  { path: "channels.ota.rooms", keys: ["ota rooms", "expedia rooms", "booking.com rooms", "ota nights"] },
  { path: "channels.ota.revenue", keys: ["ota revenue", "expedia revenue", "booking.com revenue"] },
  { path: "channels.wholesale.rooms", keys: ["wholesale rooms", "wholesaler", "tour series"] },
  { path: "channels.wholesale.revenue", keys: ["wholesale revenue"] },
];

// pre-compute normalized search keys
FIELD_MAP.forEach((f) => { f._normKeys = f.keys.map(norm); });

// score a label against a field; higher = better match
function scoreLabel(label, field) {
  const n = norm(label);
  if (!n) return 0;
  let best = 0;
  for (const k of field._normKeys) {
    if (n === k) return 1.0;
    if (n.includes(k)) {
      // longer keyword matched in the label → stronger signal
      best = Math.max(best, 0.6 + Math.min(0.35, k.length / 40));
    } else if (k.includes(n) && n.length >= 3) {
      best = Math.max(best, 0.45);
    } else {
      // word-overlap (jaccard-ish)
      const aw = new Set(n.split(" "));
      const bw = new Set(k.split(" "));
      let inter = 0;
      aw.forEach((w) => bw.has(w) && inter++);
      const jacc = inter / (aw.size + bw.size - inter || 1);
      if (jacc > 0.5) best = Math.max(best, 0.4 + jacc * 0.2);
    }
  }
  return best;
}

function setPath(obj, path, val) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = val;
}
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? null : o[k]), obj);
}

// ---------- line tokenizer ----------
// Pull (label, number) candidates out of a line. Handles common shapes like:
//   Rooms Sold:        67
//   Restaurant         $812.50
//   ADR ............ $148.20
//   Total Revenue $11,222.90
//   "Room Revenue, $9,929.40"
function tokenizeLine(line) {
  if (!line) return [];
  const out = [];
  // strip dot-leaders / extra whitespace
  const cleaned = line.replace(/\.{2,}/g, " ").replace(/\s{2,}/g, "  ");
  // Pattern A: label : number   (or "label number" with $/% in number)
  const m = cleaned.match(/^([A-Za-z][A-Za-z0-9 \-/&%'.,()]*?)[:\-=\s]{1,5}(\(?[$\-]?[\d,]+(?:\.\d+)?\)?%?)\s*$/);
  if (m) {
    out.push({ label: m[1].trim(), raw: m[2].trim() });
    return out;
  }
  // Pattern B: label    number
  const m2 = cleaned.match(/^(.+?)\s{2,}(\(?[$\-]?[\d,]+(?:\.\d+)?\)?%?)\s*$/);
  if (m2) {
    out.push({ label: m2[1].trim(), raw: m2[2].trim() });
    return out;
  }
  // Pattern C: tabular row "label \t number"
  const m3 = cleaned.match(/^(.+?)\t+(\(?[$\-]?[\d,]+(?:\.\d+)?\)?%?)\s*$/);
  if (m3) {
    out.push({ label: m3[1].trim(), raw: m3[2].trim() });
    return out;
  }
  // Pattern D: multiple inline pairs, e.g. "Restaurant: $812.50  Bar: $245.00"
  const re = /([A-Za-z][A-Za-z0-9 \-/&'.]+?)\s*[:=]\s*(\(?[$\-]?[\d,]+(?:\.\d+)?\)?%?)/g;
  let mm;
  while ((mm = re.exec(cleaned))) {
    out.push({ label: mm[1].trim(), raw: mm[2].trim() });
  }
  return out;
}

// ---------- the main parser ----------
/**
 * @param {string} text  raw audit text
 * @param {Array<{id,name,location,rooms}>} properties  available properties for matching
 * @returns extracted shape compatible with HotelOps reports
 */
export function parseAuditText(text, properties = []) {
  const out = {
    date: null,
    propertyId: null,
    propertyName: null,
    rooms: {}, revenue: { fb: {}, other: {} }, taxes: {}, payments: {}, adjustments: {}, guests: {},
    segments: { transient: {}, group: {}, contract: {} },
    channels: { direct: {}, gds: {}, ota: {}, wholesale: {} },
    confidence: 0,
    warnings: [],
    insights: [],
    _kpi: {},
    _trace: [], // for debugging
  };

  const lines = String(text || "").split(/\r?\n/);
  // 1) Date — try to find anywhere in the doc
  for (const line of lines) {
    const d = parseDate(line);
    if (d) { out.date = d; break; }
  }

  // 2) Property match — search on full text
  const fullNorm = norm(text);
  if (properties.length) {
    let bestProp = null;
    let bestScore = 0;
    properties.forEach((p) => {
      // Match on name, location, AND any user-defined aliases
      const namesToTry = [p.name, ...(p.aliases || [])];
      let score = 0;
      namesToTry.forEach((nm) => {
        const tokens = norm(nm).split(" ").filter(Boolean);
        tokens.forEach((t) => {
          if (t.length >= 3 && fullNorm.includes(t)) score += t.length >= 4 ? 1 : 0.5;
        });
      });
      // location words
      const loc = norm(p.location || "").split(",")[0];
      if (loc && fullNorm.includes(loc)) score += 0.5;
      if (score > bestScore) { bestScore = score; bestProp = p; }
    });
    if (bestProp && bestScore > 0) {
      out.propertyId = bestProp.id;
      out.propertyName = bestProp.name;
    } else if (properties.length === 1) {
      out.propertyId = properties[0].id;
      out.propertyName = properties[0].name;
    }
  }

  // 3) Walk lines, collect labelled values
  let captured = 0;
  let totalRevenueExplicit = null;
  for (const line of lines) {
    const tokens = tokenizeLine(line);
    for (const tok of tokens) {
      const num = parseNum(tok.raw);
      if (num == null) continue;
      // explicit "total revenue" capture
      if (/total\s*(?:room\s*)?(?:rev(?:enue)?|sales)/i.test(tok.label)) {
        totalRevenueExplicit = totalRevenueExplicit == null ? num : Math.max(totalRevenueExplicit, num);
        out._trace.push({ line, label: tok.label, val: num, mapped: "totalRevenue" });
        continue;
      }
      // score against every field, take the best
      let bestField = null;
      let bestScore = 0;
      for (const f of FIELD_MAP) {
        const s = scoreLabel(tok.label, f);
        if (s > bestScore) { bestScore = s; bestField = f; }
      }
      if (bestField && bestScore >= 0.55) {
        // skip if already filled with a stronger source
        const existing = getPath(out, bestField.path);
        if (existing == null || bestScore > 0.85) {
          setPath(out, bestField.path, num);
          captured++;
          out._trace.push({ line, label: tok.label, val: num, mapped: bestField.path, score: +bestScore.toFixed(2) });
        }
      }
    }
  }

  // 4) Cross-fill / derive / sanity check
  // ADR derivation
  const sold = out.rooms.sold;
  const avail = out.rooms.available;
  const roomRev = out.revenue.rooms;
  if (out._kpi.adr == null && sold && roomRev) out._kpi.adr = roomRev / sold;
  if (out._kpi.revpar == null && avail && roomRev) out._kpi.revpar = roomRev / avail;
  if (out._kpi.occupancy == null && sold && avail) out._kpi.occupancy = sold / avail;

  // If revenue.rooms missing but ADR + sold present, infer
  if (roomRev == null && out._kpi.adr && sold) {
    out.revenue.rooms = +(out._kpi.adr * sold).toFixed(2);
    out.warnings.push(`Room revenue inferred from ADR × sold (${out._kpi.adr.toFixed(2)} × ${sold}).`);
  }

  // 5) Confidence — anchor on key fields
  const required = [
    out.date, out.rooms.sold, out.rooms.available, out.revenue.rooms,
  ];
  const filled = required.filter((v) => v != null).length;
  let conf = 0.20 + (filled / required.length) * 0.55;
  conf += Math.min(0.20, captured * 0.015); // bonus for breadth
  if (out.propertyId) conf += 0.05;
  out.confidence = Math.min(0.99, +conf.toFixed(2));

  // 6) Warnings about missing pieces
  if (out.date == null) out.warnings.push("Could not detect a date — please confirm.");
  if (out.rooms.available == null) out.warnings.push("Rooms available not detected.");
  if (out.rooms.sold == null) out.warnings.push("Rooms sold not detected.");
  if (out.revenue.rooms == null) out.warnings.push("Room revenue not detected.");
  if (totalRevenueExplicit != null) {
    const computed = (out.revenue.rooms || 0)
      + (out.revenue.fb.restaurant || 0) + (out.revenue.fb.bar || 0) + (out.revenue.fb.banquet || 0)
      + (out.revenue.other.parking || 0) + (out.revenue.other.spa || 0) + (out.revenue.other.telephone || 0) + (out.revenue.other.misc || 0);
    const diff = Math.abs(totalRevenueExplicit - computed);
    if (computed > 0 && diff / totalRevenueExplicit > 0.03) {
      out.warnings.push(`Stated total ${fmt(totalRevenueExplicit)} differs from sum of components ${fmt(computed)} by ${fmt(diff)}. Review the breakdown.`);
    }
  }

  // 7) Auto-insights
  out.insights = generateInsights(out);

  return out;
}

function fmt(n) {
  return `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------- insight engine ----------
function generateInsights(d) {
  const out = [];
  const sold = d.rooms.sold || 0;
  const avail = d.rooms.available || 0;
  const occ = avail ? sold / avail : 0;
  const roomRev = d.revenue.rooms || 0;
  const fbTotal = (d.revenue.fb.restaurant || 0) + (d.revenue.fb.bar || 0) + (d.revenue.fb.banquet || 0);
  const otherTotal = (d.revenue.other.parking || 0) + (d.revenue.other.spa || 0) + (d.revenue.other.telephone || 0) + (d.revenue.other.misc || 0);
  const total = roomRev + fbTotal + otherTotal;
  const adr = sold ? roomRev / sold : 0;

  if (occ >= 0.9) out.push(`Strong occupancy night — ${(occ * 100).toFixed(1)}% with ${sold} rooms sold against ${avail} available.`);
  else if (occ >= 0.75) out.push(`Healthy occupancy at ${(occ * 100).toFixed(1)}% (${sold}/${avail}).`);
  else if (occ < 0.5 && avail > 0) out.push(`Soft demand — only ${(occ * 100).toFixed(1)}% occupancy. Consider reviewing pricing & channel mix.`);

  if (adr > 0) {
    if (adr >= 200) out.push(`Premium rate captured: ADR of ${fmt(adr)}.`);
    else if (adr < 100 && sold > 0) out.push(`Compressed ADR at ${fmt(adr)} — verify discount / package usage.`);
  }

  if (total > 0 && roomRev > 0) {
    const fbCapture = fbTotal / roomRev;
    if (fbTotal > 0) {
      out.push(`F&B capture rate: ${(fbCapture * 100).toFixed(1)}% of room revenue (${fmt(fbTotal)} on ${fmt(roomRev)} rooms).`);
    }
  }

  if (d.rooms.outOfOrder && d.rooms.outOfOrder > 0 && adr > 0) {
    out.push(`${d.rooms.outOfOrder} OOO rooms — ~${fmt(d.rooms.outOfOrder * adr)} of theoretical revenue parked.`);
  }
  if (d.rooms.walkIns && d.rooms.walkIns >= 3) {
    out.push(`${d.rooms.walkIns} walk-ins captured — strong front-desk performance.`);
  }
  if (d.rooms.noShows && d.rooms.noShows >= 2) {
    out.push(`${d.rooms.noShows} no-shows. Confirm guarantee policy was applied.`);
  }
  if (total > 0) {
    out.push(`Total revenue mix — Rooms ${(roomRev / total * 100).toFixed(0)}%, F&B ${(fbTotal / total * 100).toFixed(0)}%, Other ${(otherTotal / total * 100).toFixed(0)}%.`);
  }

  return out.slice(0, 5);
}

// ---------- public extraction entry point ----------
/**
 * Drop-in replacement for the old callExtractionAPI in HotelOps.jsx.
 * Always returns synchronously-shaped data. If a Claude API key is configured
 * via window.__HOTELOPS_API_KEY__ or localStorage, it can call the API for
 * enrichment; otherwise the local parser is the engine.
 */
export async function extractAudit({ text, file, properties }) {
  // For files, attempt to read text content (PDFs / images we can't OCR locally —
  // we degrade gracefully and flag).
  let inputText = text || "";
  if (file && !inputText) {
    if (file.raw && file.raw.type && file.raw.type.startsWith("text/")) {
      inputText = await file.raw.text();
    } else {
      // give the user a useful starting point even without OCR
      inputText = ""; // parser will return mostly-empty + warnings
    }
  }
  const local = parseAuditText(inputText, properties);

  // Try to enrich via Claude API if a key exists (optional)
  const apiKey =
    (typeof window !== "undefined" && (window.__HOTELOPS_API_KEY__ || localStorage.getItem("hotelops:apiKey"))) || null;
  if (apiKey && (inputText || file)) {
    try {
      const ai = await callClaude({ apiKey, text: inputText, file, properties });
      return mergeExtractions(local, ai);
    } catch (e) {
      local.warnings.push(`AI enrichment skipped: ${e.message}`);
    }
  }
  if (file && (!file.raw || !file.raw.type || !file.raw.type.startsWith("text/"))) {
    local.warnings.push("Binary upload (PDF/image) — local parser cannot OCR. Add an API key in Settings → System for AI extraction, or paste the text directly.");
  }
  if (!inputText && !file) {
    local.warnings.push("No input received.");
  }
  return local;
}

function mergeExtractions(local, ai) {
  // Prefer AI for unfilled fields, keep local insights/warnings appended
  const merged = JSON.parse(JSON.stringify(local));
  const fill = (path, val) => {
    if (val == null || val === "") return;
    if (getPath(merged, path) == null) setPath(merged, path, val);
  };
  if (ai.date) fill("date", ai.date);
  if (ai.propertyId) fill("propertyId", ai.propertyId);
  ["available", "outOfOrder", "sold", "comp", "transient", "group", "walkIns", "noShows"].forEach((k) =>
    fill(`rooms.${k}`, ai.rooms?.[k])
  );
  fill("revenue.rooms", ai.revenue?.rooms);
  ["restaurant", "bar", "banquet"].forEach((k) => fill(`revenue.fb.${k}`, ai.revenue?.fb?.[k]));
  ["telephone", "parking", "spa", "misc"].forEach((k) => fill(`revenue.other.${k}`, ai.revenue?.other?.[k]));
  ["occupancy", "sales", "tourism"].forEach((k) => fill(`taxes.${k}`, ai.taxes?.[k]));
  ["cash", "creditCard", "directBill", "other"].forEach((k) => fill(`payments.${k}`, ai.payments?.[k]));
  if (Array.isArray(ai.insights)) merged.insights = [...new Set([...(ai.insights || []), ...merged.insights])].slice(0, 6);
  if (Array.isArray(ai.warnings)) merged.warnings = [...new Set([...merged.warnings, ...ai.warnings])];
  merged.confidence = Math.max(merged.confidence, ai.confidence || 0);
  return merged;
}

async function callClaude({ apiKey, text, file, properties }) {
  const propList = properties.map((p) => `  - "${p.name}" (id ${p.id}, ${p.rooms} rooms, ${p.location})`).join("\n");
  const prompt = `Extract a hotel night-audit / daily flash report into structured JSON.\n\nProperties:\n${propList}\n\nReturn ONLY a JSON object with shape:\n{ date, propertyId, rooms:{available,outOfOrder,sold,comp,transient,group,walkIns,noShows}, revenue:{rooms,fb:{restaurant,bar,banquet},other:{telephone,parking,spa,misc}}, taxes:{occupancy,sales,tourism}, payments:{cash,creditCard,directBill,other}, confidence, warnings:[], insights:[] }`;
  let content;
  if (file && file.base64 && file.mediaType) {
    const blockType = file.mediaType === "application/pdf" ? "document" : "image";
    content = [
      { type: blockType, source: { type: "base64", media_type: file.mediaType, data: file.base64 } },
      { type: "text", text: prompt },
    ];
  } else {
    content = `${prompt}\n\nAUDIT INPUT:\n${text}`;
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const txt = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const cleaned = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

// ---------- batch ingest ----------
/**
 * Split a single pasted blob into multiple audit chunks based on common
 * separators (---, ===, page breaks, "NIGHT AUDIT" headers, "Date:" markers).
 * Returns an array of trimmed chunks. Always returns at least one item.
 */
export function splitAuditBatch(text) {
  if (!text) return [];
  const t = String(text);

  // Hard separators first
  const hardSplit = t.split(/\n\s*(?:[-=*]{3,}|={3,}|)\s*\n/);
  if (hardSplit.length > 1) return hardSplit.map((s) => s.trim()).filter((s) => s.length > 30);

  // Header-based: split on "NIGHT AUDIT", "DAILY FLASH", "Daily Report", or a leading "Date:"
  const lines = t.split(/\r?\n/);
  const chunks = [];
  let buf = [];
  const headerRe = /^\s*(?:night\s+audit|daily\s+flash|daily\s+report|flash\s+report|end\s+of\s+day)\b/i;
  const dateOnLine = /^\s*(?:date|report\s+date)\s*[:=]/i;
  let sawHeader = 0;
  lines.forEach((line) => {
    if (headerRe.test(line) || dateOnLine.test(line)) {
      sawHeader++;
      if (buf.length && sawHeader > 1) {
        chunks.push(buf.join("\n").trim());
        buf = [];
      }
    }
    buf.push(line);
  });
  if (buf.length) chunks.push(buf.join("\n").trim());

  const filtered = chunks.filter((s) => s.length > 30);
  return filtered.length > 1 ? filtered : [t.trim()];
}

/**
 * Parse multiple audits in one go. Returns an array of extraction results,
 * each in the same shape as parseAuditText.
 */
export function parseAuditBatch(text, properties = []) {
  const chunks = splitAuditBatch(text);
  return chunks.map((c) => parseAuditText(c, properties));
}

// ---------- file helpers (kept for HotelOps.jsx compatibility) ----------
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
