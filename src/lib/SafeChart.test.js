import { describe, it, expect } from "vitest";
import { sanitizeChartRow, sanitizeChartData } from "./SafeChart.jsx";

describe("sanitizeChartRow", () => {
  it("replaces NaN with null on numeric keys", () => {
    const r = sanitizeChartRow({ rev: NaN, cost: 100 }, ["rev", "cost"]);
    expect(r.rev).toBeNull();
    expect(r.cost).toBe(100);
  });

  it("replaces Infinity with null", () => {
    const r = sanitizeChartRow({ rev: Infinity, cost: -Infinity }, ["rev", "cost"]);
    expect(r.rev).toBeNull();
    expect(r.cost).toBeNull();
  });

  it("leaves valid finite values untouched", () => {
    const r = sanitizeChartRow({ rev: 100, cost: 0 }, ["rev", "cost"]);
    expect(r.rev).toBe(100);
    expect(r.cost).toBe(0);
  });

  it("returns input unchanged for non-object", () => {
    expect(sanitizeChartRow(null)).toBeNull();
    expect(sanitizeChartRow("x")).toBe("x");
  });
});

describe("sanitizeChartData", () => {
  it("returns [] for non-arrays", () => {
    expect(sanitizeChartData(null)).toEqual([]);
    expect(sanitizeChartData(undefined)).toEqual([]);
    expect(sanitizeChartData({})).toEqual([]);
  });

  it("returns [] for empty arrays", () => {
    expect(sanitizeChartData([])).toEqual([]);
  });

  it("auto-detects numeric keys from first row", () => {
    const out = sanitizeChartData([
      { date: "2026-01-01", rev: NaN, cost: 100 },
      { date: "2026-01-02", rev: 200, cost: Infinity },
    ]);
    expect(out[0].rev).toBeNull();
    expect(out[1].cost).toBeNull();
    expect(out[0].date).toBe("2026-01-01");
  });

  it("respects explicit numericKeys list", () => {
    const out = sanitizeChartData([{ a: NaN, b: NaN }], ["a"]);
    expect(out[0].a).toBeNull();
    // b not in numericKeys → not sanitized
    expect(Number.isNaN(out[0].b)).toBe(true);
  });
});
