import { describe, it, expect } from "vitest";
import { computeKpi, computeAllForPayload, getKpi, listKpis, registerKpi, validateInputs } from "./registry.js";

describe("KPI registry — built-in canonical metrics", () => {
  it("computes occupancy", () => {
    const r = computeKpi("occupancy", { roomsSold: 75, roomsAvailable: 100 });
    expect(r.value).toBe(0.75);
    expect(r.ok).toBe(true);
    expect(r.formatted).toBe("75.0%");
  });

  it("flags impossible occupancy", () => {
    const r = computeKpi("occupancy", { roomsSold: 120, roomsAvailable: 100 });
    expect(r.ok).toBe(false);
    expect(r.guardFlag).toBe("above-ceiling");
  });

  it("computes ADR", () => {
    const r = computeKpi("adr", { roomRevenue: 8400, roomsSold: 70 });
    expect(r.value).toBe(120);
    expect(r.formatted).toBe("$120.00");
  });

  it("ADR is 0 with zero rooms sold and zero revenue", () => {
    const r = computeKpi("adr", { roomRevenue: 0, roomsSold: 0 });
    expect(r.value).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("ADR flags positive revenue with zero rooms sold", () => {
    const r = computeKpi("adr", { roomRevenue: 1000, roomsSold: 0 });
    expect(r.ok).toBe(false);
  });

  it("computes RevPAR", () => {
    const r = computeKpi("revpar", { roomRevenue: 8400, roomsAvailable: 100 });
    expect(r.value).toBe(84);
  });

  it("RevPAR ≈ ADR × Occupancy", () => {
    const adr = computeKpi("adr", { roomRevenue: 8400, roomsSold: 70 }).value;
    const occ = computeKpi("occupancy", { roomsSold: 70, roomsAvailable: 100 }).value;
    const revpar = computeKpi("revpar", { roomRevenue: 8400, roomsAvailable: 100 }).value;
    expect(adr * occ).toBeCloseTo(revpar, 5);
  });

  it("computes labor.pctRev and flags above-warn", () => {
    const r = computeKpi("labor.pctRev", { laborCost: 4500, totalRevenue: 10000 });
    expect(r.value).toBe(0.45);
    expect(r.guardFlag).toBe("warn-high");
  });

  it("computes GOP and NOI margins", () => {
    expect(computeKpi("gop.margin", { gop: 4500, totalRevenue: 10000 }).value).toBe(0.45);
    expect(computeKpi("noi.margin", { noi: 2500, totalRevenue: 10000 }).value).toBe(0.25);
  });

  it("computes flow-through ratio", () => {
    const r = computeKpi("flowthrough", { profitDelta: 1500, revenueDelta: 3000 });
    expect(r.value).toBe(0.5);
  });
});

describe("validateInputs", () => {
  it("returns null when all inputs are present", () => {
    expect(validateInputs("occupancy", { roomsSold: 70, roomsAvailable: 100 })).toBeNull();
  });

  it("returns a message when missing", () => {
    expect(validateInputs("occupancy", { roomsSold: 70 })).toMatch(/missing/);
  });

  it("returns a message for unknown KPI", () => {
    expect(validateInputs("magic.kpi", {})).toMatch(/unknown/);
  });
});

describe("listKpis", () => {
  it("returns categorized KPIs", () => {
    const ops = listKpis("operations");
    expect(ops.find(k => k.id === "adr")).toBeTruthy();
    const fin = listKpis("financial");
    expect(fin.find(k => k.id === "gop.margin")).toBeTruthy();
  });
});

describe("registerKpi — extension point", () => {
  it("adds a custom KPI and computes it", () => {
    registerKpi({
      id: "custom.test", label: "Test KPI", unit: "ratio", kind: "ratio",
      category: "custom",
      inputs: ["a", "b"],
      compute({ a, b }) { return { value: b > 0 ? a / b : 0, ok: b > 0 }; },
      format: (v) => v.toFixed(2),
    });
    const r = computeKpi("custom.test", { a: 5, b: 2 });
    expect(r.value).toBe(2.5);
    expect(r.formatted).toBe("2.50");
  });

  it("requires id and compute", () => {
    expect(() => registerKpi({})).toThrow();
    expect(() => registerKpi({ id: "no.compute" })).toThrow();
  });
});

describe("computeAllForPayload", () => {
  it("computes every supported KPI from a payload", () => {
    const inputs = {
      roomsSold: 70, roomsAvailable: 100,
      roomRevenue: 8400, totalRevenue: 9000,
      laborCost: 2700, totalCost: 3000,
      gop: 4500, noi: 3500,
    };
    const all = computeAllForPayload(inputs);
    expect(all.occupancy.value).toBe(0.7);
    expect(all.adr.value).toBe(120);
    expect(all.revpar.value).toBe(84);
    expect(all.cpor.value).toBeCloseTo(42.86, 2);
    expect(all["labor.pctRev"].value).toBe(0.3);
  });

  it("skips KPIs missing required inputs", () => {
    const inputs = { roomsSold: 70, roomsAvailable: 100 };
    const all = computeAllForPayload(inputs);
    expect(all.occupancy).toBeTruthy();
    expect(all.adr).toBeUndefined(); // missing roomRevenue
  });
});
