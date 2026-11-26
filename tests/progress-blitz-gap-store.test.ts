import { describe, expect, it } from "vitest";
import { loadBlitzGap } from "../src/lib/progress/blitz-gap-store";
import { fakeDb } from "./fake-db";

const NOW = new Date("2026-11-26T12:00:00Z");
const games = [
  { id: 1, user_id: "u1", played_at: "2026-11-20T10:00:00Z", time_class: "daily", user_rating: 2100 },
  { id: 2, user_id: "u1", played_at: "2026-11-20T11:00:00Z", time_class: "blitz", user_rating: 1500 },
];

describe("stored Blitz gap", () => {
  it("is read from its one row when the import job has stored it", async () => {
    const stored = { gap: 555, trend: "steady", series: [], daily: { average: 2055, latest: 2055 }, blitz: { average: 1500, latest: 1500 } };
    const { db, log } = fakeDb({ blitz_gaps: [{ user_id: "u1", data: stored }], games, rating_snapshots: [] });
    expect(await loadBlitzGap(db, "u1", NOW)).toEqual(stored);
    expect(log.some((q) => q.table === "games")).toBe(false); // no game ratings read
  });

  it("keeps a stored 'no ratings yet' as null, without working it out again", async () => {
    const { db, log } = fakeDb({ blitz_gaps: [{ user_id: "u1", data: null }], games, rating_snapshots: [] });
    expect(await loadBlitzGap(db, "u1", NOW)).toBeNull();
    expect(log.some((q) => q.table === "games")).toBe(false);
  });

  it("is worked out live before the first import has stored it", async () => {
    const { db } = fakeDb({ blitz_gaps: [], games, rating_snapshots: [] });
    expect(await loadBlitzGap(db, "u1", NOW)).toMatchObject({ gap: 600 });
  });

  it("is worked out live before migration 0008 is applied", async () => {
    const { db } = fakeDb({ games, rating_snapshots: [] }, { failOn: "blitz_gaps" });
    expect(await loadBlitzGap(db, "u1", NOW)).toMatchObject({ gap: 600 });
  });
});
