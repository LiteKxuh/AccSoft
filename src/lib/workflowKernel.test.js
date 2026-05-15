import { describe, it, expect } from "vitest";
import {
  createEventBus, createWorkflow, runWorkflow, replayWorkflow, workflowMetrics, processKernelGraph,
} from "./workflowKernel.js";

describe("createEventBus", () => {
  it("subscribes, emits, and unsubscribes", () => {
    const bus = createEventBus();
    const got = [];
    const unsub = bus.on("x", p => got.push(p));
    bus.emit("x", { a: 1 });
    unsub();
    bus.emit("x", { a: 2 });
    expect(got).toEqual([{ a: 1 }]);
    expect(bus.log.length).toBe(2);
  });

  it("once fires only once", () => {
    const bus = createEventBus();
    let count = 0;
    bus.once("ping", () => { count++; });
    bus.emit("ping");
    bus.emit("ping");
    expect(count).toBe(1);
  });

  it("handler errors do not crash the bus", () => {
    const bus = createEventBus();
    bus.on("x", () => { throw new Error("boom"); });
    let next = false;
    bus.on("x", () => { next = true; });
    bus.emit("x");
    expect(next).toBe(true);
  });
});

describe("createWorkflow validation", () => {
  it("requires id and steps", () => {
    expect(() => createWorkflow({})).toThrow();
    expect(() => createWorkflow({ id: "w" })).toThrow();
  });
  it("rejects duplicate step ids", () => {
    expect(() => createWorkflow({ id: "w", steps: [
      { id: "a", run: async () => ({ ok: true }) },
      { id: "a", run: async () => ({ ok: true }) },
    ] })).toThrow(/duplicate/);
  });
  it("rejects unknown deps", () => {
    expect(() => createWorkflow({ id: "w", steps: [
      { id: "a", deps: ["nope"], run: async () => ({ ok: true }) },
    ] })).toThrow(/unknown/);
  });
  it("detects cycles", () => {
    expect(() => createWorkflow({ id: "w", steps: [
      { id: "a", deps: ["b"], run: async () => ({ ok: true }) },
      { id: "b", deps: ["a"], run: async () => ({ ok: true }) },
    ] })).toThrow(/cycle/);
  });
});

describe("runWorkflow — happy path", () => {
  it("executes a DAG and produces all outputs", async () => {
    const wf = createWorkflow({
      id: "w1",
      steps: [
        { id: "a", run: async () => ({ ok: true, output: 1 }) },
        { id: "b", deps: ["a"], run: async ({ prior }) => ({ ok: true, output: prior.a + 1 }) },
        { id: "c", deps: ["a", "b"], run: async ({ prior }) => ({ ok: true, output: prior.a + prior.b }) },
      ],
    });
    const run = wf.newRun();
    const { run: out } = await runWorkflow(wf, run);
    expect(out.status).toBe("succeeded");
    expect(out.steps.find(s => s.id === "c").output).toBe(3);
  });
});

describe("runWorkflow — retries", () => {
  it("retries a failing step up to maxRetries", async () => {
    let calls = 0;
    const wf = createWorkflow({
      id: "w2",
      steps: [{
        id: "flaky", maxRetries: 2,
        run: async () => {
          calls++;
          if (calls < 3) return { ok: false, error: "transient", retryable: true };
          return { ok: true, output: "done" };
        },
      }],
    });
    const run = wf.newRun();
    // First call — attempt 1 fails, marked retry-pending
    let res = await runWorkflow(wf, run);
    expect(res.run.status).toBe("awaiting-retry");
    expect(res.run.steps[0].attempts).toBe(1);
    // Caller invokes again (simulating backoff elapsed)
    res = await runWorkflow(wf, res.run);
    expect(res.run.status).toBe("awaiting-retry");
    expect(res.run.steps[0].attempts).toBe(2);
    // Final attempt
    res = await runWorkflow(wf, res.run);
    expect(res.run.status).toBe("succeeded");
    expect(res.run.steps[0].attempts).toBe(3);
  });

  it("marks failed after exhausting retries", async () => {
    const wf = createWorkflow({
      id: "w3",
      steps: [{
        id: "doomed", maxRetries: 1,
        run: async () => ({ ok: false, error: "permanent", retryable: true }),
      }],
    });
    let run = wf.newRun();
    let res = await runWorkflow(wf, run);
    res = await runWorkflow(wf, res.run);
    expect(res.run.status).toBe("failed");
    expect(res.run.steps[0].status).toBe("failed");
  });
});

