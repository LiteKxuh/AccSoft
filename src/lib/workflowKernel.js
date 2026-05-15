/* HotelOps · Workflow Kernel
 * =================================================================
 * Sits on top of workflowEngine.evaluate(). Adds:
 *
 *   - in-process event bus     (subscribe / emit / once / off)
 *   - DAG-style workflow runner (steps with deps, ordered execution)
 *   - retry-safe step execution (attempt count, backoff, max retries)
 *   - replay log               (every step's lifecycle is recorded)
 *   - observability snapshot   (counts, durations, failure rates)
 *   - rollback hooks           (run compensating actions if a step fails)
 *
 * Design constraints:
 *   - Pure JS, no timers/processes. Backoff is computed; the caller
 *     decides when to call runWorkflow again. This keeps the kernel
 *     deterministic and testable.
 *   - All state is held inside a WorkflowRun object — the caller
 *     persists it (e.g. into app state) between invocations.
 *
 * Public API:
 *   createEventBus()
 *   createWorkflow(def)
 *   runWorkflow(run, { ctx, now })  → { run, results }
 *   replayWorkflow(run, opts)        → re-emit lifecycle events
 *   workflowMetrics(runs)            → observability snapshot
 *
 * Definition shape:
 *   {
 *     id, label, version,
 *     steps: [
 *       {
 *         id, label,
 *         deps: ["step.a", "step.b"],
 *         maxRetries: 3,
 *         backoffMs: 1000,
 *         run: async ({ ctx, prior }) => { ok, output, retryable? },
 *         rollback?: async ({ ctx, prior, error }) => void,
 *       }
 *     ]
 *   }
 */

import { evaluate, evaluatePortfolio, applyEvents } from "./workflowEngine.js";

/* ---------- Event bus ---------- */

export function createEventBus() {
  const subs = new Map();      // event name → Set<handler>
  const log = [];              // every emit recorded for replay
  function on(name, handler) {
    if (!subs.has(name)) subs.set(name, new Set());
    subs.get(name).add(handler);
    return () => off(name, handler);
  }
  function off(name, handler) {
    subs.get(name)?.delete(handler);
  }
  function once(name, handler) {
    const unsub = on(name, (...args) => { unsub(); handler(...args); });
    return unsub;
  }
  function emit(name, payload) {
    log.push({ name, payload, at: new Date().toISOString() });
    const handlers = subs.get(name);
    if (!handlers) return;
    for (const h of [...handlers]) {
      try { h(payload); } catch (e) { /* never let a handler crash the bus */ }
    }
  }
  return { on, off, once, emit, log };
}

/* ---------- Workflow definition + run state ---------- */

export function createWorkflow(def) {
  if (!def || !def.id) throw new Error("createWorkflow: id required");
  if (!Array.isArray(def.steps) || !def.steps.length) throw new Error("createWorkflow: steps[] required");
  const seen = new Set();
  for (const s of def.steps) {
    if (!s.id) throw new Error("createWorkflow: every step needs an id");
    if (seen.has(s.id)) throw new Error(`createWorkflow: duplicate step id ${s.id}`);
    seen.add(s.id);
    if (typeof s.run !== "function") throw new Error(`createWorkflow: step ${s.id} missing run()`);
  }
  // Validate DAG (no cycles, deps exist)
  const ids = new Set(def.steps.map(s => s.id));
  for (const s of def.steps) {
    for (const d of (s.deps || [])) {
      if (!ids.has(d)) throw new Error(`createWorkflow: step ${s.id} depends on unknown ${d}`);
    }
  }
  detectCycles(def.steps);

  return {
    def,
    newRun(input = {}) {
      return {
        workflowId: def.id,
        workflowVersion: def.version || "1",
        input,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        status: "pending",
        steps: def.steps.map(s => ({
          id: s.id, label: s.label || s.id,
          status: "pending", attempts: 0,
          startedAt: null, finishedAt: null,
          output: null, error: null,
        })),
        events: [],
      };
    },
  };
}

