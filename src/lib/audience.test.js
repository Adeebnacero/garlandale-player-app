import { describe, it, expect } from "vitest";
import { groupsFromRow, cleanGroups, audienceLabel, audienceColumns } from "./audience.js";

describe("audience", () => {
  it("reads the new list or the old value", () => {
    expect(groupsFromRow({ target_age_groups: ["U9", "U7"] })).toEqual(["U7", "U9"]);
    expect(groupsFromRow({ target_age_groups: [], target_age_group: "U12" })).toEqual(["U12"]);
    expect(groupsFromRow({ target_age_group: "ALL" })).toEqual([]);
    expect(groupsFromRow({})).toEqual([]);
  });
  it("cleans and orders", () => {
    expect(cleanGroups([" U10", "U7", "u7", "ALL", "", "Seniors", "U8"])).toEqual(["U7", "U8", "U10", "Seniors"]);
  });
  it("labels and builds columns", () => {
    expect(audienceLabel([])).toBe("Everyone");
    expect(audienceLabel(["U7", "U8"])).toBe("U7, U8");
    expect(audienceColumns(["U8", "U7"])).toEqual({ target_age_groups: ["U7", "U8"], target_age_group: "U7" });
    expect(audienceColumns([], "ALL")).toEqual({ target_age_groups: [], target_age_group: "ALL" });
    expect(audienceColumns([])).toEqual({ target_age_groups: [], target_age_group: null });
  });
});
