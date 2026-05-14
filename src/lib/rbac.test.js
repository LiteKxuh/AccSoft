import { describe, it, expect } from "vitest";
import { can, scope, approveLimit, listRoles, actionsFor, ROLES, ACTIONS } from "./rbac.js";

describe("can()", () => {
  it("grants when role has the action", () => {
    expect(can("gm", "period.close")).toBe(true);
    expect(can("controller", "chart.edit")).toBe(true);
  });

  it("denies actions the role doesn't have", () => {
    expect(can("front-desk", "period.close")).toBe(false);
    expect(can("accounting-clerk", "je.approve")).toBe(false);
  });

  it("denies for unknown role", () => {
    expect(can("nope", "report.view")).toBe(false);
  });

  it("respects approval limits on je.approve", () => {
    // AGM has $5000 limit
    expect(can("agm", "je.approve", { amount: 1000 })).toBe(true);
    expect(can("agm", "je.approve", { amount: 9000 })).toBe(false);
    // GM has $25k limit
    expect(can("gm", "je.approve", { amount: 24_000 })).toBe(true);
    expect(can("gm", "je.approve", { amount: 50_000 })).toBe(false);
    // Controller has $250k
    expect(can("controller", "je.approve", { amount: 200_000 })).toBe(true);
  });

  it("respects scope hierarchy: portfolio > region > property", () => {
    // GM is property-scoped
    expect(can("gm", "report.view", { scope: "property" })).toBe(true);
    expect(can("gm", "report.view", { scope: "region" })).toBe(false);
    // Regional controller covers region + property scope queries
    expect(can("regional-controller", "report.view", { scope: "region" })).toBe(true);
    expect(can("regional-controller", "report.view", { scope: "property" })).toBe(true);
    // Controller portfolio
    expect(can("controller", "report.view", { scope: "portfolio" })).toBe(true);
  });
});

describe("scope() + approveLimit()", () => {
  it("returns the scope tier", () => {
    expect(scope("front-desk")).toBe("property");
    expect(scope("controller")).toBe("portfolio");
    expect(scope("regional-controller")).toBe("region");
  });

  it("returns 0 for roles without approval rights", () => {
    expect(approveLimit("front-desk")).toBe(0);
    expect(approveLimit("accounting-clerk")).toBe(0);
  });

  it("returns Infinity for ownership", () => {
    expect(approveLimit("ownership")).toBe(Infinity);
  });
});

describe("listRoles()", () => {
  it("returns all roles with action counts", () => {
    const roles = listRoles();
    expect(roles.length).toBeGreaterThanOrEqual(8);
    for (const r of roles) {
      expect(r.actionCount).toBeGreaterThan(0);
    }
  });
});

describe("actionsFor()", () => {
  it("returns the explicit action list", () => {
    const actions = actionsFor("revenue-manager");
    expect(actions).toContain("forecast.view");
    expect(actions).not.toContain("payroll.run");
  });
});

describe("role design — owner-statement is gated", () => {
  it("only controller / regional / ownership can view owner statements", () => {
    expect(can("controller", "owner.statement.view")).toBe(true);
    expect(can("regional-controller", "owner.statement.view")).toBe(true);
    expect(can("ownership", "owner.statement.view")).toBe(true);
    expect(can("gm", "owner.statement.view")).toBe(false);
    expect(can("front-desk", "owner.statement.view")).toBe(false);
  });
});

describe("role design — ledger-chain visibility", () => {
  it("auditors and senior roles can view the ledger chain", () => {
    expect(can("controller", "je.view-chain")).toBe(true);
    expect(can("regional-controller", "je.view-chain")).toBe(true);
    expect(can("gm", "je.view-chain")).toBe(true);
    expect(can("night-auditor", "je.view-chain")).toBe(true);
    expect(can("ownership", "je.view-chain")).toBe(true);
    // Pure clerical roles don't get the chain
    expect(can("accounting-clerk", "je.view-chain")).toBe(false);
    expect(can("front-desk", "je.view-chain")).toBe(false);
  });
});

describe("ACTIONS catalog", () => {
  it("documents every action key", () => {
    const keys = new Set();
    for (const def of Object.values(ROLES)) for (const a of def.actions) keys.add(a);
    for (const a of keys) {
      expect(ACTIONS).toHaveProperty(a);
    }
  });
});
