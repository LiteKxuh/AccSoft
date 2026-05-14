import { describe, it, expect } from "vitest";
import {
  compressionScore, displacementAnalysis, priceRecommendation, losRecommendation, overbookingModel,
} from "./revenueEngine.js";

const mkReport = (date, vals = {}) => ({
  date,
  roomsAvailable: vals.roomsAvailable ?? 100,
  roomsSold: vals.roomsSold ?? 70,
  occupancy: (vals.roomsSold ?? 70) / 100,
  adr: vals.adr ?? 120,
});

const history = Array.from({ length: 90 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 2, 1 + i));
  return mkReport(d.toISOString().slice(0, 10), { roomsSold: 80, adr: 130 });
});

describe("compressionScore", () => {
  it("returns null without same-DoW history", () => {
    expect(compressionScore({ stayDate: "2026-05-15", history: [] })).toBeNull();
  });

  it("returns a score 0-1", () => {
    const s = compressionScore({ stayDate: "2026-06-15", history });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("displacementAnalysis", () => {
  const paceForecast = [
    { date: "2026-06-10", projectedOccupancy: 0.80, projectedAdr: 130 },
    { date: "2026-06-11", projectedOccupancy: 0.85, projectedAdr: 135 },
  ];

  it("returns missing-input on bad call", () => {
    expect(displacementAnalysis({}).status).toBe("missing-input");
  });

  it("recommends accept when group revenue exceeds displaced", () => {
    const r = displacementAnalysis({
      groupBid: { roomsPerNight: 10, dates: ["2026-06-10", "2026-06-11"], roomRate: 150 },
      paceForecast,
      capacity: 100,
    });
    expect(r.status).toBe("ok");
    expect(r.recommendation).toBe("accept");
  });

  it("recommends decline when bid is well below displaced", () => {
    const r = displacementAnalysis({
      groupBid: { roomsPerNight: 50, dates: ["2026-06-10", "2026-06-11"], roomRate: 40 },
      paceForecast,
      capacity: 100,
    });
    expect(r.recommendation).toBe("decline");
  });
});

describe("priceRecommendation", () => {
  it("requires 14+ days history", () => {
    expect(priceRecommendation({ history: history.slice(0, 5), dates: ["2026-06-01"] }).status).toBe("insufficient-history");
  });

  it("never exceeds tier lift cap", () => {
    const r = priceRecommendation({ history, dates: ["2026-06-01", "2026-06-02"] });
    expect(r.status).toBe("ok");
    for (const line of r.lines) {
      expect(line.liftPct).toBeLessThanOrEqual(r.tierLiftCap.up);
      expect(line.liftPct).toBeGreaterThanOrEqual(-r.tierLiftCap.down);
    }
  });

  it("classifies a $130 ADR property as upscale", () => {
    const r = priceRecommendation({ history, dates: ["2026-06-01"] });
    expect(r.tier).toBe("upscale");
  });
});

describe("losRecommendation", () => {
  it("triggers MLOS above threshold", () => {
    const recs = losRecommendation({ compressionByDate: { "2026-06-01": 0.92, "2026-06-02": 0.50 }, threshold: 0.85 });
    expect(recs[0].action).toBe("set-min-los");
    expect(recs[0].minLOS).toBeGreaterThanOrEqual(2);
    expect(recs[1].action).toBe("none");
  });
});

describe("overbookingModel", () => {
  it("returns insufficient-history with < 30 days", () => {
    expect(overbookingModel({ history: history.slice(0, 20) }).status).toBe("insufficient-history");
  });

  it("caps the cushion at maxOverbookPct", () => {
    const r = overbookingModel({ history, capacity: 100, maxOverbookPct: 0.05 });
    expect(r.recommendedCushionPct).toBeLessThanOrEqual(0.05);
  });
});
