import { describe, expect, it } from "vitest";
import { isAllowed, parseAllowlist } from "../src/lib/auth";

describe("allowlist", () => {
  const list = parseAllowlist(" Player@Example.com , second@example.org,,");

  it("reads a comma-separated list, ignoring case and spaces", () => {
    expect([...list]).toEqual(["player@example.com", "second@example.org"]);
  });

  it("only lets listed addresses in", () => {
    expect(isAllowed("PLAYER@example.com", list)).toBe(true);
    expect(isAllowed(" second@example.org ", list)).toBe(true);
    expect(isAllowed("stranger@example.com", list)).toBe(false);
    expect(isAllowed("player@example.com.evil.net", list)).toBe(false);
    expect(isAllowed("", list)).toBe(false);
    expect(isAllowed(undefined, list)).toBe(false);
  });
});
