// my-messages.test.js - run with: deno test supabase/functions/_shared/
import { shapeMessages, cleanIds, MAX_MESSAGES } from "./my-messages.js";

function assertEquals(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || "assertEquals"}: expected ${expected}, got ${actual}`);
}
const A = "11111111-0000-0000-0000-000000000001";
const B = "11111111-0000-0000-0000-000000000002";

Deno.test("messages come out newest first with the child's first name", () => {
  const out = shapeMessages([
    { id: "m1", player_id: A, body: "Older", created_at: "2026-10-27T08:00:00Z", read_at: "2026-10-27T09:00:00Z" },
    { id: "m2", player_id: B, body: "Newer", created_at: "2026-10-28T08:00:00Z", read_at: null },
  ], [{ id: A, name: "Thabo Nkosi" }, { id: B, name: "Aisha" }]);
  assertEquals(out.map((m) => m.id).join(","), "m2,m1", "order");
  assertEquals(out[0].playerName, "Aisha", "name");
  assertEquals(out[1].playerName, "Thabo", "first name only");
  assertEquals(out[0].read, false, "unread");
  assertEquals(out[1].read, true, "read");
});

Deno.test("mark-read ids: only real ids, no repeats, capped", () => {
  assertEquals(cleanIds([A, A, B]).length, 2, "dedupes");
  assertEquals(cleanIds([A, "nope", 5, null]).join(), A, "drops junk");
  assertEquals(cleanIds([]), null, "empty");
  assertEquals(cleanIds("x"), null, "not a list");
  assertEquals(cleanIds(Array.from({ length: MAX_MESSAGES + 1 }, () => crypto.randomUUID())), null, "too many");
});
