import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../src/app/manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("lists the two regular and two maskable icons", () => {
    expect(m.icons?.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/icons/icon-192.png", "192x192", "any"],
      ["/icons/icon-512.png", "512x512", "any"],
      ["/icons/icon-maskable-192.png", "192x192", "maskable"],
      ["/icons/icon-maskable-512.png", "512x512", "maskable"],
    ]);
  });

  it("points at real PNG files of the stated size", () => {
    for (const icon of m.icons ?? []) {
      const file = join("public", icon.src);
      expect(existsSync(file), file).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });
});
