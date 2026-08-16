import { describe, it, expect } from "vitest";
import { isAdmin, isPreapproved, isAllowed } from "../lib/access-rules";

const env = { ADMIN_EMAILS: "boss@x.com, admin@x.com", PREAPPROVE_EMAILS: "friend@x.com" };

describe("access rules", () => {
  it("isAdmin matches the admin list, case-insensitive", () => {
    expect(isAdmin("BOSS@x.com", env)).toBe(true);
    expect(isAdmin("nobody@x.com", env)).toBe(false);
    expect(isAdmin("a@x.com", {})).toBe(false);
  });

  it("isPreapproved matches the allowlist", () => {
    expect(isPreapproved("friend@x.com", env)).toBe(true);
    expect(isPreapproved("boss@x.com", env)).toBe(false);
  });

  it("isAllowed = approved OR admin OR preapproved", () => {
    expect(isAllowed({ email: "boss@x.com", approved: false }, env)).toBe(true);
    expect(isAllowed({ email: "friend@x.com", approved: false }, env)).toBe(true);
    expect(isAllowed({ email: "rando@x.com", approved: true }, env)).toBe(true);
    expect(isAllowed({ email: "rando@x.com", approved: false }, env)).toBe(false);
  });
});