describe("runWorkflow — blocking", () => {
  it("blocks downstream steps when a dep fails", async () => {
    const wf = createWorkflow({
      id: "w4",
      steps: [
        { id: "a", run: async () => ({ ok: false, error: "no", retryable: false }) },
        { id: "b", deps: ["a"], run: async () => ({ ok: true }) },
      ],
    });
    const { run } = await runWorkflow(wf, wf.newRun());
    expect(run.steps.find(s => s.id === "a").status).toBe("failed");
    expect(run.steps.find(s => s.id === "b").status).toBe("blocked");
    expect(run.status).toBe("failed");
  });
});

describe("runWorkflow — rollback", () => {
  it("invokes rollback when a step fails permanently", async () => {
    let rolledBack = false;
    const wf = createWorkflow({
      id: "w5",
      steps: [{
        id: "fails", maxRetries: 0,
        run: async () => ({ ok: false, error: "x", retryable: false }),
        rollback: async () => { rolledBack = true; },
      }],
    });
    const { run } = await runWorkflow(wf, wf.newRun());
    expect(rolledBack).toBe(true);
    expect(run.steps[0].status).toBe("rolled-back");
  });
});

describe("replayWorkflow", () => {
  it("re-emits a finished run's lifecycle events", async () => {
    const wf = createWorkflow({ id: "w6", steps: [{ id: "a", run: async () => ({ ok: true }) }] });
    const { run } = await runWorkflow(wf, wf.newRun());
    const bus = createEventBus();
    const replayed = [];
    bus.on("workflow.start", () => replayed.push("start"));
    bus.on("step.succeed", () => replayed.push("succeed"));
    bus.on("workflow.success", () => replayed.push("success"));
    const n = replayWorkflow(run, bus);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(replayed).toContain("start");
    expect(replayed).toContain("succeed");
    expect(replayed).toContain("success");
  });
});

describe("workflowMetrics", () => {
  it("rolls up runs", () => {
    const runs = [
      { workflowId: "a", status: "succeeded", startedAt: "2026-05-01T00:00:00Z", finishedAt: "2026-05-01T00:00:10Z" },
      { workflowId: "a", status: "failed", startedAt: "2026-05-01T00:00:00Z", finishedAt: "2026-05-01T00:00:05Z" },
      { workflowId: "b", status: "awaiting-retry", startedAt: "2026-05-01T00:00:00Z" },
    ];
    const m = workflowMetrics(runs);
    expect(m.total).toBe(3);
    expect(m.succeeded).toBe(1);
    expect(m.failed).toBe(1);
    expect(m.awaiting).toBe(1);
    expect(m.byWorkflow.a.total).toBe(2);
    expect(m.successRate).toBeCloseTo(1 / 3, 5);
    expect(m.avgDurationMs).toBeGreaterThan(0);
  });
});

describe("processKernelGraph", () => {
  it("does nothing when graph is not ok", () => {
    const r = processKernelGraph({ graph: { status: "missing-input" }, rules: [], state: {} });
    expect(r.events).toEqual([]);
  });

  it("emits coordination events through the bus", () => {
    const bus = createEventBus();
    const got = [];
    bus.on("coordination.labor", e => got.push(e));
    const fakeGraph = {
      status: "ok",
      snap: { status: "ok", propertyId: "p1", asOf: "2026-05-14" },
      coordination: [{ dept: "labor", action: "increase-staffing-review", reason: "x" }],
    };
    processKernelGraph({ graph: fakeGraph, rules: [], state: {}, bus });
    expect(got.length).toBe(1);
    expect(got[0].dept).toBe("labor");
  });
});
