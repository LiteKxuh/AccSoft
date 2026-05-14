import { describe, it, expect } from "vitest";
import { makePayGroup, periodFor, listPeriods, nextPayDate, isLocked, lockPeriod } from "./payPeriods.js";

describe("makePayGroup", () => {
  it("requires id, frequency, and anchor for weekly/biweekly", () => {
    expect(() => makePayGroup({ frequency: "weekly" })).toThrow();
    expect(() => makePayGroup({ id: "g1", frequency: "weekly" })).toThrow();
    expect(() => makePayGroup({ id: "g1", frequency: "biweekly" })).toThrow();
  });

  it("monthly does not require anchorDate", () => {
    const g = makePayGroup({ id: "g1", frequency: "monthly" });
    expect(g.frequency).toBe("monthly");
  });
});

describe("periodFor — weekly", () => {
  const group = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04" }); // Monday

  it("falls inside the week", () => {
    const p = periodFor(group, "2026-05-07");
    expect(p.start).toBe("2026-05-04");
    expect(p.end).toBe("2026-05-10");
    expect(p.isCurrent).toBe(true);
  });

  it("rolls to next week", () => {
    const p = periodFor(group, "2026-05-12");
    expect(p.start).toBe("2026-05-11");
    expect(p.end).toBe("2026-05-17");
  });
});

describe("periodFor — biweekly", () => {
  const group = makePayGroup({ id: "g1", frequency: "biweekly", anchorDate: "2026-05-04" });

  it("returns 14-day periods", () => {
    const p = periodFor(group, "2026-05-15");
    expect(p.start).toBe("2026-05-04");
    expect(p.end).toBe("2026-05-17");
    const next = periodFor(group, "2026-05-19");
    expect(next.start).toBe("2026-05-18");
    expect(next.end).toBe("2026-05-31");
  });
});

describe("periodFor — semimonthly", () => {
  const group = makePayGroup({ id: "g1", frequency: "semimonthly" });

  it("first half of month", () => {
    const p = periodFor(group, "2026-05-10");
    expect(p.start).toBe("2026-05-01");
    expect(p.end).toBe("2026-05-15");
  });

  it("second half of month", () => {
    const p = periodFor(group, "2026-05-20");
    expect(p.start).toBe("2026-05-16");
    expect(p.end).toBe("2026-05-31");
  });
});

describe("periodFor — monthly", () => {
  const group = makePayGroup({ id: "g1", frequency: "monthly" });

  it("returns calendar month", () => {
    const p = periodFor(group, "2026-02-15");
    expect(p.start).toBe("2026-02-01");
    expect(p.end).toBe("2026-02-28");
  });
});

describe("listPeriods", () => {
  it("lists every weekly period in range", () => {
    const group = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04" });
    const periods = listPeriods(group, { start: "2026-05-04", end: "2026-05-25" });
    expect(periods.length).toBeGreaterThanOrEqual(3);
    expect(periods[0].start).toBe("2026-05-04");
  });
});

describe("nextPayDate", () => {
  it("adds payDelayDays after period end", () => {
    const group = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04", payDelayDays: 5 });
    const next = nextPayDate(group, "2026-05-07");
    expect(next).toBe("2026-05-15");
  });
});

describe("isLocked + lockPeriod", () => {
  it("recognizes a locked period", () => {
    const group = makePayGroup({ id: "g1", frequency: "weekly", anchorDate: "2026-05-04" });
    const period = periodFor(group, "2026-05-07");
    const state = lockPeriod({}, period, { id: "u1" });
    expect(isLocked(period, state.lockedPayPeriods)).toBe(true);
  });
});
