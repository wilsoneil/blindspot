import { describe, expect, it } from "vitest";
import { backfillDates, trendOf } from "../src/lib/progress/weakness-trend";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 12);
const row = (daysAgo: number, perGame: number) => ({ t: NOW - daysAgo * DAY, perGame });

describe("weakness trend", () => {
  it("backfills weekly from four weeks after the first game", () => {
    const dates = backfillDates(NOW - 100 * DAY, NOW);
    expect(dates[0]).toBe(NOW - 72 * DAY);
    expect(dates[1] - dates[0]).toBe(7 * DAY);
    expect(dates.at(-1)!).toBeLessThan(NOW - DAY);
    expect(backfillDates(NOW - 20 * DAY, NOW)).toEqual([]);
  });

  it("compares today with about a month ago", () => {
    const t = trendOf([row(60, 0.05), row(35, 0.04), row(10, 0.035), row(0, 0.03)], NOW)!;
    expect(t).toMatchObject({ now: 0.03, then: 0.04, direction: "falling" });
    expect(t.points.map((p) => p.v)).toEqual([0.05, 0.04, 0.035, 0.03]);
  });

  it("calls small changes steady, and has no direction without a month of history", () => {
    expect(trendOf([row(31, 0.04), row(0, 0.038)], NOW)!.direction).toBe("steady");
    expect(trendOf([row(31, 0.04), row(0, 0.05)], NOW)!.direction).toBe("rising");
    expect(trendOf([row(5, 0.04), row(0, 0.03)], NOW)).toMatchObject({ then: null, direction: null });
    expect(trendOf([], NOW)).toBeNull();
  });
});
