import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone } from "../contact";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  John.Doe@Example.COM ")).toBe("john.doe@example.com");
  });

  it("returns null for empty/nullish", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("formats a US number to E.164", () => {
    expect(normalizePhone("(415) 555-2671")).toBe("+14155552671");
    expect(normalizePhone("415-555-2671")).toBe("+14155552671");
  });

  it("respects an explicit country code in the input", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null for unparseable/empty", () => {
    expect(normalizePhone("not a phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
