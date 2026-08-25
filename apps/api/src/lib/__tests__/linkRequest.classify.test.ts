import { db } from "@famlink/db";
import { describe, expect, it } from "vitest";
import { classifyMembershipTarget, isAdultLevel, isMinorLevel } from "../linkRequest";

describe("isMinorLevel / isAdultLevel", () => {
  it("treats TEEN and CHILD as minor", () => {
    expect(isMinorLevel("TEEN")).toBe(true);
    expect(isMinorLevel("CHILD")).toBe(true);
    expect(isMinorLevel("ADULT")).toBe(false);
  });

  it("treats ADULT as adult", () => {
    expect(isAdultLevel("ADULT")).toBe(true);
    expect(isAdultLevel("TEEN")).toBe(false);
    expect(isAdultLevel("CHILD")).toBe(false);
  });
});

describe("classifyMembershipTarget", () => {
  it("classifies an account person (userId set) as IN_APP, minor flag from ageGateLevel", async () => {
    const p = await db.person.create({
      data: {
        firstName: "Acct",
        lastName: "Holder",
        ageGateLevel: "TEEN",
        userId: "user_test_123",
        email: null,
        phone: null
      }
    });

    const result = await classifyMembershipTarget({ personId: p.id });

    expect(result).toEqual({ kind: "IN_APP", personId: p.id, minor: true });
  });

  it("classifies an adult account person as IN_APP with minor=false", async () => {
    const p = await db.person.create({
      data: {
        firstName: "Acct",
        lastName: "Adult",
        ageGateLevel: "ADULT",
        userId: "user_test_456",
        email: null,
        phone: null
      }
    });

    const result = await classifyMembershipTarget({ personId: p.id });

    expect(result).toEqual({ kind: "IN_APP", personId: p.id, minor: false });
  });

  it("classifies a passive person with a RAW contact as TOKEN", async () => {
    const p = await db.person.create({
      data: {
        firstName: "Raw",
        lastName: "Contact",
        ageGateLevel: "ADULT",
        userId: null,
        email: "raw.contact@example.com",
        phone: null
      }
    });

    const result = await classifyMembershipTarget({ personId: p.id });

    expect(result).toEqual({ kind: "TOKEN", personId: p.id });
  });

  it("passive with only NORMALIZED contact (CIF-created) still classifies TOKEN", async () => {
    const p = await db.person.create({
      data: {
        firstName: "N",
        lastName: "C",
        ageGateLevel: "ADULT",
        userId: null,
        email: null,
        phone: null,
        phoneNormalized: "+14155552671"
      }
    });
    expect((await classifyMembershipTarget({ personId: p.id })).kind).toBe("TOKEN");
  });

  it("classifies a passive person with no contact at all as DATA_ENTRY", async () => {
    const p = await db.person.create({
      data: {
        firstName: "No",
        lastName: "Contact",
        ageGateLevel: "ADULT",
        userId: null,
        email: null,
        phone: null
      }
    });

    const result = await classifyMembershipTarget({ personId: p.id });

    expect(result).toEqual({ kind: "DATA_ENTRY", personId: p.id });
  });

  it("throws when personId does not resolve to a person", async () => {
    await expect(classifyMembershipTarget({ personId: "does-not-exist" })).rejects.toThrow();
  });
});