function detectCycles(steps) {
  const graph = new Map(steps.map(s => [s.id, s.deps || []]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...graph.keys()].map(k => [k, WHITE]));
  function visit(node) {
    color.set(node, GRAY);
    for (const next of graph.get(node) || []) {
      if (color.get(next) === GRAY) throw new Error(`createWorkflow: cycle detected at ${node}→${next}`);
      if (color.get(next) === WHITE) visit(next);
    }
    color.set(node, BLACK);
  }
  for (const k of graph.keys()) {
    if (color.get(k) === WHITE) visit(k);
  }
}

/* ---------- Runner ---------- */

/**
 * Execute pending steps whose deps are satisfied. Each call advances the
 * run as far as possible; failed steps are retried up to maxRetries.
 *
 * @param {object} workflow  output of createWorkflow()
 * @param {object} run       output of workflow.newRun() or a prior run
 * @param {object} opts      { ctx, now?, bus? }
 */
export async function runWorkflow(workflow, run, opts = {}) {
  const { ctx = {}, now = () => new Date().toISOString(), bus = null } = opts;
  const stepsById = new Map(workflow.def.steps.map(s => [s.id, s]));
  const runStepsById = new Map(run.steps.map(s => [s.id, s]));
  const results = [];

  // Mark run as running
  if (run.status === "pending") {
    run.status = "running";
    record(run, "workflow.start", { workflowId: run.workflowId });
    bus?.emit("workflow.start", { run });
  }

  let progress = true;
  while (progress) {
    progress = false;
    for (const def of workflow.def.steps) {
      const rs = runStepsById.get(def.id);
      if (rs.status === "succeeded" || rs.status === "failed" || rs.status === "rolled-back") continue;
      // Deps satisfied?
      const deps = def.deps || [];
      const depsOk = deps.every(d => runStepsById.get(d)?.status === "succeeded");
      if (!depsOk) {
        // If any dep failed, mark blocked
        const blockerFailed = deps.some(d => {
          const dr = runStepsById.get(d);
          return dr && (dr.status === "failed" || dr.status === "rolled-back");
        });
        if (blockerFailed && rs.status !== "blocked") {
          rs.status = "blocked";
          record(run, "step.blocked", { step: rs.id });
          bus?.emit("step.blocked", { step: rs.id });
          progress = true;
        }
        continue;
      }
      // Run the step
      rs.attempts += 1;
      if (!rs.startedAt) rs.startedAt = now();
      rs.status = "running";
      record(run, "step.start", { step: rs.id, attempt: rs.attempts });
      bus?.emit("step.start", { step: rs.id, attempt: rs.attempts });
      let result;
      try {
        result = await def.run({ ctx, prior: priorOutputs(run), step: rs });
      } catch (e) {
        result = { ok: false, error: e?.message || String(e), retryable: true };
      }
      if (result?.ok) {
        rs.status = "succeeded";
        rs.output = result.output ?? null;
        rs.finishedAt = now();
        record(run, "step.succeed", { step: rs.id, output: rs.output });
        bus?.emit("step.succeed", { step: rs.id, output: rs.output });
        results.push({ stepId: rs.id, ok: true, output: rs.output });
        progress = true;
      } else {
        const maxRetries = Number(def.maxRetries ?? 0);
        const retryable = result?.retryable !== false;
        if (retryable && rs.attempts <= maxRetries) {
          rs.status = "retry-pending";
          rs.error = result?.error || "step failed";
          record(run, "step.retry", { step: rs.id, attempt: rs.attempts, error: rs.error });
          bus?.emit("step.retry", { step: rs.id, attempt: rs.attempts, error: rs.error });
          // Do NOT mark progress = true — caller must call runWorkflow again
          // after the configured backoff (kernel is deterministic, no timers).
          results.push({ stepId: rs.id, ok: false, retry: true, error: rs.error, nextAttemptAfterMs: def.backoffMs || 1000 });
        } else {
          rs.status = "failed";
          rs.error = result?.error || "step failed";
          rs.finishedAt = now();
          record(run, "step.fail", { step: rs.id, error: rs.error });
          bus?.emit("step.fail", { step: rs.id, error: rs.error });
          // Attempt rollback for already-succeeded predecessors
          if (def.rollback) {
            try {
              await def.rollback({ ctx, prior: priorOutputs(run), error: rs.error });
              record(run, "step.rollback", { step: rs.id });
              bus?.emit("step.rollback", { step: rs.id });
              rs.status = "rolled-back";
            } catch (re) {
              record(run, "step.rollback-failed", { step: rs.id, error: re?.message || String(re) });
              bus?.emit("step.rollback-failed", { step: rs.id, error: re?.message || String(re) });
            }
          }
          results.push({ stepId: rs.id, ok: false, error: rs.error });
          progress = true;
        }
      }
    }
  }

  // Determine final state
  const allSucceeded = run.steps.every(s => s.status === "succeeded");
  const anyFailed = run.steps.some(s => s.status === "failed" || s.status === "rolled-back");
  const anyPending = run.steps.some(s => s.status === "retry-pending" || s.status === "pending" || s.status === "running");
  if (allSucceeded) {
    run.status = "succeeded";
    run.finishedAt = now();
    record(run, "workflow.success", {});
    bus?.emit("workflow.success", { run });
  } else if (anyFailed && !anyPending) {
    run.status = "failed";
    run.finishedAt = now();
    record(run, "workflow.fail", {});
    bus?.emit("workflow.fail", { run });
  } else if (anyPending) {
    run.status = "awaiting-retry";
  }

  return { run, results };
}

