import { describe, it, expect, beforeEach } from "vitest";
import { remember, suggest, suggestFromName, suggestForInvoice, clearAll } from "./vendorMemory.js";

beforeEach(() => {
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  clearAll();
});

describe("vendorMemory", () => {
  it("returns null with no history", () => {
    expect(suggest("v1")).toBeNull();
  });

  it("learns coding decisions and increases confidence with repetition", () => {
    remember({ vendorId: "v1", accountCode: "5100" });
    const s1 = suggest("v1");
    expect(s1.accountCode).toBe("5100");
    const c1 = s1.confidence;

    remember({ vendorId: "v1", accountCode: "5100" });
    remember({ vendorId: "v1", accountCode: "5100" });
    const s2 = suggest("v1");
    expect(s2.confidence).toBeGreaterThan(c1);
  });

  it("picks the most-used coding when there are conflicts", () => {
    remember({ vendorId: "v1", accountCode: "5100" });
    remember({ vendorId: "v1", accountCode: "5100" });
    remember({ vendorId: "v1", accountCode: "5100" });
    remember({ vendorId: "v1", accountCode: "5110" });
    expect(suggest("v1").accountCode).toBe("5100");
  });

  it("keyword-matches vendor names to USALI accounts", () => {
    expect(suggestFromName("Sysco Phoenix").accountCode).toBe("5100");
    expect(suggestFromName("Western Linen Co").accountCode).toBe("6210");
    expect(suggestFromName("Verizon Wireless").accountCode).toBe("6500");
    expect(suggestFromName("Random LLC")).toBeNull();
  });

  it("suggestForInvoice prefers history over keyword fallback", () => {
    remember({ vendorId: "v_sysco", accountCode: "9999" }); // user's custom override
    const s = suggestForInvoice({ vendorId: "v_sysco", vendorName: "Sysco Phoenix" });
    expect(s.accountCode).toBe("9999");
  });

  it("suggestForInvoice falls back to keyword rule when no history", () => {
    const s = suggestForInvoice({ vendorId: "v_new", vendorName: "Sysco Phoenix" });
    expect(s.accountCode).toBe("5100");
  });
});
