import { describe, expect, it } from "vitest";
import { change, chartSeries, dailyLast, windowed } from "../src/lib/progress/series";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 12);
const at = (daysAgo: number, v: number) => ({ t: NOW - daysAgo * DAY, v });

describe("progress series", () => {
  const points = [at(60, 1450), at(40, 1500), at(20, 1550), at(10, 1530), at(3, 1580), at(1, 1600)];

  it("keeps a range's points, starting from the value carried in", () => {
    expect(windowed(points, "week", NOW)).toEqual([{ t: NOW - 7 * DAY, v: 1530 }, at(3, 1580), at(1, 1600)]);
    expect(windowed(points, "all", NOW)).toEqual(points);
  });

  it("has no carried-in point before the first one", () => {
    expect(windowed([at(2, 1500), at(1, 1520)], "month", NOW)).toEqual([at(2, 1500), at(1, 1520)]);
  });

  it("keeps each day's last value", () => {
    const sameDay = [{ t: NOW, v: 1 }, { t: NOW + 1000, v: 2 }, { t: NOW + DAY, v: 3 }];
    expect(dailyLast(sameDay)).toEqual([{ t: NOW + 1000, v: 2 }, { t: NOW + DAY, v: 3 }]);
  });

  it("works out the change over a range", () => {
    const s = chartSeries(points, NOW);
    expect(change(s.week)).toBe(70); // 1530 at the start of the week -> 1600
    expect(change(s.month)).toBe(100); // 1500 carried in at the start of the month -> 1600
    expect(change(s.all)).toBe(150); // 1450 -> 1600
    expect(change([at(1, 1500)])).toBeNull();
  });
});
