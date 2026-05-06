/* HotelOps · AP automation
 * =================================================================
 * Vendor-invoice OCR (via existing Claude proxy/key in auditParser),
 * NACHA ACH file generation for batch payment runs, and printable
 * check run PDF data. The OCR helper is decoupled from the parser
 * so we don't import Claude directly here — instead, we share the
 * same proxy/key reading logic.
 */

// ----------------- OCR (invoices) -----------------
/**
 * Extract structured invoice data from an uploaded file using Claude.
 * Returns null if no API access is configured (the UI then falls back to
 * manual entry). Same proxy/key wiring as auditParser.js.
 *
 * @param {{ base64: string, mediaType: string }} file
 */
export async function ocrInvoice(file) {
  const proxyUrl = readLs("hotelops:proxyUrl");
  const proxyAuth = readLs("hotelops:proxyAuth");
  const apiKey = readLs("hotelops:apiKey");
  if (!proxyUrl && !apiKey) return null;
  if (!file || !file.base64 || !file.mediaType) return null;

  const prompt = `Extract structured data from this vendor invoice. Return ONLY a JSON object with this shape:
{
  "vendorName": string,
  "invoiceNumber": string,
  "issuedDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "amount": number,        // total
  "subtotal": number,      // before tax
  "tax": number,
  "lineItems": [{ "description": string, "amount": number, "quantity": number }],
  "memo": string
}
Use null for any field you cannot find. Do not include any commentary, only the JSON.`;

  const blockType = file.mediaType === "application/pdf" ? "document" : "image";
  const content = [
    { type: blockType, source: { type: "base64", media_type: file.mediaType, data: file.base64 } },
    { type: "text", text: prompt },
  ];

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
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`OCR API ${res.status}`);
  const data = await res.json();
  const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  const cleaned = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

