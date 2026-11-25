import { describe, expect, it } from "vitest";
import { withRetry } from "../scripts/lib/retry";

const noSleep = async () => {};

describe("withRetry", () => {
  it("returns at once when the step works", async () => {
    let calls = 0;
    expect(await withRetry(async () => ++calls, { sleep: noSleep })).toBe(1);
    expect(calls).toBe(1);
  });

  it("tries again after a brief failure, waiting longer each time", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await withRetry(async () => {
      if (++calls < 3) throw new Error("Internal server error.");
      return "saved";
    }, { delaysMs: [1, 5, 9], sleep: async (ms) => { waits.push(ms); } });
    expect(result).toBe("saved");
    expect(waits).toEqual([1, 5]);
  });

  it("gives up with the last error after the last attempt", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error(`fail ${calls}`); }, { attempts: 3, sleep: noSleep }))
      .rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });
});