function priorOutputs(run) {
  const out = {};
  for (const s of run.steps) {
    if (s.status === "succeeded") out[s.id] = s.output;
  }
  return out;
}

function record(run, name, payload) {
  run.events.push({ name, payload, at: new Date().toISOString() });
}

/* ---------- Replay ---------- */

/** Re-emit a run's lifecycle events into a bus. Useful for UI hydration after reload. */
export function replayWorkflow(run, bus) {
  if (!run || !Array.isArray(run.events) || !bus) return 0;
  let n = 0;
  for (const e of run.events) {
    bus.emit(e.name, { ...e.payload, replayedAt: new Date().toISOString() });
    n++;
  }
  return n;
}

/* ---------- Observability ---------- */

export function workflowMetrics(runs = []) {
  const out = { total: 0, succeeded: 0, failed: 0, awaiting: 0, byWorkflow: {}, avgDurationMs: 0 };
  let durSum = 0, durCount = 0;
  for (const r of runs) {
    out.total++;
    if (r.status === "succeeded") out.succeeded++;
    else if (r.status === "failed") out.failed++;
    else if (r.status === "awaiting-retry") out.awaiting++;
    const wf = out.byWorkflow[r.workflowId] = out.byWorkflow[r.workflowId] || { total: 0, succeeded: 0, failed: 0 };
    wf.total++;
    if (r.status === "succeeded") wf.succeeded++;
    else if (r.status === "failed") wf.failed++;
    if (r.startedAt && r.finishedAt) {
      const dur = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
      if (dur >= 0) { durSum += dur; durCount++; }
    }
  }
  out.avgDurationMs = durCount > 0 ? Math.round(durSum / durCount) : 0;
  out.successRate = out.total > 0 ? out.succeeded / out.total : 1;
  return out;
}

/* ---------- Rules layer pass-through (compose with existing engine) ----------*/

/**
 * Evaluate rules and emit any new automation events through the bus.
 * Kernel-aware: also passes the kernel.coordination directives through
 * as bus events so subscribed automations can react.
 */
export function processKernelGraph({ graph, rules, state, user = null, bus = null }) {
  if (!graph || graph.status !== "ok") return { events: [], coordination: [] };
  const events = evaluate(graph.snap, rules);
  for (const ev of events) bus?.emit(`rule.${ev.ruleId}`, ev);
  for (const sig of (graph.coordination || [])) {
    bus?.emit(`coordination.${sig.dept}`, sig);
  }
  const patch = applyEvents(state, events, user);
  return { events, coordination: graph.coordination || [], patch };
}
