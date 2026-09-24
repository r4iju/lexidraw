/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { timeAgo } from "./time-ago";

const now = new Date(2026, 8, 24, 15, 0, 0);
const before = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("timeAgo", () => {
  test("says just now for the last minute, and for a clock a little ahead", () => {
    expect(timeAgo(before(20_000), now)).toBe("Just now");
    expect(timeAgo(new Date(now.getTime() + 5_000), now)).toBe("Just now");
  });

  test("counts minutes, then hours, in one short line", () => {
    expect(timeAgo(before(9 * MIN), now)).toBe("9 min ago");
    expect(timeAgo(before(59 * MIN), now)).toBe("59 min ago");
    expect(timeAgo(before(HOUR), now)).toBe("1 hour ago");
    expect(timeAgo(before(5 * HOUR + 10 * MIN), now)).toBe("5 hours ago");
  });

  test("says yesterday, then days, for the last week", () => {
    expect(timeAgo(before(DAY + HOUR), now)).toBe("Yesterday");
    expect(timeAgo(before(3 * DAY), now)).toBe("3 days ago");
  });

  test("gives the date past a week, with the year only when it differs", () => {
    expect(timeAgo(new Date(2026, 8, 2, 9, 0), now)).toBe("2 Sep");
    expect(timeAgo(new Date(2025, 11, 31, 9, 0), now)).toBe("31 Dec 2025");
  });
});
