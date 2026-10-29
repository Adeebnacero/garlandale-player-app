import { describe, it, expect } from "vitest";
import { nextPushTime, whenLabel, isQuietHour } from "./pushTiming.js";

// Cape Town = UTC+2
const sa = (s) => new Date(`${s}+02:00`);
const label = (s, urgent = false) => whenLabel(nextPushTime(sa(s), urgent), sa(s));

describe("nextPushTime", () => {
  it("daytime: the next five past", () => {
    expect(label("2026-10-28T10:02:00")).toBe("at 10:05");
    expect(label("2026-10-28T10:05:00")).toBe("at 11:05");
    expect(label("2026-10-28T10:59:00")).toBe("at 11:05");
  });
  it("evening: 20:xx still goes at 21:05 only if urgent", () => {
    expect(label("2026-10-28T20:30:00")).toBe("tomorrow at 07:05");
    expect(label("2026-10-28T20:30:00", true)).toBe("at 21:05");
    expect(label("2026-10-28T20:04:00")).toBe("at 20:05");
  });
  it("quiet hours: normal waits for the morning, urgent goes next hour", () => {
    expect(label("2026-10-28T22:10:00")).toBe("tomorrow at 07:05");
    expect(label("2026-10-28T22:10:00", true)).toBe("at 23:05");
    expect(label("2026-10-28T23:30:00", true)).toBe("tomorrow at 00:05");
    expect(label("2026-10-29T03:00:00")).toBe("at 07:05");
    expect(label("2026-10-29T06:30:00")).toBe("at 07:05");
  });
  it("quiet hours are 21:00 to 07:00", () => {
    expect(isQuietHour(sa("2026-10-28T20:59:00"))).toBe(false);
    expect(isQuietHour(sa("2026-10-28T21:00:00"))).toBe(true);
    expect(isQuietHour(sa("2026-10-29T06:59:00"))).toBe(true);
    expect(isQuietHour(sa("2026-10-29T07:00:00"))).toBe(false);
  });
});
