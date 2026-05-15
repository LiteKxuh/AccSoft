import { describe, it, expect, beforeEach } from "vitest";
import {
  registerAdapter, getAdapter, listAdapters, unregisterAdapter,
  buildSyncPlan, runSyncPlan, integrationHealth, reconcileRecord,
  registerDefaultAdapters, ingestWebhook, CANONICAL_SCHEMAS, __test,
} from "./hospitalityIntegrationHub.js";
import { createEventBus } from "./workflowKernel.js";

function makeFakeAdapter(overrides = {}) {
  return {
    id: "test", label: "Test", kind: "pms", transport: "rest",
    capabilities: ["reservations"],
    normalize: (r) => ({ ...r, _source: "test" }),
    verify: async () => ({ ok: true }),
    pull: async () => ({ ok: true, records: [] }),
    ...overrides,
  };
}

// Wipe registry between tests by unregistering known ids
beforeEach(() => {
  for (const a of listAdapters()) unregisterAdapter(a.id);
});

describe("registerAdapter validation", () => {
  it("requires id, normalize, verify, pull", () => {
    expect(() => registerAdapter({})).toThrow();
    expect(() => registerAdapter({ id: "x" })).toThrow();
  });
  it("stores and retrieves adapters", () => {
    const a = makeFakeAdapter();
    registerAdapter(a);
    expect(getAdapter("test").label).toBe("Test");
  });
});

describe("listAdapters with filters", () => {
  it("filters by kind", () => {
    registerAdapter(makeFakeAdapter({ id: "p1", kind: "pms" }));
    registerAdapter(makeFakeAdapter({ id: "r1", kind: "rms" }));
    expect(listAdapters({ kind: "pms" }).length).toBe(1);
    expect(listAdapters({ kind: "rms" }).length).toBe(1);
  });

  it("filters by capability", () => {
    registerAdapter(makeFakeAdapter({ id: "x", capabilities: ["reservations"] }));
    registerAdapter(makeFakeAdapter({ id: "y", capabilities: ["rates"] }));
    expect(listAdapters({ capability: "rates" }).map(a => a.id)).toEqual(["y"]);
  });
});

describe("buildSyncPlan", () => {
  it("builds one step per adapter × capability", () => {
    registerAdapter(makeFakeAdapter({ id: "a", capabilities: ["reservations", "rates"] }));
    registerAdapter(makeFakeAdapter({ id: "b", capabilities: ["transactions"] }));
    const plan = buildSyncPlan({});
    expect(plan.length).toBe(3);
  });

  it("respects types filter", () => {
    registerAdapter(makeFakeAdapter({ id: "a", capabilities: ["reservations", "rates"] }));
    const plan = buildSyncPlan({ types: ["rates"] });
    expect(plan.length).toBe(1);
    expect(plan[0].type).toBe("rates");
  });
});

describe("runSyncPlan", () => {
  it("executes adapters and returns per-step results", async () => {
    registerAdapter(makeFakeAdapter({
      pull: async () => ({ ok: true, records: [{ id: "r1" }, { id: "r2" }] }),
    }));
    const plan = buildSyncPlan({});
    const results = await runSyncPlan(plan, {});
    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].recordCount).toBe(2);
    expect(results[0].records[0]._source).toBe("test");
  });

  it("captures pull errors per step", async () => {
    registerAdapter(makeFakeAdapter({
      pull: async () => { throw new Error("network down"); },
    }));
    const plan = buildSyncPlan({});
    const results = await runSyncPlan(plan, {});
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("network down");
  });

  it("emits bus events", async () => {
    registerAdapter(makeFakeAdapter());
    const bus = createEventBus();
    const got = [];
    bus.on("sync.start", () => got.push("start"));
    bus.on("sync.succeed", () => got.push("succeed"));
    await runSyncPlan(buildSyncPlan({}), { bus });
    expect(got).toContain("start");
    expect(got).toContain("succeed");
  });
});

describe("integrationHealth", () => {
  it("rolls up adapter success/failure stats", () => {
    const results = [
      { adapterId: "a", type: "x", ok: true, recordCount: 5, finishedAt: "2026-05-14T00:00:01Z" },
      { adapterId: "a", type: "x", ok: false, error: "x", recordCount: 0, finishedAt: "2026-05-14T00:00:02Z" },
      { adapterId: "b", type: "x", ok: true, recordCount: 3, finishedAt: "2026-05-14T00:00:03Z" },
    ];
    const h = integrationHealth(results);
    expect(h.adapterCount).toBe(2);
    expect(h.healthyCount).toBe(1);
    const a = h.rows.find(r => r.adapterId === "a");
    expect(a.health).toBe("degraded");
    expect(a.lastError).toBe("x");
  });
});

describe("reconcileRecord", () => {
  it("prefers higher-precedence source", () => {
    const records = [
      { id: "r1", balance: 100, _source: "opera", updatedAt: "2026-05-14T10:00:00Z" },
      { id: "r1", balance: 110, _source: "mews", updatedAt: "2026-05-14T08:00:00Z" },
    ];
    const r = reconcileRecord(records, { precedence: { opera: 10, mews: 5 } });
    expect(r.balance).toBe(100);
  });

  it("falls back to latest updatedAt when precedence ties", () => {
    const records = [
      { id: "r1", balance: 100, _source: "opera", updatedAt: "2026-05-14T10:00:00Z" },
      { id: "r1", balance: 110, _source: "mews", updatedAt: "2026-05-14T12:00:00Z" },
    ];
    const r = reconcileRecord(records);
    expect(r.balance).toBe(110);
  });
});

describe("registerDefaultAdapters", () => {
  it("registers OPERA, Mews, Cloudbeds, etc.", () => {
    registerDefaultAdapters();
    const ids = listAdapters().map(a => a.id);
    expect(ids).toContain("opera");
    expect(ids).toContain("mews");
    expect(ids).toContain("cloudbeds");
    expect(ids).toContain("toast");
    expect(ids).toContain("adp");
  });

  it("is idempotent — second call does not duplicate", () => {
    registerDefaultAdapters();
    const firstCount = listAdapters().length;
    registerDefaultAdapters();
    expect(listAdapters().length).toBe(firstCount);
  });
});

describe("ingestWebhook", () => {
  it("rejects unknown adapter", () => {
    const r = ingestWebhook({ adapterId: "ghost", type: "reservation", payload: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown adapter");
  });

  it("rejects unknown type", () => {
    registerAdapter(makeFakeAdapter());
    const r = ingestWebhook({ adapterId: "test", type: "blob", payload: {} });
    expect(r.ok).toBe(false);
  });

  it("rejects payloads missing canonical fields", () => {
    registerAdapter(makeFakeAdapter());
    const r = ingestWebhook({ adapterId: "test", type: "reservation", payload: { id: "r1" } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("missing required fields");
  });

  it("accepts a fully-formed canonical payload", () => {
    registerAdapter(makeFakeAdapter());
    const payload = Object.fromEntries(CANONICAL_SCHEMAS.reservation.map(k => [k, "v"]));
    const r = ingestWebhook({ adapterId: "test", type: "reservation", payload });
    expect(r.ok).toBe(true);
    expect(r.event.kind).toBe("webhook.received");
  });
});
