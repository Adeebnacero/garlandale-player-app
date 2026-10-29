// calendar.test.js - run with: deno test supabase/functions/_shared/
import { parseRange, repeatText, shapeEvent, shapeFixture, shapeMatch, sortCalendarItems } from "./calendar.js";

function assertEquals(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || "assertEquals"}: expected ${e}, got ${a}`);
}

Deno.test("date range defaults to the current year", () => {
  assertEquals(parseRange(null, null, "2026-10-11"), { ok: true, from: "2026-01-01", to: "2026-12-31" }, "default");
  assertEquals(parseRange("2026-01-01", "2026-12-31", "2026-10-11").ok, true, "a whole year");
});

Deno.test("date range rejects bad input", () => {
  assertEquals(parseRange("2026-02-30", "2026-03-01", "2026-10-11").ok, false, "not a real date");
  assertEquals(parseRange("2026-05-01", "2026-04-01", "2026-10-11").ok, false, "backwards");
  assertEquals(parseRange("2026-01-01", "2027-06-01", "2026-10-11").ok, false, "too long");
  assertEquals(parseRange("x';drop", "2026-01-01", "2026-10-11").ok, false, "junk");
});

Deno.test("repeat text", () => {
  assertEquals(repeatText("weekly", "2026-12-08"), "Every week until 8 Dec 2026", "weekly");
  assertEquals(repeatText("monthly", "2027-01-31"), "Every month until 31 Jan 2027", "monthly");
  assertEquals(repeatText("daily", "2026-12-08"), "", "unknown rule");
});

Deno.test("events are shaped for the Player Portal", () => {
  const e = shapeEvent({ id: "1", category_id: "c", title: "Junior training", event_date: "2026-10-13", all_day: false, start_time: "17:30:00", end_time: "19:00:00", venue: "Home ground", series_id: "s", repeat_rule: "weekly", repeat_until: "2026-12-08" });
  assertEquals([e.id, e.start, e.end, e.all_day, e.repeat_text], ["event:1", "17:30", "19:00", false, "Every week until 8 Dec 2026"], "timed series event");
  const a = shapeEvent({ id: "2", category_id: "c", title: "Tournament", event_date: "2026-11-28", all_day: true, start_time: null, series_id: null });
  assertEquals([a.all_day, a.start, a.repeat_text], [true, "", ""], "all-day one-off");
});

Deno.test("fixtures and Matchday-only matches get titles", () => {
  assertEquals(shapeFixture({ id: "f", squad_age_group: "U12", opponent: "Northside", home_away: "H", match_date: "2026-10-17", kickoff_time: "09:00:00" }).title, "U12 vs Northside", "home");
  const m = shapeMatch({ id: "m", age_group: "Seniors", opponent: "Rovers", home_away: "A", match_date: "2026-10-20", kickoff_time: null, competition: "Friendly" });
  assertEquals([m.id, m.title, m.all_day, m.description], ["match:m", "Seniors @ Rovers", true, "Friendly"], "away friendly");
});

Deno.test("items sort by date, all-day first, then time", () => {
  const s = sortCalendarItems([
    { date: "2026-10-17", start: "15:00", all_day: false, title: "B" },
    { date: "2026-10-17", start: "", all_day: true, title: "A" },
    { date: "2026-10-16", start: "18:00", all_day: false, title: "C" },
  ]);
  assertEquals(s.map((x) => x.title), ["C", "A", "B"], "order");
});
