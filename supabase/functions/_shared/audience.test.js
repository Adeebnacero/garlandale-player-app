// audience.test.js - run with: deno test supabase/functions/_shared/
import { audienceGroups, isForAgeGroup } from "./audience.js";
function assertEquals(a, e, m) { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); }

Deno.test("reads the new list and the old single value", () => {
  assertEquals(audienceGroups({ target_age_groups: ["U7", " U8 "] }), ["u7", "u8"], "list");
  assertEquals(audienceGroups({ target_age_groups: [], target_age_group: "U12" }), ["u12"], "old value");
  assertEquals(audienceGroups({ target_age_group: "ALL" }), [], "old ALL = everyone");
  assertEquals(audienceGroups({ target_age_groups: [], target_age_group: null }), [], "everyone");
});

Deno.test("matches any chosen group", () => {
  const row = { target_age_groups: ["U7", "U8", "U9"] };
  assertEquals([isForAgeGroup(row, "u7"), isForAgeGroup(row, "U9"), isForAgeGroup(row, "u12")], [true, true, false], "U7-U9");
  assertEquals(isForAgeGroup({ target_age_groups: [] }, "u12"), true, "everyone");
});
