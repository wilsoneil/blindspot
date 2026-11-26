import { describe, expect, it } from "vitest";
import { blitzGap, type RatingSample } from "../src/lib/progress/blitz-gap";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 18);
const s = (timeClass: "blitz" | "daily", daysAgo: number, rating: number): RatingSample =>
  ({ timeClass, t: NOW - daysAgo * DAY, rating });

describe("blitz gap", () => {
  it("is null until both ratings are known", () => {
    expect(blitzGap([], NOW)).toBeNull();
    expect(blitzGap([s("blitz", 3, 1500)], NOW)).toBeNull();
  });

  it("is daily minus blitz, carried forward over days without games", () => {
    const g = blitzGap([s("daily", 5, 2100), s("blitz", 5, 1500)], NOW)!;
    expect(g).toMatchObject({ gap: 600, trend: "steady", daily: { average: 2100, latest: 2100 }, blitz: { average: 1500 } });
    expect(g.series).toHaveLength(6); // five days ago to today
  });

  it("smooths over 30 days, so one bad day barely moves it", () => {
    const steady = Array.from({ length: 40 }, (_, i) => s("blitz", 40 - i, 1500));
    const g = blitzGap([s("daily", 45, 2100), ...steady, s("blitz", 0, 1350)], NOW)!;
    expect(g.blitz.latest).toBe(1350);
    expect(g.blitz.average).toBe(1495); // (29 × 1500 + 1350) / 30
    expect(g.gap).toBe(605);
  });

  it("takes each day's last rating", () => {
    const g = blitzGap([s("daily", 1, 2000), s("blitz", 0.6, 1400), s("blitz", 0.1, 1420)], NOW)!;
    expect(g.blitz.latest).toBe(1420);
  });

  it("is falling when the gap closes over the last 30 days", () => {
    const climbing = Array.from({ length: 60 }, (_, i) => s("blitz", 60 - i, 1400 + 2 * i));
    const g = blitzGap([s("daily", 61, 2100), ...climbing], NOW)!;
    expect(g.trend).toBe("falling");
    const dropping = Array.from({ length: 60 }, (_, i) => s("blitz", 60 - i, 1600 - 2 * i));
    expect(blitzGap([s("daily", 61, 2100), ...dropping], NOW)!.trend).toBe("rising");
  });
});

describe("blitz gap chart", () => {
  it("includes today in the chart", async () => {
    const { chartSeries } = await import("../src/lib/progress/series");
    const g = blitzGap([s("daily", 3, 2100), s("blitz", 3, 1500), s("blitz", 0, 1530)], NOW)!;
    expect(chartSeries(g.series, NOW).week.at(-1)!.v).toBe(g.gap);
  });
});
