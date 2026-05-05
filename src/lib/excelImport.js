/* HotelOps · Excel/CSV import engine
 * =================================================================
 * Reads .xlsx / .xls / .csv via SheetJS, fuzzy-matches columns
 * against a target schema, and returns mapped row objects.
 *
 * Use cases:
 *  - Import monthly budget rows
 *  - Import vendor invoices (A/P bills)
 *  - Import a list of audit/flash reports
 *  - Generic table → JSON
 *
 * Public API:
 *   readWorkbook(file) -> { sheets: [{ name, aoa, headers, dataRows }] }
 *   guessHeaderRow(aoa) -> number
 *   suggestMapping(headers, schema) -> { [schemaKey]: columnIndex | null, confidence }
 *   applyMapping(dataRows, mapping, schema) -> mappedRowObjects
 *   SCHEMAS — predefined import schemas
 */

import * as XLSX from "xlsx";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const sheets = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: true });
          const headerIdx = guessHeaderRow(aoa);
          const headers = (aoa[headerIdx] || []).map((h) => (h == null ? "" : String(h).trim()));
          const dataRows = aoa.slice(headerIdx + 1).filter((r) => r && r.some((c) => c != null && c !== ""));
          return { name, aoa, headers, dataRows, headerIdx };
        });
        resolve({ sheets });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Heuristic: pick the first row whose cells are mostly non-numeric strings —
 * that's almost always the header row in spreadsheets people actually share.
 */
