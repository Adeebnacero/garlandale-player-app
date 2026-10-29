import { describe, it, expect } from "vitest";
import { humanizeFieldName, diffFields } from "./auditLog.js";

describe("humanizeFieldName", () => {
  it("converts snake_case to a readable label", () => {
    expect(humanizeFieldName("monthly_fee")).toBe("Monthly fee");
    expect(humanizeFieldName("low_stock_threshold")).toBe("Low stock threshold");
  });

  it("handles a single word", () => {
    expect(humanizeFieldName("amount")).toBe("Amount");
  });
});

describe("diffFields", () => {
  it("only returns fields that actually changed", () => {
    const oldData = { id: "x", amount: 300, method: "EFT" };
    const newData = { id: "x", amount: 350, method: "EFT" };
    const diff = diffFields(oldData, newData);
    expect(diff).toEqual([{ key: "amount", field: "Amount", oldValue: 300, newValue: 350 }]);
  });

  it("ignores id and timestamp fields even if present", () => {
    const oldData = { id: "x", amount: 300, created_at: "2026-01-01" };
    const newData = { id: "y", amount: 300, created_at: "2026-06-01" };
    expect(diffFields(oldData, newData)).toEqual([]);
  });

  it("shows every field as added for an INSERT (no old data)", () => {
    const diff = diffFields(null, { id: "x", name: "Chips", quantity: 10 });
    expect(diff).toContainEqual({ key: "name", field: "Name", oldValue: null, newValue: "Chips" });
    expect(diff).toContainEqual({ key: "quantity", field: "Quantity", oldValue: null, newValue: 10 });
  });

  it("shows every field as removed for a DELETE (no new data)", () => {
    const diff = diffFields({ id: "x", name: "Chips", quantity: 10 }, null);
    expect(diff).toContainEqual({ key: "name", field: "Name", oldValue: "Chips", newValue: null });
    expect(diff).toContainEqual({ key: "quantity", field: "Quantity", oldValue: 10, newValue: null });
  });

  it("returns nothing when nothing changed", () => {
    expect(diffFields({ id: "x", amount: 300 }, { id: "x", amount: 300 })).toEqual([]);
  });

  it("doesn't falsely flag a change when a value round-trips through JSON as a different type", () => {
    // jsonb round-trips can turn a number into a numeric string, etc. -
    // comparing as strings avoids a false "changed" for the same value.
    expect(diffFields({ id: "x", amount: 300 }, { id: "x", amount: "300" })).toEqual([]);
  });
});
