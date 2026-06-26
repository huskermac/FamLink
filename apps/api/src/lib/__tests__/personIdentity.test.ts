import { db } from "@famlink/db";
import { describe, expect, it } from "vitest";
import { findOrCreatePersonByContact } from "../personIdentity";

describe("Person contact partial uniqueness", () => {
  it("rejects two verified persons with the same normalized email", async () => {
    await db.person.create({
      data: {
        firstName: "A",
        lastName: "X",
        ageGateLevel: "ADULT",
        emailNormalized: "dup@x.com",
        emailVerifiedAt: new Date()
      }
    });

    await expect(
      db.person.create({
        data: {
          firstName: "B",
          lastName: "Y",
          ageGateLevel: "ADULT",
          emailNormalized: "dup@x.com",
          emailVerifiedAt: new Date()
        }
      })
    ).rejects.toThrow();
  });

  it("allows two unverified persons with the same normalized email", async () => {
    await db.person.create({
      data: {
        firstName: "C",
        lastName: "X",
        ageGateLevel: "ADULT",
        emailNormalized: "shared@x.com"
      }
    });

    await expect(
      db.person.create({
        data: {
          firstName: "D",
          lastName: "Y",
          ageGateLevel: "ADULT",
          emailNormalized: "shared@x.com"
        }
      })
    ).resolves.toBeTruthy();
  });
});

describe("findOrCreatePersonByContact", () => {
  it("creates a contact-only person when no match exists", async () => {
    const person = await findOrCreatePersonByContact({
      email: "New.Person@X.com",
      name: "New Person"
    });

    expect(person.userId).toBeNull();
    expect(person.emailNormalized).toBe("new.person@x.com");
    expect(person.firstName).toBe("New");
    expect(person.lastName).toBe("Person");
  });

  it("returns an existing person matched by normalized email", async () => {
    const created = await db.person.create({
      data: {
        firstName: "Match",
        lastName: "Me",
        ageGateLevel: "ADULT",
        emailNormalized: "match@x.com"
      }
    });

    const got = await findOrCreatePersonByContact({ email: "MATCH@x.com" });

    expect(got.id).toBe(created.id);
  });

  it("prefers a verified match over an unverified one", async () => {
    await db.person.create({
      data: {
        firstName: "Unv",
        lastName: "A",
        ageGateLevel: "ADULT",
        emailNormalized: "pref@x.com"
      }
    });
    const verified = await db.person.create({
      data: {
        firstName: "Ver",
        lastName: "B",
        ageGateLevel: "ADULT",
        emailNormalized: "pref@x.com",
        emailVerifiedAt: new Date()
      }
    });

    const got = await findOrCreatePersonByContact({ email: "pref@x.com" });

    expect(got.id).toBe(verified.id);
  });

  it("matches by phone when email is absent", async () => {
    const created = await db.person.create({
      data: {
        firstName: "Ph",
        lastName: "One",
        ageGateLevel: "ADULT",
        phoneNormalized: "+14155552671"
      }
    });

    const got = await findOrCreatePersonByContact({ phone: "(415) 555-2671" });

    expect(got.id).toBe(created.id);
  });
});