function readLs(key) {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

// ----------------- NACHA (ACH) file generation -----------------
/**
 * Build a NACHA-formatted ACH PPD/CCD file body for a batch of vendor payments.
 * The result is plain text (94-char lines) that you upload to your bank's cash
 * management portal. It does NOT initiate a payment — the bank still controls
 * the wire.
 *
 * Required: companyInfo {name, taxId, originatingDfi, companyId},
 * effectiveDate (YYYY-MM-DD), batch of payments
 *   [{ id, payeeName, payeeAccountNumber, payeeRoutingNumber, accountType, amount, addenda }]
 *
 * Returns { content, filename, batchSummary }
 */
export function generateNACHA({ company, effectiveDate, payments, sec = "PPD", traceBase = 1 }) {
  if (!company?.name || !company?.taxId || !company?.originatingDfi) {
    throw new Error("NACHA: company.name, company.taxId, and company.originatingDfi are required");
  }
  if (!Array.isArray(payments) || payments.length === 0) {
    throw new Error("NACHA: at least one payment is required");
  }
  const odfi8 = pad(stripNonDigits(company.originatingDfi).slice(0, 8), 8, "0", "left");
  const companyId10 = pad(`1${stripNonDigits(company.taxId)}`.slice(0, 10), 10, " ", "right");
  const fileIdMod = "A";
  const today = new Date();
  const yymmdd = `${String(today.getFullYear()).slice(2)}${pad(today.getMonth() + 1, 2, "0", "left")}${pad(today.getDate(), 2, "0", "left")}`;
  const hhmm = `${pad(today.getHours(), 2, "0", "left")}${pad(today.getMinutes(), 2, "0", "left")}`;
  const effYymmdd = effectiveDate.replace(/-/g, "").slice(2);

  const lines = [];
  // FILE HEADER — record type 1
  lines.push(
    "1" +                                     // record type
    "01" +                                    // priority code
    " " + odfi8 +                             // immediate destination (10 chars: blank + 8)
    "1" + companyId10 +                       // immediate origin
    yymmdd + hhmm +                           // file creation date/time
    fileIdMod +                               // file ID modifier
    "094" +                                   // record size
    "10" +                                    // blocking factor
    "1" +                                     // format code
    pad(company.bankName || "", 23, " ", "right").slice(0, 23) + // immediate destination name
    pad(company.name, 23, " ", "right").slice(0, 23) +           // immediate origin name
    pad("", 8, " ", "right")                  // reference code
  );

  // BATCH HEADER — record type 5
  const batchNumber = "0000001";
  lines.push(
    "5" +
    "220" +                                    // service class — 220 = credits only
    pad(company.name, 16, " ", "right").slice(0, 16) +
    pad("", 20, " ", "right") +                // discretionary data
    companyId10 +
    sec +                                       // standard entry class (PPD/CCD)
    pad("VENDOR PMT", 10, " ", "right") +
    pad(effYymmdd, 6, " ", "right") +           // company descriptive date
    effYymmdd +                                  // effective entry date
    "   " +                                      // settlement date (Julian) — bank fills
    "1" +                                        // originator status code
    odfi8 +                                      // originating DFI ID (8 chars)
    batchNumber                                  // batch number
  );

  // ENTRY DETAIL — record type 6
  let entryHash = 0;
  let totalCredits = 0;
  let entries = 0;
  payments.forEach((p, i) => {
    const routing9 = pad(stripNonDigits(p.payeeRoutingNumber).slice(0, 9), 9, "0", "left");
    const routing8 = routing9.slice(0, 8);
    const checkDigit = routing9.slice(8, 9);
    const tCode = p.accountType === "savings" ? "32" : "22"; // 22 = checking credit; 32 = savings credit
    const amountCents = Math.round(Number(p.amount) * 100);
    const trace = pad(odfi8, 8, "0", "left") + pad(traceBase + i, 7, "0", "left");
    lines.push(
      "6" +
      tCode +
      routing8 +
      checkDigit +
      pad(stripNonDigits(p.payeeAccountNumber).slice(0, 17), 17, " ", "right") +
      pad(amountCents, 10, "0", "left") +
      pad(p.id || `INV${i}`, 15, " ", "right").slice(0, 15) +
      pad(p.payeeName, 22, " ", "right").slice(0, 22) +
      "  " +                                     // discretionary data
      "0" +                                       // addenda record indicator
      trace
    );
    entryHash += Number(routing8);
    totalCredits += amountCents;
    entries += 1;
  });

  // BATCH CONTROL — record type 8
  const entryHashTrunc = String(entryHash).slice(-10);
  lines.push(
    "8" +
    "220" +
    pad(entries, 6, "0", "left") +
    pad(entryHashTrunc, 10, "0", "left") +
    pad(0, 12, "0", "left") +                  // total debits
    pad(totalCredits, 12, "0", "left") +
    companyId10 +
    pad("", 19, " ", "right") +                 // message authentication code
    pad("", 6, " ", "right") +                  // reserved
    odfi8 +
    batchNumber
  );

  // FILE CONTROL — record type 9
  const blockCount = Math.ceil(lines.length / 10);
  lines.push(
    "9" +
    pad(1, 6, "0", "left") +                   // batch count
    pad(blockCount, 6, "0", "left") +
    pad(entries, 8, "0", "left") +
    pad(entryHashTrunc, 10, "0", "left") +
    pad(0, 12, "0", "left") +
    pad(totalCredits, 12, "0", "left") +
    pad("", 39, " ", "right")                  // reserved
  );

  // Pad with 9-records to fill the block (multiple of 10 lines)
  while (lines.length % 10 !== 0) {
    lines.push(pad("9", 94, "9", "right"));
  }

  const content = lines.map(l => pad(l, 94, " ", "right").slice(0, 94)).join("\n") + "\n";
  return {
    content,
    filename: `ach-${effectiveDate.replace(/-/g, "")}-${entries}pmt.txt`,
    batchSummary: {
      paymentCount: entries,
      totalAmount: totalCredits / 100,
      effectiveDate,
    },
  };
}

function pad(val, width, char, side) {
  let s = String(val);
  if (s.length >= width) return s.slice(0, width);
  const fill = char.repeat(width - s.length);
  return side === "left" ? fill + s : s + fill;
}
function stripNonDigits(s) { return String(s || "").replace(/\D/g, ""); }

// ----------------- check run summary -----------------
/**
 * Build the data structure a check-run PDF needs. Doesn't render the PDF
 * (that lives in the UI side via jspdf), just shapes the data.
 */
export function buildCheckRun({ payments, vendors, company, runDate, startCheckNo = 1001 }) {
  const ledger = (payments || []).map((p, i) => {
    const v = (vendors || []).find(x => x.id === p.vendorId) || {};
    return {
      checkNumber: startCheckNo + i,
      payee: v.name || p.payeeName || "(unknown)",
      vendorId: p.vendorId,
      amount: Number(p.amount) || 0,
      memo: p.memo || `Inv ${p.invoiceNumber || p.id}`,
      address: v.address || "",
      date: runDate,
    };
  });
  const total = ledger.reduce((s, c) => s + c.amount, 0);
  return {
    checks: ledger,
    runDate,
    company: company || { name: "" },
    summary: {
      checkCount: ledger.length,
      total,
      startCheckNo,
      endCheckNo: startCheckNo + ledger.length - 1,
    },
  };
}

/** Number → words for check amount line, e.g. 1234.56 → "One thousand two hundred thirty-four and 56/100". */
export function amountInWords(n) {
  if (n == null || isNaN(n)) return "";
  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);
  const words = numToWords(dollars);
  return `${words} and ${pad(cents, 2, "0", "left")}/100`;
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numToWords(n) {
  if (n === 0) return "Zero";
  if (n < 0) return "Negative " + numToWords(-n);
  const parts = [];
  if (n >= 1_000_000) { parts.push(numToWords(Math.floor(n / 1_000_000)) + " million"); n %= 1_000_000; }
  if (n >= 1_000) { parts.push(numToWords(Math.floor(n / 1_000)) + " thousand"); n %= 1_000; }
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + " hundred"); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")); }
  else if (n > 0) { parts.push(ONES[n]); }
  const out = parts.filter(Boolean).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
