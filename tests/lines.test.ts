import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isZstd, readLines } from "../src/lib/lines";

async function* chunks(...parts: Uint8Array[]) {
  for (const p of parts) yield p;
}
async function collect(source: AsyncIterable<Uint8Array>) {
  const out: string[] = [];
  for await (const line of readLines(source)) out.push(line);
  return out;
}
const text = "PuzzleId,FEN\nabc,8/8\r\ndéf,8/8\nlast";

describe("readLines", () => {
  it("reads plain text, split across chunks anywhere (even inside a character)", async () => {
    const bytes = Buffer.from(text);
    const cut = bytes.indexOf(Buffer.from("é")) + 1; // splits the two bytes of é
    expect(await collect(chunks(bytes.subarray(0, 5), bytes.subarray(5, cut), bytes.subarray(cut))))
      .toEqual(["PuzzleId,FEN", "abc,8/8", "déf,8/8", "last"]);
  });

  it("unpacks zstd when the file starts with the zstd marker", async () => {
    const packed = zstdCompressSync(Buffer.from(text));
    expect(isZstd(packed)).toBe(true);
    expect(await collect(chunks(packed.subarray(0, 3), packed.subarray(3))))
      .toEqual(["PuzzleId,FEN", "abc,8/8", "déf,8/8", "last"]);
  });

  it("leaves already-unpacked text alone, whatever the file was called", async () => {
    expect(isZstd(Buffer.from("PuzzleId"))).toBe(false);
  });

  it("fails loudly on a damaged zstd file instead of ending quietly", async () => {
    const packed = zstdCompressSync(Buffer.from(text.repeat(50)));
    const damaged = Buffer.concat([packed.subarray(0, 12), Buffer.alloc(40, 0xff)]);
    await expect(collect(chunks(damaged))).rejects.toThrow();
  });

  it("handles an empty file", async () => {
    expect(await collect(chunks())).toEqual([]);
  });
});
