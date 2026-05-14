import { describe, it, expect } from "vitest";
import { apAging, arAging, AGING_BUCKETS } from "./aging.js";

const ASOF = new Date("2026-05-14T00:00:00Z");
const daysAgo = (n) => {
  const d = new Date(ASOF); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
};

describe("apAging", () => {
  const vendors = [{ id: "v1", name: "Sysco" }, { id: "v2", name: "Local Linens" }];

  it("buckets open invoices by days past due", () => {
    const invoices = [
      { id: "i1", vendorId: "v1", propertyId: "p1", amount: 500,  issuedDate: daysAgo(5),   dueDate: daysAgo(0),   status: "open" },
      { id: "i2", vendorId: "v1", propertyId: "p1", amount: 1000, issuedDate: daysAgo(45),  dueDate: daysAgo(15),  status: "open" },
      { id: "i3", vendorId: "v2", propertyId: "p1", amount: 2500, issuedDate: daysAgo(80),  dueDate: daysAgo(50),  status: "open" },
      { id: "i4", vendorId: "v2", propertyId: "p1", amount: 800,  issuedDate: daysAgo(130), dueDate: daysAgo(100), status: "open" },
      { id: "i5", vendorId: "v2", propertyId: "p1", amount: 600,  issuedDate: daysAgo(180), dueDate: daysAgo(150), status: "open" },
    ];
    const a = apAging({ invoices, vendors, asOf: ASOF });
    // i1 (0d) + i2 (15d) → current = 1500
    expect(a.totals.current).toBe(1500);
    // i3 (50d) → 30-59 bucket
    expect(a.totals.b30).toBe(2500);
    // i4 (100d) → 90-119 bucket
    expect(a.totals.b90).toBe(800);
    // i5 (150d) → 120+ bucket
    expect(a.totals.b120).toBe(600);
    expect(a.totals.total).toBe(5400);
  });

  it("excludes paid and void", () => {
    const invoices = [
      { id: "i1", vendorId: "v1", propertyId: "p1", amount: 500, issuedDate: daysAgo(60), dueDate: daysAgo(30), status: "paid" },
      { id: "i2", vendorId: "v1", propertyId: "p1", amount: 500, issuedDate: daysAgo(60), dueDate: daysAgo(30), status: "void" },
      { id: "i3", vendorId: "v1", propertyId: "p1", amount: 500, issuedDate: daysAgo(60), dueDate: daysAgo(30), status: "open" },
    ];
    const a = apAging({ invoices, vendors, asOf: ASOF });
    expect(a.totals.total).toBe(500);
  });

  it("filters by property scope", () => {
    const invoices = [
      { id: "i1", vendorId: "v1", propertyId: "p1", amount: 500, issuedDate: daysAgo(60), dueDate: daysAgo(30), status: "open" },
      { id: "i2", vendorId: "v1", propertyId: "p2", amount: 800, issuedDate: daysAgo(60), dueDate: daysAgo(30), status: "open" },
    ];
    const a = apAging({ invoices, vendors, propIds: ["p1"], asOf: ASOF });
    expect(a.totals.total).toBe(500);
  });

  it("rolls up by vendor", () => {
    const invoices = [
      { id: "i1", vendorId: "v1", propertyId: "p1", amount: 100, issuedDate: daysAgo(40), dueDate: daysAgo(10), status: "open" },
      { id: "i2", vendorId: "v1", propertyId: "p1", amount: 200, issuedDate: daysAgo(40), dueDate: daysAgo(10), status: "open" },
      { id: "i3", vendorId: "v2", propertyId: "p1", amount: 500, issuedDate: daysAgo(40), dueDate: daysAgo(10), status: "open" },
    ];
    const a = apAging({ invoices, vendors, asOf: ASOF });
    expect(a.byVendor.length).toBe(2);
    expect(a.byVendor[0].total).toBe(500);  // v2 first
    expect(a.byVendor[1].total).toBe(300);  // v1 second
  });

  it("computes weighted average days", () => {
    const invoices = [
      { id: "i1", vendorId: "v1", propertyId: "p1", amount: 100, issuedDate: daysAgo(40), dueDate: daysAgo(10), status: "open" },
      { id: "i2", vendorId: "v1", propertyId: "p1", amount: 100, issuedDate: daysAgo(70), dueDate: daysAgo(40), status: "open" },
    ];
    const a = apAging({ invoices, vendors, asOf: ASOF });
    expect(a.weightedAverageDays).toBeCloseTo((10 + 40) / 2, 0);
  });
});

describe("arAging", () => {
  it("ages direct-bill folios from report date", () => {
    const reports = [
      { date: daysAgo(0),   propertyId: "p1", breakdown: { payments: { directBill: 200 } } },
      { date: daysAgo(45),  propertyId: "p1", breakdown: { payments: { directBill: 500 } } },
      { date: daysAgo(125), propertyId: "p1", breakdown: { payments: { directBill: 300 } } },
    ];
    const a = arAging({ reports, asOf: ASOF });
    expect(a.totals.current).toBe(200);
    expect(a.totals.b30).toBe(500);
    expect(a.totals.b120).toBe(300);
    expect(a.totals.total).toBe(1000);
  });

  it("skips reports without direct-bill", () => {
    const reports = [
      { date: daysAgo(0),  propertyId: "p1", breakdown: { payments: {} } },
      { date: daysAgo(10), propertyId: "p1", breakdown: { payments: { directBill: 0 } } },
      { date: daysAgo(20), propertyId: "p1", breakdown: { payments: { directBill: 100 } } },
    ];
    const a = arAging({ reports, asOf: ASOF });
    expect(a.totals.total).toBe(100);
  });

  it("AGING_BUCKETS exports a stable shape", () => {
    expect(AGING_BUCKETS.length).toBe(5);
    expect(AGING_BUCKETS[0].id).toBe("current");
  });
});
