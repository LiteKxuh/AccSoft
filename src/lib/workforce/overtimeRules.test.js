import { describe, it, expect } from "vitest";
import { computeOvertime, estimateGross, getRuleProfile } from "./overtimeRules.js";

describe("computeOvertime — FLSA default", () => {
  it("no OT under 40h weekly", () => {
    const r = computeOvertime({
      shifts: [
        { date: "2026-05-11", hours: 8 },
        { date: "2026-05-12", hours: 8 },
        { date: "2026-05-13", hours: 8 },
        { date: "2026-05-14", hours: 8 },
        { date: "2026-05-15", hours: 4 },
      ],
      rule: "FLSA",
    });
    expect(r.totalHours).toBe(36);
    expect(r.regular).toBe(36);
    expect(r.ot).toBe(0);
  });

  it("OT after 40h weekly", () => {
    const r = computeOvertime({
      shifts: [
        { date: "2026-05-11", hours: 10 },
        { date: "2026-05-12", hours: 10 },
        { date: "2026-05-13", hours: 10 },
        { date: "2026-05-14", hours: 10 },
        { date: "2026-05-15", hours: 8 },
      ],
      rule: "FLSA",
    });
    expect(r.totalHours).toBe(48);
    expect(r.regular).toBe(40);
    expect(r.ot).toBe(8);
  });
});

describe("computeOvertime — California daily", () => {
  it("OT after 8h daily", () => {
    const r = computeOvertime({
      shifts: [{ date: "2026-05-11", hours: 10 }],
      rule: "CA",
    });
    expect(r.regular).toBe(8);
    expect(r.ot).toBe(2);
    expect(r.doubleTime).toBe(0);
  });

  it("double-time after 12h daily", () => {
    const r = computeOvertime({
      shifts: [{ date: "2026-05-11", hours: 14 }],
      rule: "CA",
    });
    expect(r.regular).toBe(8);
    expect(r.ot).toBe(4);
    expect(r.doubleTime).toBe(2);
  });

  it("7th consecutive day pays premium", () => {
    const shifts = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-${String(10 + i).padStart(2, "0")}`,
      hours: 8,
    }));
    const r = computeOvertime({ shifts, rule: "CA" });
    // First 6 days: 48 total → 40 reg + 8 OT
    // 7th day: 8h all at 1.5×
    expect(r.regular).toBe(40);
    expect(r.ot).toBe(16);
  });
});

describe("computeOvertime — holidays", () => {
  it("marks holiday hours in output", () => {
    const r = computeOvertime({
      shifts: [{ date: "2026-12-25", hours: 8 }],
      rule: "FLSA",
      holidays: ["2026-12-25"],
    });
    expect(r.holiday).toBe(8);
    expect(r.regular).toBe(8);
  });
});

describe("estimateGross", () => {
  it("blends regular, OT, and double-time pay", () => {
    const split = { regular: 40, ot: 8, doubleTime: 2, holiday: 0 };
    const gross = estimateGross({ split, hourlyRate: 20 });
    // 40×20 + 8×30 + 2×40 = 800 + 240 + 80 = 1120
    expect(gross).toBe(1120);
  });

  it("applies holiday multiplier as premium over straight time", () => {
    const split = { regular: 8, ot: 0, doubleTime: 0, holiday: 8 };
    const gross = estimateGross({ split, hourlyRate: 20, holidayMultiplier: 1.5 });
    // 8×20 + 8×20×0.5 = 160 + 80 = 240
    expect(gross).toBe(240);
  });
});

describe("getRuleProfile", () => {
  it("falls back to FLSA for unknown rule", () => {
    expect(getRuleProfile("unknown").weekly).toBe(40);
  });
});

describe("Nevada — daily OT only below threshold wage", () => {
  it("low-wage worker gets daily OT", () => {
    const r = computeOvertime({
      shifts: [{ date: "2026-05-11", hours: 10 }],
      rule: "NV", wage: 12.00,
    });
    expect(r.ot).toBeGreaterThan(0);
  });

  it("higher-wage worker only gets weekly OT", () => {
    const r = computeOvertime({
      shifts: [{ date: "2026-05-11", hours: 10 }],
      rule: "NV", wage: 18.00,
    });
    expect(r.ot).toBe(0);
  });
});
