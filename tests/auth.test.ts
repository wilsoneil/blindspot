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

describe("verifiedLogin", () => {
  const client = (data: { claims: Record<string, unknown> } | null, error: unknown = null) =>
    ({ auth: { getClaims: async () => ({ data, error }) } });
  const allowed = new Set(["me@example.com"]);

  it("accepts a verified, allowed login", async () => {
    const { verifiedLogin } = await import("../src/lib/auth");
    expect(await verifiedLogin(client({ claims: { sub: "u-1", email: "Me@Example.com" } }), allowed))
      .toEqual({ authUserId: "u-1", email: "Me@Example.com" });
  });

  it("rejects no session, a failed check, a missing email and an email not on the list", async () => {
    const { verifiedLogin } = await import("../src/lib/auth");
    expect(await verifiedLogin(client(null), allowed)).toBeNull();
    expect(await verifiedLogin(client({ claims: { sub: "u-1", email: "me@example.com" } }, new Error("bad signature")), allowed)).toBeNull();
    expect(await verifiedLogin(client({ claims: { sub: "u-1" } }), allowed)).toBeNull();
    expect(await verifiedLogin(client({ claims: { sub: "u-1", email: "someone@else.com" } }), allowed)).toBeNull();
  });
});
