import { describe, it, expect, beforeEach } from "vitest";
import { listViews, saveView, touchView, deleteView, getView } from "./savedViews.js";

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  } else {
    // jsdom-free fallback
    global.localStorage = global.localStorage || {
      _: {},
      getItem(k) { return this._[k] || null; },
      setItem(k, v) { this._[k] = v; },
      removeItem(k) { delete this._[k]; },
      clear() { this._ = {}; },
    };
    global.window = { localStorage: global.localStorage };
    global.localStorage.clear();
  }
});

describe("savedViews", () => {
  it("starts empty per pane", () => {
    expect(listViews("ap")).toEqual([]);
  });

  it("saves a view and lists it back", () => {
    saveView("ap", "Open · Sysco", { vendorId: "v1", status: "open" });
    const views = listViews("ap");
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("Open · Sysco");
    expect(views[0].filters.status).toBe("open");
  });

  it("replaces same-named view rather than duplicating", () => {
    saveView("ap", "Recent", { range: "30d" });
    saveView("ap", "Recent", { range: "60d" });
    const views = listViews("ap");
    expect(views).toHaveLength(1);
    expect(views[0].filters.range).toBe("60d");
  });

  it("orders by most recently used", () => {
    const a = saveView("ap", "Alpha", {});
    const b = saveView("ap", "Bravo", {});
    touchView("ap", a.id);
    const views = listViews("ap");
    expect(views[0].name).toBe("Alpha");
    expect(views[1].name).toBe("Bravo");
  });

  it("deletes a view", () => {
    const v = saveView("ap", "Drop me", {});
    deleteView("ap", v.id);
    expect(listViews("ap")).toEqual([]);
  });

  it("namespaces by pane", () => {
    saveView("ap", "X", {});
    saveView("schedule", "Y", {});
    expect(listViews("ap")).toHaveLength(1);
    expect(listViews("schedule")).toHaveLength(1);
  });

  it("getView returns by id", () => {
    const v = saveView("ap", "Find me", { foo: 1 });
    expect(getView("ap", v.id).filters.foo).toBe(1);
  });
});
