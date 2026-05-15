import { describe, it, expect } from "vitest";
import {
  scoreSentiment, categorizeFeedback, analyzeGuestExperience, buildGuestSignal,
} from "./guestExperienceEngine.js";

describe("scoreSentiment", () => {
  it("rates negative text below zero", () => {
    expect(scoreSentiment("the room was dirty and the staff was rude")).toBeLessThan(0);
  });
  it("rates positive text above zero", () => {
    expect(scoreSentiment("amazing service and a spotless room")).toBeGreaterThan(0);
  });
  it("returns 0 when text is empty", () => {
    expect(scoreSentiment("")).toBe(0);
  });
  it("returns 0 when text has no lexicon hits", () => {
    expect(scoreSentiment("just an ordinary stay")).toBe(0);
  });
});

describe("categorizeFeedback", () => {
  it("tags housekeeping for cleanliness complaints", () => {
    expect(categorizeFeedback("the linen was stained")).toContain("housekeeping");
  });
  it("tags maintenance for broken AC", () => {
    expect(categorizeFeedback("the ac was broken when we got there")).toContain("maintenance");
  });
  it("tags front_desk for slow check-in", () => {
    expect(categorizeFeedback("checkin took forever, terrible front desk")).toContain("front_desk");
  });
  it("tags multiple categories when applicable", () => {
    const cats = categorizeFeedback("dirty room, broken tv, rude front desk");
    expect(cats).toContain("housekeeping");
    expect(cats).toContain("maintenance");
    expect(cats).toContain("front_desk");
  });
});

describe("analyzeGuestExperience", () => {
  const mkFeedback = () => [
    { id: "f1", propertyId: "p1", date: "2026-05-01", rating: 5, text: "amazing clean room and friendly staff" },
    { id: "f2", propertyId: "p1", date: "2026-05-03", rating: 2, text: "the room was dirty and the bathroom smelled" },
    { id: "f3", propertyId: "p1", date: "2026-05-05", rating: 1, text: "ac broken, tv broken, terrible" },
    { id: "f4", propertyId: "p1", date: "2026-05-07", rating: 4, text: "great service overall" },
    { id: "f5", propertyId: "p1", date: "2026-05-10", rating: 3, text: "just an ordinary stay" },
    { id: "f6", propertyId: "p1", date: "2026-05-12", rating: 1, text: "stained linen, mildew smell, awful" },
  ];

  it("returns no-feedback when none in period", () => {
    expect(analyzeGuestExperience({ feedback: [], propertyId: "p1" }).status).toBe("no-feedback");
  });

  it("produces volume, avg rating, sentiment distribution", () => {
    const r = analyzeGuestExperience({ feedback: mkFeedback(), propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-14" } });
    expect(r.status).toBe("ok");
    expect(r.volume).toBe(6);
    expect(r.avgRating).toBeCloseTo((5 + 2 + 1 + 4 + 3 + 1) / 6, 5);
    expect(r.sentimentDistribution.negative).toBeGreaterThan(0);
    expect(r.sentimentDistribution.positive).toBeGreaterThan(0);
  });

  it("clusters by category", () => {
    const r = analyzeGuestExperience({ feedback: mkFeedback(), propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-14" } });
    const cats = r.categories.map(c => c.category);
    expect(cats).toContain("housekeeping");
    expect(cats).toContain("maintenance");
  });

  it("detects deteriorating trend when later feedback is worse", () => {
    const feedback = [
      { id: "a1", propertyId: "p1", date: "2026-05-01", text: "amazing wonderful great" },
      { id: "a2", propertyId: "p1", date: "2026-05-02", text: "clean and friendly" },
      { id: "a3", propertyId: "p1", date: "2026-05-03", text: "spotless and helpful" },
      { id: "b1", propertyId: "p1", date: "2026-05-12", text: "dirty and rude" },
      { id: "b2", propertyId: "p1", date: "2026-05-13", text: "broken ac, terrible" },
      { id: "b3", propertyId: "p1", date: "2026-05-14", text: "stained linen, awful" },
    ];
    const r = analyzeGuestExperience({ feedback, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-14" } });
    expect(r.trend.direction).toBe("deteriorating");
    expect(r.trend.slope).toBeLessThan(0);
  });

  it("detects repeat offenders", () => {
    const feedback = [
      { id: "a", guestId: "g1", propertyId: "p1", date: "2026-05-01", text: "dirty and rude" },
      { id: "b", guestId: "g1", propertyId: "p1", date: "2026-05-05", text: "broken broken broken" },
      { id: "c", guestId: "g2", propertyId: "p1", date: "2026-05-02", text: "wonderful" },
    ];
    const r = analyzeGuestExperience({ feedback, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-14" } });
    expect(r.repeatOffenders.length).toBe(1);
    expect(r.repeatOffenders[0].guestId).toBe("g1");
  });

  it("correlates with op graph when staffing stress is high", () => {
    const opGraph = {
      status: "ok",
      indices: { staffingStressIndex: 70 },
      snap: { compression: false },
    };
    const feedback = [
      { id: "a", propertyId: "p1", date: "2026-05-01", text: "rude slow staff terrible" },
      { id: "b", propertyId: "p1", date: "2026-05-02", text: "dirty mildew awful" },
      { id: "c", propertyId: "p1", date: "2026-05-03", text: "stained linen" },
    ];
    const r = analyzeGuestExperience({ feedback, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-14" }, opGraph });
    expect(r.correlations.some(c => c.opPressure === "high-staffing-stress")).toBe(true);
  });

  it("computes complaint rate against roomsSoldInPeriod", () => {
    const r = analyzeGuestExperience({
      feedback: mkFeedback(), propertyId: "p1",
      period: { start: "2026-05-01", end: "2026-05-14" },
      roomsSoldInPeriod: 200,
    });
    expect(r.complaintRate).toBeGreaterThan(0);
    expect(r.complaintRate).toBeLessThan(1);
  });
});

describe("buildGuestSignal", () => {
  it("returns a compact signal for kernel consumption", () => {
    const feedback = [
      { id: "a", propertyId: "p1", date: "2026-05-01", rating: 2, text: "dirty rude awful" },
    ];
    const sig = buildGuestSignal({ feedback, propertyId: "p1", period: { start: "2026-05-01", end: "2026-05-14" } });
    expect(sig).toBeTruthy();
    expect(sig.avgRating).toBe(2);
    expect(sig.avgSentiment).toBeLessThan(0);
  });

  it("returns null when no feedback", () => {
    const sig = buildGuestSignal({ feedback: [], propertyId: "p1" });
    expect(sig).toBeNull();
  });
});
