// notice-push.test.js - run with: deno test supabase/functions/_shared/
import { saHour, isQuietHour, dueNotices, noticesForPerson, buildMessage } from "./notice-push.js";

function assertEquals(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || "assertEquals"}: expected ${expected}, got ${actual}`);
}
const ids = (list) => list.map((n) => n.id).join(",");
// Times below are written in UTC; Cape Town is UTC+2.
const sa = (hhmm, day = "2026-10-27") => new Date(`${day}T${hhmm}:00+02:00`);

Deno.test("Cape Town hour and quiet hours", () => {
  assertEquals(saHour(new Date("2026-10-27T05:05:00Z")), 7, "05:05 UTC is 07:05");
  assertEquals(saHour(new Date("2026-10-27T22:30:00Z")), 0, "22:30 UTC is 00:30 next day");
  assertEquals(isQuietHour(sa("06:05")), true, "06:05 quiet");
  assertEquals(isQuietHour(sa("07:05")), false, "07:05 sends");
  assertEquals(isQuietHour(sa("20:05")), false, "20:05 sends");
  assertEquals(isQuietHour(sa("21:05")), true, "21:05 quiet");
  assertEquals(isQuietHour(sa("00:05")), true, "midnight quiet");
});

Deno.test("daytime run sends everything new", () => {
  const now = sa("10:05");
  const { send, skip } = dueNotices([
    { id: "a", posted_at: sa("09:30").toISOString(), category: "announcement" },
    { id: "b", posted_at: sa("09:59").toISOString(), category: "training", urgent: true },
  ], now);
  assertEquals(ids(send), "a,b", "both");
  assertEquals(skip.length, 0, "none skipped");
});

Deno.test("quiet hours: only urgent goes, the rest waits for 07:05", () => {
  const notices = [
    { id: "normal", posted_at: sa("21:30").toISOString(), category: "announcement" },
    { id: "urgent", posted_at: sa("21:30").toISOString(), category: "training", urgent: true },
  ];
  const night = dueNotices(notices, sa("22:05"));
  assertEquals(ids(night.send), "urgent", "22:05 sends only urgent");
  assertEquals(night.skip.length, 0, "normal is left, not skipped");
  const morning = dueNotices([notices[0]], sa("07:05", "2026-10-28"));
  assertEquals(ids(morning.send), "normal", "07:05 next day sends it");
});

Deno.test("too old, future-dated and yesterday's birthdays", () => {
  const now = sa("10:05");
  const { send, skip } = dueNotices([
    { id: "old", posted_at: sa("09:00", "2026-10-25").toISOString(), category: "announcement" },
    { id: "future", posted_at: sa("12:00").toISOString(), category: "announcement" },
    { id: "bday-today", posted_at: sa("07:00").toISOString(), category: "birthday" },
    { id: "bday-yday", posted_at: sa("23:30", "2026-10-26").toISOString(), category: "birthday" },
  ], now);
  assertEquals(ids(send), "bday-today", "only today's birthday");
  assertEquals(ids(skip), "old,bday-yday", "old ones marked handled");
});

Deno.test("who hears about what - same as the notice board", () => {
  const notices = [
    { id: "all", category: "announcement" },
    { id: "u12", category: "announcement", target_age_groups: ["U12"] },
    { id: "u9", category: "announcement", target_age_group: "U9" },
    { id: "sup", category: "announcement", show_to_supporters: true },
    { id: "bday", category: "birthday", target_age_groups: ["U12"], show_to_supporters: true },
  ];
  assertEquals(ids(noticesForPerson({ ageGroups: ["u12"] }, notices)), "all,u12,sup,bday", "U12 guardian");
  assertEquals(ids(noticesForPerson({ ageGroups: ["u9", "u12"] }, notices)), "all,u12,u9,sup,bday", "two children");
  assertEquals(ids(noticesForPerson({ ageGroups: [], supporter: true }, notices)), "sup", "supporter: marked, no birthdays");
  assertEquals(ids(noticesForPerson({ ageGroups: [], supporter: false }, notices)), "", "pending/unknown: nothing");
  assertEquals(ids(noticesForPerson({ ageGroups: ["u12"], supporter: true }, notices)), "all,u12,sup,bday", "guardian rules win");
});

Deno.test("one notice: its own title and a short preview", () => {
  const { message, urgent } = buildMessage([{ title: "Kit collection", body: "Collect   kit\nat the clubhouse on Saturday.", posted_at: "x" }]);
  assertEquals(message.title, "Kit collection", "title");
  assertEquals(message.body, "Collect kit at the clubhouse on Saturday.", "whitespace tidied");
  assertEquals(message.url, "notices.html", "opens notices");
  assertEquals(urgent, false, "normal");
});

Deno.test("several notices: one notification, urgent first", () => {
  const { message, urgent } = buildMessage([
    { title: "Kit collection", body: "", posted_at: "2026-10-27T08:00:00Z" },
    { title: "Training cancelled", body: "", posted_at: "2026-10-27T07:00:00Z", urgent: true },
    { title: "AGM date", body: "", posted_at: "2026-10-27T09:00:00Z" },
  ]);
  assertEquals(message.title, "3 new club notices", "count");
  assertEquals(message.body, "Urgent: Training cancelled · AGM date · Kit collection", "urgent first, then newest");
  assertEquals(urgent, true, "sent as high priority");
});

Deno.test("long text is trimmed to fit a lock screen", () => {
  const { message } = buildMessage([{ title: "T".repeat(200), body: "B".repeat(500), posted_at: "x" }]);
  assertEquals(message.title.length, 80, "title");
  assertEquals(message.body.length, 140, "body");
  assertEquals(message.body.endsWith("…"), true, "ellipsis");
  assertEquals(buildMessage([]), null, "nothing to say");
});