export function guessHeaderRow(aoa) {
  const candidates = Math.min(aoa.length, 8);
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates; i++) {
    const row = aoa[i];
    if (!row) continue;
    const nonEmpty = row.filter((c) => c != null && c !== "");
    if (nonEmpty.length < 2) continue;
    const stringy = nonEmpty.filter((c) => typeof c === "string" && !/^[\d.,$()%-]+$/.test(c)).length;
    const numy = nonEmpty.filter((c) => typeof c === "number" || /^[\d.,$()%-]+$/.test(String(c))).length;
    const score = stringy * 2 - numy + nonEmpty.length * 0.1;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * For each schema field, pick the best-matching header column index.
 * @param {string[]} headers
 * @param {Array<{key, label, aliases:string[], required?:bool}>} schema
 */
export function suggestMapping(headers, schema) {
  const headerNorms = headers.map(norm);
  const used = new Set();
  const mapping = {};
  let totalMatched = 0;
  let requiredMatched = 0;
  let requiredTotal = 0;
  schema.forEach((field) => {
    if (field.required) requiredTotal++;
    let bestIdx = -1;
    let bestScore = 0;
    headerNorms.forEach((h, i) => {
      if (used.has(i) || !h) return;
      let score = 0;
      // exact label match
      if (h === norm(field.label)) score = 1;
      else if (h === norm(field.key)) score = 0.95;
      else {
        // alias substring match
        for (const a of field.aliases || []) {
          const na = norm(a);
          if (!na) continue;
          if (h === na) { score = Math.max(score, 0.92); }
          else if (h.includes(na) || na.includes(h)) {
            score = Math.max(score, 0.65 + Math.min(0.25, na.length / 30));
          }
        }
        // word overlap as a fallback
        const aw = new Set(h.split(" "));
        for (const a of [field.label, field.key, ...(field.aliases || [])]) {
          const na = norm(a);
          if (!na) continue;
          const bw = new Set(na.split(" "));
          let inter = 0;
          aw.forEach((w) => bw.has(w) && inter++);
          const jacc = inter / (aw.size + bw.size - inter || 1);
          if (jacc > 0.5) score = Math.max(score, 0.4 + jacc * 0.2);
        }
      }
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });
    if (bestIdx >= 0 && bestScore >= 0.5) {
      mapping[field.key] = bestIdx;
      used.add(bestIdx);
      totalMatched++;
      if (field.required) requiredMatched++;
    } else {
      mapping[field.key] = null;
    }
  });
  const confidence = schema.length ? totalMatched / schema.length : 0;
  return { mapping, confidence, requiredMatched, requiredTotal };
}

/** Apply a mapping to data rows, coerce types per schema, return objects. */
export function applyMapping(dataRows, mapping, schema) {
  return dataRows.map((row) => {
    const out = {};
    schema.forEach((field) => {
      const idx = mapping[field.key];
      const raw = idx == null || idx < 0 ? null : row[idx];
      out[field.key] = coerce(raw, field);
    });
    return out;
  });
}

function coerce(raw, field) {
  if (raw == null || raw === "") return field.type === "number" || field.type === "money" || field.type === "pct" ? 0 : "";
  if (field.type === "money" || field.type === "number" || field.type === "pct") {
    if (typeof raw === "number") return field.type === "pct" && raw > 1 ? raw / 100 : raw;
    let s = String(raw).trim();
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    const isPct = /%$/.test(s);
    s = s.replace(/[$£€,]/g, "").replace(/%/g, "").trim();
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    let v = neg ? -n : n;
    if (isPct || field.type === "pct") v = v / 100;
    return v;
  }
  if (field.type === "date") {
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    const s = String(raw).trim();
    // try MM/DD/YYYY, YYYY-MM-DD, etc.
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return s;
  }
  return String(raw).trim();
}

/* =====================================================================
   PREDEFINED SCHEMAS
   ===================================================================== */

/** Budget row by USALI line — one row per account, one column per month, OR
 *  one row per month with separate columns per account. We support the
 *  "row-per-account, MTD value" simple shape; for full year budgets users
 *  can re-import per month. */
export const BUDGET_ACCOUNT_SCHEMA = [
  { key: "account", label: "Account", aliases: ["line item", "category", "department", "gl account"], required: true },
  { key: "amount", label: "Amount", type: "money", aliases: ["budget", "monthly budget", "amt", "mtd budget", "value", "total"], required: true },
];

/** Map of normalized account labels to budget-shape paths */
export const BUDGET_ACCOUNT_PATHS = {
  "rooms revenue": "rooms.revenue",
  "room revenue": "rooms.revenue",
  "rooms": "rooms.revenue",
  "restaurant": "fb.restaurant",
  "food": "fb.restaurant",
  "bar": "fb.bar",
  "lounge": "fb.bar",
  "bar lounge": "fb.bar",
  "beverage": "fb.bar",
  "banquet": "fb.banquet",
  "catering": "fb.banquet",
  "events": "fb.banquet",
  "parking": "other.parking",
  "valet": "other.parking",
  "spa": "other.spa",
  "wellness": "other.spa",
  "telephone": "other.telephone",
  "phone": "other.telephone",
  "misc": "other.misc",
  "miscellaneous": "other.misc",
  "sundry": "other.misc",
  "other": "other.misc",
  "occupancy tax": "taxes.occupancy",
  "sales tax": "taxes.sales",
  "tourism tax": "taxes.tourism",
};

export function applyBudgetRowsToBudget(rows, baseBudget) {
  const next = JSON.parse(JSON.stringify(baseBudget));
  let applied = 0;
  let skipped = [];
  rows.forEach((r) => {
    const key = norm(r.account);
    const path = BUDGET_ACCOUNT_PATHS[key];
    if (!path) {
      // try contains
      const found = Object.entries(BUDGET_ACCOUNT_PATHS).find(([k]) => key.includes(k) || k.includes(key));
      if (found) {
        setPath(next, found[1], Number(r.amount) || 0);
        applied++;
        return;
      }
      skipped.push(r.account);
      return;
    }
    setPath(next, path, Number(r.amount) || 0);
    applied++;
  });
  return { budget: next, applied, skipped };
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

/** Vendor invoices */
export const INVOICE_SCHEMA = [
  { key: "vendorName", label: "Vendor", aliases: ["vendor name", "supplier", "payee", "company"], required: true },
  { key: "invoiceNumber", label: "Invoice #", aliases: ["invoice number", "inv #", "inv no", "invoice no", "ref"], required: false },
  { key: "issuedDate", label: "Issued", type: "date", aliases: ["invoice date", "issued date", "date", "bill date"], required: true },
  { key: "dueDate", label: "Due", type: "date", aliases: ["due date", "payment due"], required: false },
  { key: "amount", label: "Amount", type: "money", aliases: ["total", "amount due", "balance", "amt"], required: true },
  { key: "category", label: "Category", aliases: ["expense category", "gl category", "type"], required: false },
  { key: "memo", label: "Memo", aliases: ["description", "notes", "details"], required: false },
];

/** Audit/flash reports */
export const AUDIT_SCHEMA = [
  { key: "date", label: "Date", type: "date", aliases: ["report date", "business date", "audit date"], required: true },
  { key: "roomsAvailable", label: "Rooms Available", type: "number", aliases: ["available", "inventory"] },
  { key: "roomsSold", label: "Rooms Sold", type: "number", aliases: ["sold", "occupied", "rooms occupied"] },
  { key: "roomRevenue", label: "Room Revenue", type: "money", aliases: ["rooms revenue", "lodging revenue"] },
  { key: "fbRestaurant", label: "Restaurant", type: "money", aliases: ["food", "dining"] },
  { key: "fbBar", label: "Bar", type: "money", aliases: ["beverage", "lounge"] },
  { key: "fbBanquet", label: "Banquet", type: "money", aliases: ["catering", "events"] },
  { key: "otherParking", label: "Parking", type: "money", aliases: ["valet"] },
  { key: "otherSpa", label: "Spa", type: "money", aliases: ["wellness"] },
  { key: "otherMisc", label: "Misc", type: "money", aliases: ["sundry", "other revenue"] },
  { key: "taxOccupancy", label: "Occupancy Tax", type: "money", aliases: ["occ tax", "lodging tax"] },
  { key: "taxSales", label: "Sales Tax", type: "money", aliases: ["state tax"] },
];

/** Generic — for "anything else" the user wants to bring in. */
export function genericSchemaFromHeaders(headers) {
  return headers.map((h) => ({ key: h || "col", label: h || "", aliases: [] }));
}
