import { describe, it, expect } from "vitest";
import {
  occurrences, repeatLabel, monthGrid, weekDates, periodLabel, shiftCursor, sortItems,
  fixtureItems, eventFormError, blankEventForm, noticeText, categoryFor, categoryNameError,
  isDateKey, addDays, mondayOf, timeLabel, MAX_OCCURRENCES,
} from "./calendar.js";

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds the Monday of a week (weeks start on Monday)", () => {
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(mondayOf("2026-10-12")).toBe("2026-10-12"); // Monday
  });
  it("only accepts real dates", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("")).toBe(false);
  });
});

describe("occurrences", () => {
  it("repeats weekly up to and including the until date", () => {
    expect(occurrences("2026-10-06", "weekly", "2026-10-27")).toEqual(["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
  });
  it("repeats every 2 weeks", () => {
    expect(occurrences("2026-10-06", "fortnightly", "2026-11-03")).toEqual(["2026-10-06", "2026-10-20", "2026-11-03"]);
  });
  it("skips months that don't have the day for monthly repeats", () => {
    expect(occurrences("2026-01-31", "monthly", "2026-05-31")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });
  it("returns just the first date when not repeating or until is too early", () => {
    expect(occurrences("2026-10-06", "none", "2026-12-01")).toEqual(["2026-10-06"]);
    expect(occurrences("2026-10-06", "weekly", "2026-10-06")).toEqual(["2026-10-06"]);
  });
  it("never creates more than the limit", () => {
    expect(occurrences("2026-01-01", "weekly", "2030-01-01").length).toBe(MAX_OCCURRENCES);
  });
  it("labels a repeat", () => {
    expect(repeatLabel("weekly", "2026-12-08")).toBe("Every week until 8 Dec 2026");
    expect(repeatLabel("none", "2026-12-08")).toBe("");
  });
});

describe("views", () => {
  it("builds whole Monday-first weeks for a month", () => {
    const g = monthGrid("2026-10-11");
    expect(g[0]).toBe("2026-09-28");
    expect(g.length % 7).toBe(0);
    expect(g).toContain("2026-10-31");
    expect(g[g.length - 1]).toBe("2026-11-01");
  });
  it("lists a week Monday to Sunday", () => {
    expect(weekDates("2026-10-15")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });
  it("labels and moves periods", () => {
    expect(periodLabel("month", "2026-10-11")).toBe("October 2026");
    expect(periodLabel("week", "2026-10-11")).toBe("5 Oct – 11 Oct 2026");
    expect(periodLabel("year", "2026-10-11")).toBe("2026");
    expect(shiftCursor("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftCursor("week", "2026-10-11", -1)).toBe("2026-10-04");
    expect(shiftCursor("year", "2026-10-11", 1)).toBe("2027-10-01");
  });
  it("sorts all-day items before timed ones on the same day", () => {
    const s = sortItems([
      { date: "2026-10-17", start: "15:00", title: "B" },
      { date: "2026-10-17", allDay: true, title: "A" },
      { date: "2026-10-16", start: "18:00", title: "C" },
    ]);
    expect(s.map((x) => x.title)).toEqual(["C", "A", "B"]);
  });
  it("labels times", () => {
    expect(timeLabel({ allDay: true })).toBe("All day");
    expect(timeLabel({ start: "17:30", end: "19:00" })).toBe("17:30 – 19:00");
    expect(timeLabel({ start: "09:00", end: "" })).toBe("09:00");
  });
});

describe("fixtureItems", () => {
  it("includes every fixture plus Matchday entries not made from a fixture", () => {
    const items = fixtureItems(
      [{ id: "f1", squadAgeGroup: "U12", opponent: "Northside", matchDate: "2026-10-17", kickoffTime: "09:00:00", homeAway: "H", venue: "Home" }],
      [
        { id: "m1", fixtureId: "f1", opponent: "Northside", matchDate: "2026-10-17" },
        { id: "m2", fixtureId: "", ageGroup: "Seniors", opponent: "Rovers", matchDate: "2026-10-20", kickoffTime: "", homeAway: "A" },
      ],
    );
    expect(items.map((i) => i.id)).toEqual(["fixture:f1", "match:m2"]);
    expect(items[0].title).toBe("U12 vs Northside");
    expect(items[0].start).toBe("09:00");
    expect(items[1].title).toBe("Seniors @ Rovers");
    expect(items[1].allDay).toBe(true);
  });
});

describe("categories", () => {
  const cats = [
    { id: "a", name: "Training", isSystem: null },
    { id: "o", name: "Other", isSystem: "other" },
    { id: "f", name: "Fixture", isSystem: "fixture" },
  ];
  it("falls back to Other for a missing category", () => {
    expect(categoryFor(cats, "zzz").id).toBe("o");
  });
  it("checks names", () => {
    expect(categoryNameError("  ", cats, "x")).toMatch(/name/);
    expect(categoryNameError("training", cats, "x")).toMatch(/already/);
    expect(categoryNameError("Training", cats, "a")).toBe("");
  });
  it("starts a new event in the first ordinary category", () => {
    expect(blankEventForm("2026-10-11", cats).categoryId).toBe("a");
  });
});

describe("eventFormError", () => {
  const base = { ...blankEventForm("2026-10-11", [{ id: "a" }]), title: "Committee meeting" };
  it("accepts a valid event", () => {
    expect(eventFormError(base)).toBe("");
  });
  it("needs a title and an end after the start", () => {
    expect(eventFormError({ ...base, title: " " })).toMatch(/title/);
    expect(eventFormError({ ...base, start: "19:00", end: "18:00" })).toMatch(/after the start/);
  });
  it("ignores times for all-day events", () => {
    expect(eventFormError({ ...base, allDay: true, start: "", end: "" })).toBe("");
  });
  it("checks the until date of a new repeating event", () => {
    expect(eventFormError({ ...base, repeatRule: "weekly", repeatUntil: "" })).toMatch(/Until/);
    expect(eventFormError({ ...base, repeatRule: "weekly", repeatUntil: "2026-12-01" })).toBe("");
    expect(eventFormError({ ...base, repeatRule: "weekly", repeatUntil: "2030-12-01" })).toMatch(/more than/);
  });
});

describe("noticeText", () => {
  const ev = { title: "Family fun day", date: "2026-10-25", start: "11:00", end: "15:00", venue: "Home ground", description: "Everyone welcome." };
  it("writes a new-event notice", () => {
    const n = noticeText("new", ev);
    expect(n.title).toBe("New event: Family fun day");
    expect(n.body).toContain("Sunday, 25 October 2026, 11:00 – 15:00 at Home ground.");
    expect(n.body).toContain("Everyone welcome.");
    expect(n.body).toContain("Club calendar");
  });
  it("mentions the repeat for a new series", () => {
    const n = noticeText("new", ev, { series: { rule: "weekly", until: "2026-11-15", fromDate: ev.date, count: 4 } });
    expect(n.body).toContain("Every week until 15 Nov 2026 (4 dates).");
  });
  it("writes a cancellation", () => {
    expect(noticeText("cancel", ev).body).toContain("Family fun day on Sunday, 25 October 2026 is cancelled.");
    expect(noticeText("cancel", ev, { series: { rule: "weekly", until: "2026-12-01", fromDate: "2026-11-01" } }).body)
      .toBe("Family fun day (every week until 1 Dec 2026) is cancelled from Sunday, 1 November 2026 onwards.\n\nSee the Club calendar for details.");
  });
});
