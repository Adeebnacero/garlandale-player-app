// dates.test.js - run with: deno test supabase/functions/_shared/
import { saDate, isCurrentNotice } from "./dates.js";

function assertEquals(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || "assertEquals"}: expected ${expected}, got ${actual}`);
}

Deno.test("South African date", () => {
  assertEquals(saDate(new Date("2026-09-25T21:59:00Z")), "2026-09-25", "23:59 SA");
  assertEquals(saDate(new Date("2026-09-25T22:00:00Z")), "2026-09-26", "00:00 SA is the next day");
  assertEquals(saDate("2026-09-26T05:00:00Z"), "2026-09-26", "ISO string");
});

Deno.test("birthday notices are for their day only", () => {
  const today = "2026-09-26";
  assertEquals(isCurrentNotice({ category: "birthday", posted_at: "2026-09-26T05:00:00Z" }, today), true, "posted 07:00 today");
  assertEquals(isCurrentNotice({ category: "birthday", posted_at: "2026-09-25T05:00:00Z" }, today), false, "yesterday's");
  assertEquals(isCurrentNotice({ category: "birthday", posted_at: "2026-09-25T22:30:00Z" }, today), true, "posted 00:30 SA today (UTC still yesterday)");
  assertEquals(isCurrentNotice({ category: "birthday" }, today), false, "no date");
  assertEquals(isCurrentNotice({ category: "announcement", posted_at: "2026-01-01T00:00:00Z" }, today), true, "other notices never expire here");
  assertEquals(isCurrentNotice({ category: "training", posted_at: "2026-01-01T00:00:00Z" }, today), true, "training");
});
