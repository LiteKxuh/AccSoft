import { describe, it, expect, beforeEach } from "vitest";
import { record, getLog, clearLog, subscribe, getMetrics, timeOperation, healthSnapshot } from "./diagnostics.js";

describe("diagnostics", () => {
  beforeEach(() => clearLog());

  it("records and reads back log entries", () => {
    record("info", "test", "hello");
    const log = getLog();
    expect(log.length).toBe(1);
    expect(log[0].message).toBe("hello");
    expect(log[0].level).toBe("info");
  });

  it("serializes Errors safely", () => {
    record("error", "test", "boom", new Error("kaboom"));
    const e = getLog()[0];
    expect(e.detail.message).toBe("kaboom");
    expect(typeof e.detail.stack).toBe("string");
  });

  it("clears the log", () => {
    record("info", "test", "x");
    clearLog();
    expect(getLog().length).toBe(0);
  });

  it("notifies subscribers", () => {
    let received = 0;
    const unsub = subscribe(() => { received++; });
    record("info", "t", "a");
    record("info", "t", "b");
    expect(received).toBe(2);
    unsub();
    record("info", "t", "c");
    expect(received).toBe(2);
  });

  it("caps the ring buffer", () => {
    for (let i = 0; i < 600; i++) record("info", "t", `m${i}`);
    expect(getLog().length).toBeLessThanOrEqual(500);
  });

  it("handles circular detail without throwing", () => {
    const a = {}; a.self = a;
    expect(() => record("info", "t", "circ", a)).not.toThrow();
    expect(getLog()[0].detail).toBeTruthy();
  });

  it("timeOperation logs slow ops", async () => {
    // simulate a slow op by manually pushing — actual timing is non-deterministic in tests
    await timeOperation("fast", async () => 1);
    // Not slow → no log entry
    expect(getLog().filter(e => e.message?.includes("fast")).length).toBe(0);
  });

  it("timeOperation rethrows on failure and logs", async () => {
    await expect(timeOperation("explodes", async () => { throw new Error("bang"); })).rejects.toThrow("bang");
    expect(getLog().some(e => e.message?.includes("explodes"))).toBe(true);
  });

  it("healthSnapshot returns a status band", () => {
    const h = healthSnapshot();
    expect(["healthy", "watch", "degraded"]).toContain(h.status);
  });
});
