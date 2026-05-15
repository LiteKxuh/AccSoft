/* HotelOps · Runtime diagnostics
 * =================================================================
 * Lightweight, dependency-free runtime telemetry. NOT a replacement
 * for real APM — this is the operator's local debug surface so
 * a controller can show a screenshot of "what went wrong" instead
 * of asking the user to open devtools.
 *
 * Surface:
 *   installDiagnostics()       — call once at boot. Wires window.onerror,
 *                                unhandledrejection, console.error tap.
 *   record(level, source, msg) — log a structured entry.
 *   getLog()                   — read the ring buffer.
 *   clearLog()                  — clear it.
 *   subscribe(fn)              — react to new entries (UI live updates).
 *   timeOperation(name, fn)    — measure async fn and log if slow.
 *   getMetrics()               — counters + slow-op samples.
 *
 * The ring buffer is capped at 500 entries to bound memory.
 */

const MAX_ENTRIES = 500;
const SLOW_OP_MS = 750;       // log async ops slower than this
const ENTRIES = [];           // newest last
const subscribers = new Set();
const metrics = {
  errors: 0,
  unhandledRejections: 0,
  consoleErrors: 0,
  slowOps: [],
  bootAt: null,
};

let _installed = false;

function emit(entry) {
  ENTRIES.push(entry);
  if (ENTRIES.length > MAX_ENTRIES) ENTRIES.shift();
  for (const fn of subscribers) {
    try { fn(entry); } catch { /* never let a subscriber kill the pipeline */ }
  }
}

export function record(level, source, message, detail = null) {
  emit({
    at: new Date().toISOString(),
    level,         // "error" | "warn" | "info" | "debug"
    source,        // free-text, e.g. "PaneErrorBoundary"
    message: String(message || "").slice(0, 800),
    detail: detail ? safeSerialize(detail) : null,
  });
}

function safeSerialize(d) {
  try {
    if (typeof d === "string") return d.slice(0, 2000);
    if (d instanceof Error) return { message: d.message, stack: String(d.stack || "").slice(0, 2000) };
    return JSON.stringify(d, replaceCircular(), 2).slice(0, 2000);
  } catch {
    return "[unserializable]";
  }
}
function replaceCircular() {
  const seen = new WeakSet();
  return (k, v) => {
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  };
}

export function getLog() {
  return ENTRIES.slice();
}
export function clearLog() {
  ENTRIES.length = 0;
}
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export function getMetrics() {
  return {
    ...metrics,
    bufferUsage: ENTRIES.length,
    bufferCapacity: MAX_ENTRIES,
    uptimeMs: metrics.bootAt ? Date.now() - metrics.bootAt : 0,
  };
}

/** Measure an async function and log if slower than SLOW_OP_MS. */
export async function timeOperation(name, fn) {
  const start = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  try {
    const result = await fn();
    const ms = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - start;
    if (ms > SLOW_OP_MS) {
      metrics.slowOps.push({ name, ms: Math.round(ms), at: new Date().toISOString() });
      if (metrics.slowOps.length > 50) metrics.slowOps.shift();
      record("warn", "perf", `Slow operation: ${name} (${Math.round(ms)}ms)`);
    }
    return result;
  } catch (e) {
    record("error", "perf", `Operation failed: ${name}`, e);
    throw e;
  }
}

/**
 * Install global error handlers. Safe to call multiple times.
 * No-op outside browser environments (Node tests).
 */
export function installDiagnostics() {
  if (_installed) return;
  if (typeof window === "undefined") return;
  _installed = true;
  metrics.bootAt = Date.now();
  try {
    window.addEventListener("error", (ev) => {
      metrics.errors++;
      record("error", "window.error", ev?.message || "Uncaught error", {
        filename: ev?.filename, lineno: ev?.lineno, colno: ev?.colno,
        stack: ev?.error?.stack,
      });
    });
    window.addEventListener("unhandledrejection", (ev) => {
      metrics.unhandledRejections++;
      const reason = ev?.reason;
      record("error", "unhandledRejection", reason?.message || String(reason || "promise rejected"), reason);
    });
    // Tap console.error without losing the original output.
    const origErr = console.error;
    console.error = function (...args) {
      metrics.consoleErrors++;
      try { record("error", "console.error", args.map(a => a && typeof a === "object" ? (a.message || JSON.stringify(a, replaceCircular()).slice(0, 200)) : String(a)).join(" ")); } catch {}
      return origErr.apply(console, args);
    };
  } catch {
    // Never let diagnostics installation break the app.
    _installed = false;
  }
}

/* ---------- Health snapshot for dashboards ---------- */

export function healthSnapshot() {
  const m = getMetrics();
  const recentErrors = ENTRIES.filter(e => e.level === "error").slice(-10);
  return {
    status: m.errors === 0 && m.unhandledRejections === 0 ? "healthy"
          : m.errors + m.unhandledRejections > 10 ? "degraded"
          : "watch",
    metrics: m,
    recentErrors,
  };
}
